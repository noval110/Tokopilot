// Package assistant runs the AI assistant: a read-only tool registry executed
// by the Go API, a client for the internal AI service, and the turn loop.
//
// Safety invariants (PRD §13):
//   - The LLM never touches the database; it can only *request* one of the
//     five read-only tools below. Go validates and executes them.
//   - store_id is never an argument: it comes from the verified tenant context.
//   - Tool arguments are decoded strictly; unknown fields are rejected.
//   - There are no mutation tools. The registry is a closed allowlist.
package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/repositories"
	"tokopilot/backend/internal/services"
)

// ToolDef is what the AI service (and through it, the LLM) sees.
type ToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

// Source is shown under an answer so users can see where numbers came from.
type Source struct {
	Tool  string  `json:"tool"`
	Label string  `json:"label"`
	From  *string `json:"from,omitempty"`
	To    *string `json:"to,omitempty"`
	AsOf  string  `json:"as_of"`
}

// ToolError is returned to the model as data (the call is not executed).
type ToolError struct{ Message string }

func (e *ToolError) Error() string { return e.Message }

const (
	ToolLowStock     = "get_low_stock_products"
	ToolProductStock = "get_product_stock"
	ToolSalesSummary = "get_sales_summary"
	ToolTopProducts  = "get_top_selling_products"
	ToolBusiness     = "get_business_summary"
)

var dateParam = map[string]any{"type": "string", "pattern": `^\d{4}-\d{2}-\d{2}$`, "description": "Tanggal YYYY-MM-DD dalam zona waktu toko"}

// Definitions is the closed allowlist sent with every AI request.
func Definitions() []ToolDef {
	return []ToolDef{
		{ToolLowStock, "Daftar produk aktif dengan stok di bawah atau sama dengan stok minimum, stok terendah dulu.",
			obj(map[string]any{"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 50}}, nil)},
		{ToolProductStock, "Cari stok produk aktif berdasarkan nama atau SKU. Mengembalikan hingga 5 kandidat.",
			obj(map[string]any{"query": map[string]any{"type": "string", "minLength": 1, "maxLength": 100}}, []string{"query"})},
		{ToolSalesSummary, "Ringkasan penjualan lunas (kotor, diskon, bersih, jumlah transaksi, rata-rata) untuk rentang tanggal.",
			obj(map[string]any{"start_date": dateParam, "end_date": dateParam}, []string{"start_date", "end_date"})},
		{ToolTopProducts, "Produk terlaris berdasarkan penjualan per produk (sebelum diskon transaksi) untuk rentang tanggal.",
			obj(map[string]any{"start_date": dateParam, "end_date": dateParam, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 10}}, []string{"start_date", "end_date"})},
		{ToolBusiness, "Ringkasan kondisi toko: penjualan bersih, transaksi, stok rendah, 3 produk terlaris, dan pembanding periode sebelumnya bila ada.",
			obj(map[string]any{"start_date": dateParam, "end_date": dateParam}, []string{"start_date", "end_date"})},
	}
}

func obj(props map[string]any, required []string) map[string]any {
	m := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if required != nil {
		m["required"] = required
	}
	return m
}

// IsAllowed reports whether name is one of the five read-only tools.
func IsAllowed(name string) bool {
	for _, d := range Definitions() {
		if d.Name == name {
			return true
		}
	}
	return false
}

// Tools executes allowlisted tools against one store's data.
type Tools struct {
	pool    *pgxpool.Pool
	reports *services.ReportService
	now     func() time.Time
}

func NewTools(pool *pgxpool.Pool, reports *services.ReportService, now func() time.Time) *Tools {
	return &Tools{pool: pool, reports: reports, now: now}
}

// decodeStrict rejects unknown fields (e.g. a smuggled "store_id") and trailing data.
func decodeStrict(raw json.RawMessage, v any) error {
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = json.RawMessage(`{}`)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return &ToolError{Message: "argumen tidak valid: " + sanitize(err.Error())}
	}
	if dec.More() {
		return &ToolError{Message: "argumen tidak valid"}
	}
	return nil
}

func sanitize(s string) string {
	if len(s) > 120 {
		s = s[:120]
	}
	return strings.ReplaceAll(s, "\n", " ")
}

type periodOut struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Timezone string `json:"timezone"`
}

func (t *Tools) asOf(store domain.Store) string {
	loc, err := time.LoadLocation(store.Timezone)
	if err != nil {
		loc = time.UTC
	}
	return t.now().In(loc).Format(time.RFC3339)
}

