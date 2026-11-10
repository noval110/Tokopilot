package services

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/repositories"
)

// DefaultPeriodDays is the dashboard default: the last 7 days including today.
const DefaultPeriodDays = 7

type ReportService struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewReportService(pool *pgxpool.Pool, now func() time.Time) *ReportService {
	return &ReportService{pool: pool, now: now}
}

// Period is an inclusive range of store-local calendar days and its UTC
// half-open equivalent [FromUTC, ToUTC) used by every query (BR-13).
type Period struct {
	From, To       time.Time // local midnight of first/last day
	FromUTC, ToUTC time.Time
	Timezone       string
	Days           int
	GeneratedAt    time.Time
}

// ResolvePeriod parses optional YYYY-MM-DD bounds in the store timezone.
// Missing bounds default to the last 7 days ending today.
func (s *ReportService) ResolvePeriod(fromRaw, toRaw, timezone string) (Period, error) {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc, _ = time.LoadLocation(domain.DefaultTimezone)
		timezone = domain.DefaultTimezone
	}
	now := s.now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	fe := apperr.FieldErrors{}
	parse := func(field, v string) (time.Time, bool) {
		if v == "" {
			return time.Time{}, false
		}
		d, err := time.ParseInLocation("2006-01-02", v, loc)
		if err != nil {
			fe[field] = "Gunakan format tanggal YYYY-MM-DD."
			return time.Time{}, false
		}
		return d, true
	}
	from, hasFrom := parse("from", fromRaw)
	to, hasTo := parse("to", toRaw)
	if err := apperr.Validation(fe); err != nil {
		return Period{}, err
	}
	switch {
	case !hasFrom && !hasTo:
		to, from = today, today.AddDate(0, 0, -(DefaultPeriodDays-1))
	case hasFrom && !hasTo:
		to = today
	case !hasFrom && hasTo:
		from = to.AddDate(0, 0, -(DefaultPeriodDays - 1))
	}
	if to.Before(from) {
		return Period{}, apperr.Validation(apperr.FieldErrors{"to": "Tanggal akhir tidak boleh sebelum tanggal awal."})
	}
	days := daysBetween(from, to) + 1
	if days > MaxReportRangeDays {
		return Period{}, apperr.Validation(apperr.FieldErrors{"to": "Rentang maksimal 366 hari."})
	}
	return Period{
		From: from, To: to, FromUTC: from.UTC(), ToUTC: to.AddDate(0, 0, 1).UTC(),
		Timezone: timezone, Days: days, GeneratedAt: s.now().UTC(),
	}, nil
}

func daysBetween(a, b time.Time) int {
	ad := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
	bd := time.Date(b.Year(), b.Month(), b.Day(), 0, 0, 0, 0, time.UTC)
	return int(bd.Sub(ad).Hours() / 24)
}

// Summary is the money view of a period. Definitions (docs/api/reports.md):
// gross = Σ subtotal, net = gross − discount, gross profit = net − COGS.
type Summary struct {
	repositories.SalesTotals
	AvgTransaction int64 // net / count, rounded half-up; 0 when no sales
	GrossProfit    int64
}

func summarize(t repositories.SalesTotals) Summary {
	s := Summary{SalesTotals: t, GrossProfit: t.NetSales - t.COGS}
	if t.TransactionCount > 0 {
		s.AvgTransaction = (t.NetSales*2 + t.TransactionCount) / (2 * t.TransactionCount)
	}
	return s
}

type DashboardSummary struct {
	Period         Period
	Summary        Summary
	ActiveProducts int
	LowStock       int
	OutOfStock     int
}

// Dashboard returns period KPIs plus the current stock picture (FR-DASH-01).
func (s *ReportService) Dashboard(ctx context.Context, store domain.Store, fromRaw, toRaw string) (DashboardSummary, error) {
	p, err := s.ResolvePeriod(fromRaw, toRaw, store.Timezone)
	if err != nil {
		return DashboardSummary{}, err
	}
	t, err := repositories.GetSalesTotals(ctx, s.pool, store.ID, p.FromUTC, p.ToUTC)
	if err != nil {
		return DashboardSummary{}, err
	}
	inv, err := repositories.GetInventorySummary(ctx, s.pool, store.ID)
	if err != nil {
		return DashboardSummary{}, err
	}
	return DashboardSummary{Period: p, Summary: summarize(t), ActiveProducts: inv.ActiveProducts, LowStock: inv.LowStock, OutOfStock: inv.OutOfStock}, nil
}

