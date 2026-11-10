package services

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"
	_ "time/tzdata" // store timezones must resolve in minimal containers
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/repositories"
)

// MaxReportRangeDays bounds date-range queries (ADR-0008).
const MaxReportRangeDays = 366

type InventoryService struct {
	pool *pgxpool.Pool
}

func NewInventoryService(pool *pgxpool.Pool) *InventoryService { return &InventoryService{pool: pool} }

// stockChange describes one ledger entry to apply to a locked product.
type stockChange struct {
	Delta      string // signed canonical NUMERIC text, never zero
	Type       domain.MovementType
	ReasonCode *domain.ReasonCode
	Note       *string
	RefType    *string
	RefID      *string
}

// changeStock is the single path for every stock mutation (restock,
// adjustment, and later sale/void): the product row must already be locked
// in tx; current_stock and the ledger row are written in the same transaction
// (FR-INV-03, BR-05, BR-07). Returns the new movement ID.
func changeStock(ctx context.Context, tx pgx.Tx, storeID, actorID string, p domain.Product, c stockChange) (string, error) {
	if strings.HasPrefix(c.Delta, "-") && domain.CompareQuantity(strings.TrimPrefix(c.Delta, "-"), p.CurrentStock) > 0 {
		return "", insufficientStock(p, strings.TrimPrefix(c.Delta, "-"))
	}
	before, after, err := repositories.ApplyStockDelta(ctx, tx, storeID, p.ID, c.Delta)
	switch {
	case errors.Is(err, domain.ErrInsufficientStock):
		return "", insufficientStock(p, strings.TrimPrefix(c.Delta, "-"))
	case errors.Is(err, domain.ErrStockOverflow):
		return "", apperr.Validation(apperr.FieldErrors{"quantity": "Stok hasil melebihi batas maksimum."})
	case err != nil:
		return "", err
	}
	return repositories.InsertMovement(ctx, tx, repositories.Movement{
		StoreID: storeID, ProductID: p.ID, ActorUserID: actorID, Type: c.Type,
		QuantityDelta: c.Delta, StockBefore: before, StockAfter: after,
		ReasonCode: c.ReasonCode, Reason: c.Note, ReferenceType: c.RefType, ReferenceID: c.RefID,
	})
}

func insufficientStock(p domain.Product, requested string) error {
	return &apperr.Error{
		Status: http.StatusConflict, Code: "INSUFFICIENT_STOCK", Message: "Stok produk tidak mencukupi.",
		Details: map[string]any{"product_id": p.ID, "product_name": p.Name, "available": p.CurrentStock, "requested": requested},
	}
}

func cleanNote(fe apperr.FieldErrors, note *string) *string {
	if note == nil {
		return nil
	}
	v := strings.TrimSpace(*note)
	if v == "" {
		return nil
	}
	if utf8.RuneCountInString(v) > 500 {
		fe["note"] = "Catatan maksimal 500 karakter."
	}
	return &v
}

// StockChangeResult is returned by restock/adjustment.
type StockChangeResult struct {
	Product  domain.Product
	Movement domain.StockMovement
}

// lockActive locks an active product of the store for a stock change.
func lockActive(ctx context.Context, tx pgx.Tx, storeID, productID string) (domain.Product, error) {
	if !IsUUID(productID) {
		return domain.Product{}, apperr.Validation(apperr.FieldErrors{"product_id": "Pilih produk."})
	}
	p, err := repositories.LockProduct(ctx, tx, storeID, productID)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.Product{}, errProductNotFound
	}
	if err != nil {
		return domain.Product{}, err
	}
	if !p.IsActive {
		return domain.Product{}, apperr.Conflict("PRODUCT_ARCHIVED", "Produk diarsipkan; stoknya tidak dapat diubah.")
	}
	return p, nil
}

func positiveQty(fe apperr.FieldErrors, raw domain.DecimalInput, scale int) string {
	q := parseQty(fe, "quantity", "Jumlah", string(raw), scale)
	if fe["quantity"] == "" && domain.IsZeroQuantity(q) {
		fe["quantity"] = "Jumlah harus lebih dari 0."
	}
	return q
}

func (s *InventoryService) finish(ctx context.Context, tx pgx.Tx, storeID, productID, movementID string) (StockChangeResult, error) {
	p, err := repositories.GetProduct(ctx, tx, storeID, productID)
	if err != nil {
		return StockChangeResult{}, err
	}
	m, err := repositories.GetMovement(ctx, tx, storeID, movementID)
	if err != nil {
		return StockChangeResult{}, err
	}
	return StockChangeResult{Product: p, Movement: m}, nil
}

type RestockInput struct {
	ProductID string              `json:"product_id"`
	Quantity  domain.DecimalInput `json:"quantity"`
	Note      *string             `json:"note"`
}