func (t *Tools) period(store domain.Store, from, to string) (services.Period, error) {
	if from == "" || to == "" {
		return services.Period{}, &ToolError{Message: "start_date dan end_date wajib (YYYY-MM-DD)"}
	}
	p, err := t.reports.ResolvePeriod(from, to, store.Timezone)
	if err != nil {
		return services.Period{}, &ToolError{Message: "rentang tanggal tidak valid (maksimal 366 hari, akhir ≥ awal)"}
	}
	return p, nil
}

func strp(s string) *string { return &s }

// Execute validates arguments and runs one tool for the given store. A
// *ToolError means "tell the model, do not execute"; other errors are internal.
func (t *Tools) Execute(ctx context.Context, store domain.Store, name string, args json.RawMessage) (any, Source, error) {
	if !IsAllowed(name) {
		return nil, Source{}, &ToolError{Message: fmt.Sprintf("alat %q tidak tersedia; hanya alat baca-saja yang diizinkan", sanitize(name))}
	}
	asOf := t.asOf(store)
	switch name {
	case ToolLowStock:
		var a struct {
			Limit *int `json:"limit"`
		}
		if err := decodeStrict(args, &a); err != nil {
			return nil, Source{}, err
		}
		limit := 10
		if a.Limit != nil {
			if *a.Limit < 1 || *a.Limit > 50 {
				return nil, Source{}, &ToolError{Message: "limit harus 1–50"}
			}
			limit = *a.Limit
		}
		list, total, err := repositories.ListProducts(ctx, t.pool, store.ID, repositories.ProductFilter{StockStatus: "low", Status: "active", Sort: "stock", Limit: limit})
		if err != nil {
			return nil, Source{}, err
		}
		out := make([]map[string]any, 0, len(list))
		for _, p := range list {
			out = append(out, map[string]any{"product_id": p.ID, "name": p.Name, "sku": p.SKU, "current_stock": p.CurrentStock,
				"min_stock": p.MinStock, "unit": p.Unit, "status": p.StockStatus})
		}
		return map[string]any{"as_of": asOf, "total_low_stock": total, "products": out},
			Source{Tool: name, Label: "Stok rendah", AsOf: asOf}, nil

	case ToolProductStock:
		var a struct {
			Query string `json:"query"`
		}
		if err := decodeStrict(args, &a); err != nil {
			return nil, Source{}, err
		}
		q := strings.TrimSpace(a.Query)
		if n := utf8.RuneCountInString(q); n < 1 || n > 100 {
			return nil, Source{}, &ToolError{Message: "query wajib, 1–100 karakter"}
		}
		tokens := strings.Fields(q)
		if len(tokens) > 8 {
			tokens = tokens[:8]
		}
		list, total, err := repositories.ListProducts(ctx, t.pool, store.ID, repositories.ProductFilter{Tokens: tokens, Status: "active", Sort: "name", Limit: 5})
		if err != nil {
			return nil, Source{}, err
		}
		out := make([]map[string]any, 0, len(list))
		for _, p := range list {
			out = append(out, map[string]any{"product_id": p.ID, "name": p.Name, "sku": p.SKU, "current_stock": p.CurrentStock,
				"min_stock": p.MinStock, "unit": p.Unit, "status": p.StockStatus, "updated_at": p.UpdatedAt.UTC().Format(time.RFC3339)})
		}
		return map[string]any{"as_of": asOf, "query": q, "match_count": total, "products": out},
			Source{Tool: name, Label: "Stok produk", AsOf: asOf}, nil

	case ToolSalesSummary:
		var a struct {
			Start string `json:"start_date"`
			End   string `json:"end_date"`
		}
		if err := decodeStrict(args, &a); err != nil {
			return nil, Source{}, err
		}
		p, err := t.period(store, a.Start, a.End)
		if err != nil {
			return nil, Source{}, err
		}
		tot, err := repositories.GetSalesTotals(ctx, t.pool, store.ID, p.FromUTC, p.ToUTC)
		if err != nil {
			return nil, Source{}, err
		}
		s := summarize(tot)
		return map[string]any{
				"period": periodOut{a.Start, a.End, p.Timezone}, "as_of": asOf,
				"gross_sales": s.GrossSales, "discount_total": s.DiscountTotal, "net_sales": s.NetSales,
				"transaction_count": s.TransactionCount, "avg_transaction_value": s.Avg, "voided_count": s.VoidedCount,
			},
			Source{Tool: name, Label: "Ringkasan penjualan", From: strp(a.Start), To: strp(a.End), AsOf: asOf}, nil

	case ToolTopProducts:
		var a struct {
			Start string `json:"start_date"`
			End   string `json:"end_date"`
			Limit *int   `json:"limit"`
		}
		if err := decodeStrict(args, &a); err != nil {
			return nil, Source{}, err
		}
		limit := 5
		if a.Limit != nil {
			if *a.Limit < 1 || *a.Limit > 10 {
				return nil, Source{}, &ToolError{Message: "limit harus 1–10"}
			}
			limit = *a.Limit
		}
		p, err := t.period(store, a.Start, a.End)
		if err != nil {
			return nil, Source{}, err
		}
		top, err := repositories.GetTopProducts(ctx, t.pool, store.ID, p.FromUTC, p.ToUTC, limit)
		if err != nil {
			return nil, Source{}, err
		}
		return map[string]any{"period": periodOut{a.Start, a.End, p.Timezone}, "as_of": asOf, "products": topOut(top)},
			Source{Tool: name, Label: "Produk terlaris", From: strp(a.Start), To: strp(a.End), AsOf: asOf}, nil

	case ToolBusiness:
		var a struct {
			Start string `json:"start_date"`
			End   string `json:"end_date"`
		}
		if err := decodeStrict(args, &a); err != nil {
			return nil, Source{}, err
		}
		p, err := t.period(store, a.Start, a.End)
		if err != nil {
			return nil, Source{}, err
		}
		cur, err := repositories.GetSalesTotals(ctx, t.pool, store.ID, p.FromUTC, p.ToUTC)
		if err != nil {
			return nil, Source{}, err
		}
		// Previous period of equal length, immediately before. Computed, never invented.
		prevTo := p.From.AddDate(0, 0, -1)
		prevFrom := prevTo.AddDate(0, 0, -(p.Days - 1))
		prev, err := repositories.GetSalesTotals(ctx, t.pool, store.ID, prevFrom.UTC(), p.FromUTC)
		if err != nil {
			return nil, Source{}, err
		}
		inv, err := repositories.GetInventorySummary(ctx, t.pool, store.ID)
		if err != nil {
			return nil, Source{}, err
		}
		top, err := repositories.GetTopProducts(ctx, t.pool, store.ID, p.FromUTC, p.ToUTC, 3)
		if err != nil {
			return nil, Source{}, err
		}
		comparison := map[string]any{
			"previous_period":            periodOut{prevFrom.Format("2006-01-02"), prevTo.Format("2006-01-02"), p.Timezone},
			"previous_net_sales":         prev.NetSales,
			"previous_transaction_count": prev.TransactionCount,
			"net_sales_change_pct":       nil, // null when there is no base to compare against
		}
		if prev.NetSales > 0 {
			// one decimal, half away from zero
			pct := float64(cur.NetSales-prev.NetSales) * 100 / float64(prev.NetSales)
			comparison["net_sales_change_pct"] = float64(int64(pct*10+sign(pct)*0.5)) / 10
		}
		return map[string]any{
				"period": periodOut{a.Start, a.End, p.Timezone}, "as_of": asOf,
				"net_sales": cur.NetSales, "transaction_count": cur.TransactionCount,
				"low_stock_count": inv.LowStock, "out_of_stock_count": inv.OutOfStock, "active_products": inv.ActiveProducts,
				"top_products": topOut(top), "comparison": comparison,
			},
			Source{Tool: name, Label: "Kondisi toko", From: strp(a.Start), To: strp(a.End), AsOf: asOf}, nil
	}
	return nil, Source{}, errors.New("unreachable")
}

func sign(f float64) float64 {
	if f < 0 {
		return -1
	}
	return 1
}

type summary struct {
	repositories.SalesTotals
	Avg int64
}

func summarize(t repositories.SalesTotals) summary {
	s := summary{SalesTotals: t}
	if t.TransactionCount > 0 {
		s.Avg = (t.NetSales*2 + t.TransactionCount) / (2 * t.TransactionCount)
	}
	return s
}

func topOut(top []repositories.TopProduct) []map[string]any {
	out := make([]map[string]any, 0, len(top))
	for i, p := range top {
		out = append(out, map[string]any{"rank": i + 1, "product_name": p.Name, "sku": p.SKU, "unit": p.Unit,
			"quantity_sold": p.QuantitySold, "revenue": p.Revenue})
	}
	return out
}