// Trend returns zero-filled daily net sales for the period (FR-DASH-02).
func (s *ReportService) Trend(ctx context.Context, store domain.Store, fromRaw, toRaw string) (Period, []repositories.DailySales, error) {
	p, err := s.ResolvePeriod(fromRaw, toRaw, store.Timezone)
	if err != nil {
		return Period{}, nil, err
	}
	days, err := repositories.GetDailySales(ctx, s.pool, store.ID, p.Timezone, p.From, p.To, p.FromUTC, p.ToUTC)
	return p, days, err
}

type SalesReport struct {
	Period      Period
	Summary     Summary
	TopProducts []repositories.TopProduct
	Payments    []repositories.PaymentBreakdown
	Daily       []repositories.DailySales
}

// TopProducts returns the period's best sellers (FR-DASH-03), limit 1–20.
func (s *ReportService) TopProducts(ctx context.Context, store domain.Store, fromRaw, toRaw string, limitRaw string) (Period, []repositories.TopProduct, error) {
	limit := 5
	if limitRaw != "" {
		n, err := strconv.Atoi(limitRaw)
		if err != nil || n < 1 || n > 20 {
			return Period{}, nil, apperr.Validation(apperr.FieldErrors{"limit": "limit harus 1–20."})
		}
		limit = n
	}
	p, err := s.ResolvePeriod(fromRaw, toRaw, store.Timezone)
	if err != nil {
		return Period{}, nil, err
	}
	top, err := repositories.GetTopProducts(ctx, s.pool, store.ID, p.FromUTC, p.ToUTC, limit)
	return p, top, err
}

// Sales builds the full report for one period (FR-REP-01, FR-REP-02).
func (s *ReportService) Sales(ctx context.Context, store domain.Store, fromRaw, toRaw string) (SalesReport, error) {
	p, err := s.ResolvePeriod(fromRaw, toRaw, store.Timezone)
	if err != nil {
		return SalesReport{}, err
	}
	r := SalesReport{Period: p}
	t, err := repositories.GetSalesTotals(ctx, s.pool, store.ID, p.FromUTC, p.ToUTC)
	if err != nil {
		return SalesReport{}, err
	}
	r.Summary = summarize(t)
	if r.TopProducts, err = repositories.GetTopProducts(ctx, s.pool, store.ID, p.FromUTC, p.ToUTC, 10); err != nil {
		return SalesReport{}, err
	}
	if r.Payments, err = repositories.GetPaymentBreakdown(ctx, s.pool, store.ID, p.FromUTC, p.ToUTC); err != nil {
		return SalesReport{}, err
	}
	if r.Daily, err = repositories.GetDailySales(ctx, s.pool, store.ID, p.Timezone, p.From, p.To, p.FromUTC, p.ToUTC); err != nil {
		return SalesReport{}, err
	}
	return r, nil
}

// csvSafe neutralises spreadsheet formula injection (cells starting with
// = + - @ or control characters are prefixed with an apostrophe).
func csvSafe(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		return "'" + v
	}
	return v
}

var exportStatus = map[string]string{"COMPLETED": "Lunas", "VOIDED": "Void"}
var exportPayment = map[string]string{"CASH": "Tunai", "TRANSFER": "Transfer", "QRIS": "QRIS", "OTHER": "Lainnya"}

// Export writes every transaction of the period as CSV (FR-REP-03). Voided
// sales are included with their status so the file reconciles: the sum of
// "Total bersih" over Lunas rows equals the report's net sales.
func (s *ReportService) Export(ctx context.Context, store domain.Store, p Period, w io.Writer) error {
	loc, err := time.LoadLocation(p.Timezone)
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil { // UTF-8 BOM so Excel detects the encoding
		return err
	}
	cw := csv.NewWriter(w)
	tzLabel := map[string]string{"Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT"}[p.Timezone]
	if err := cw.Write([]string{"Nomor nota", fmt.Sprintf("Waktu (%s)", tzLabel), "Kasir", "Status", "Pembayaran",
		"Jumlah baris", "Subtotal", "Diskon", "Total bersih", "Alasan void"}); err != nil {
		return err
	}
	err = repositories.StreamSalesExport(ctx, s.pool, store.ID, p.FromUTC, p.ToUTC, func(r repositories.ExportRow) error {
		reason := ""
		if r.VoidReason != nil {
			reason = *r.VoidReason
		}
		return cw.Write([]string{
			r.SaleNumber, r.SoldAt.In(loc).Format("2006-01-02 15:04"), csvSafe(r.Cashier), exportStatus[r.Status],
			exportPayment[r.PaymentMethod], strconv.FormatInt(r.ItemCount, 10), strconv.FormatInt(r.Subtotal, 10),
			strconv.FormatInt(r.Discount, 10), strconv.FormatInt(r.NetTotal, 10), csvSafe(reason),
		})
	})
	if err != nil {
		return err
	}
	cw.Flush()
	return cw.Error()
}