// Restock records goods received (FR-INV-01, US-04).
func (s *InventoryService) Restock(ctx context.Context, storeID, actorID string, in RestockInput) (StockChangeResult, error) {
	var res StockChangeResult
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		p, err := lockActive(ctx, tx, storeID, in.ProductID)
		if err != nil {
			return err
		}
		fe := apperr.FieldErrors{}
		qty := positiveQty(fe, in.Quantity, p.UnitScale)
		note := cleanNote(fe, in.Note)
		if err := apperr.Validation(fe); err != nil {
			return err
		}
		id, err := changeStock(ctx, tx, storeID, actorID, p, stockChange{Delta: qty, Type: domain.MovementRestock, Note: note})
		if err != nil {
			return err
		}
		res, err = s.finish(ctx, tx, storeID, p.ID, id)
		return err
	})
	return res, err
}

type AdjustmentInput struct {
	ProductID  string              `json:"product_id"`
	Direction  string              `json:"direction"` // IN | OUT
	Quantity   domain.DecimalInput `json:"quantity"`
	ReasonCode string              `json:"reason_code"`
	Note       *string             `json:"note"`
}

// Adjust records a manual correction with a mandatory reason (FR-INV-02).
func (s *InventoryService) Adjust(ctx context.Context, storeID, actorID string, in AdjustmentInput) (StockChangeResult, error) {
	var res StockChangeResult
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		p, err := lockActive(ctx, tx, storeID, in.ProductID)
		if err != nil {
			return err
		}
		fe := apperr.FieldErrors{}
		qty := positiveQty(fe, in.Quantity, p.UnitScale)
		note := cleanNote(fe, in.Note)
		if in.Direction != "IN" && in.Direction != "OUT" {
			fe["direction"] = "Pilih stok masuk atau keluar."
		}
		rc := domain.ReasonCode(in.ReasonCode)
		if !slices.Contains(domain.ReasonCodes, rc) {
			fe["reason_code"] = "Pilih alasan penyesuaian."
		} else if rc == domain.ReasonOther && note == nil {
			fe["note"] = "Jelaskan alasan pada catatan."
		}
		if err := apperr.Validation(fe); err != nil {
			return err
		}
		c := stockChange{Delta: qty, Type: domain.MovementAdjustmentIn, ReasonCode: &rc, Note: note}
		if in.Direction == "OUT" {
			c.Delta, c.Type = domain.NegateQuantity(qty), domain.MovementAdjustmentOut
		}
		id, err := changeStock(ctx, tx, storeID, actorID, p, c)
		if err != nil {
			return err
		}
		res, err = s.finish(ctx, tx, storeID, p.ID, id)
		return err
	})
	return res, err
}

type MovementQuery struct {
	ProductID string
	Type      string
	From      string // YYYY-MM-DD in store timezone
	To        string // inclusive
}

// StoreDayRange converts inclusive store-local dates into a UTC [from, to)
// interval (BR-13). Either bound may be empty.
func StoreDayRange(fe apperr.FieldErrors, from, to, timezone string) (*time.Time, *time.Time) {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc, _ = time.LoadLocation(domain.DefaultTimezone)
	}
	parse := func(field, v string) *time.Time {
		if v == "" {
			return nil
		}
		d, err := time.ParseInLocation("2006-01-02", v, loc)
		if err != nil {
			fe[field] = "Gunakan format tanggal YYYY-MM-DD."
			return nil
		}
		return &d
	}
	f, t := parse("from", from), parse("to", to)
	if f != nil && t != nil {
		if t.Before(*f) {
			fe["to"] = "Tanggal akhir tidak boleh sebelum tanggal awal."
		} else if t.Sub(*f) > time.Duration(MaxReportRangeDays-1)*24*time.Hour+time.Hour {
			fe["to"] = "Rentang maksimal 366 hari."
		}
	}
	var fromUTC, toUTC *time.Time
	if f != nil {
		u := f.UTC()
		fromUTC = &u
	}
	if t != nil {
		u := t.AddDate(0, 0, 1).UTC() // exclusive end: start of the next local day
		toUTC = &u
	}
	return fromUTC, toUTC
}

var movementTypes = []string{"", "INITIAL", "RESTOCK", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "SALE", "SALE_VOID"}

func (s *InventoryService) ListMovements(ctx context.Context, store domain.Store, mq MovementQuery, limit, offset int) ([]domain.StockMovement, int, error) {
	fe := apperr.FieldErrors{}
	if mq.ProductID != "" && !IsUUID(mq.ProductID) {
		fe["product_id"] = "Produk tidak valid."
	}
	if !slices.Contains(movementTypes, mq.Type) {
		fe["type"] = "Jenis mutasi tidak dikenal."
	}
	from, to := StoreDayRange(fe, mq.From, mq.To, store.Timezone)
	if err := apperr.Validation(fe); err != nil {
		return nil, 0, err
	}
	return repositories.ListMovements(ctx, s.pool, store.ID, repositories.MovementFilter{
		ProductID: mq.ProductID, Type: mq.Type, From: from, To: to, Limit: limit, Offset: offset,
	})
}

func (s *InventoryService) Summary(ctx context.Context, storeID string) (repositories.InventorySummary, error) {
	return repositories.GetInventorySummary(ctx, s.pool, storeID)
}
