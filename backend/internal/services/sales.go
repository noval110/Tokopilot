package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/repositories"
)

const maxSaleItems = 100

var idempotencyKeyRe = regexp.MustCompile(`^[A-Za-z0-9_-]{8,100}$`)

var errSaleNotFound = apperr.NotFound("Transaksi tidak ditemukan.")

type SalesService struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewSalesService(pool *pgxpool.Pool, now func() time.Time) *SalesService {
	return &SalesService{pool: pool, now: now}
}

type CheckoutItem struct {
	ProductID string              `json:"product_id"`
	Quantity  domain.DecimalInput `json:"quantity"`
}

// CheckoutInput deliberately has no price fields: unknown fields such as
// unit_price are rejected by the strict decoder, and prices are always read
// from the database (FR-SALE-02, PRD §12.1).
type CheckoutInput struct {
	IdempotencyKey string         `json:"idempotency_key"`
	Items          []CheckoutItem `json:"items"`
	DiscountAmount *json.Number   `json:"discount_amount"`
	PaymentMethod  string         `json:"payment_method"`
	Notes          *string        `json:"notes"`
}

type checkoutPlan struct {
	key      string
	items    []CheckoutItem // validated product IDs, raw quantities
	discount int64
	method   string
	notes    *string
	hash     []byte
}

// validateCheckout checks everything that does not need the database and
// computes the request fingerprint used for idempotency.
func validateCheckout(in CheckoutInput) (checkoutPlan, error) {
	fe := apperr.FieldErrors{}
	p := checkoutPlan{key: strings.TrimSpace(in.IdempotencyKey), method: in.PaymentMethod}
	if !idempotencyKeyRe.MatchString(p.key) {
		fe["idempotency_key"] = "Kunci idempotensi wajib (8–100 karakter huruf, angka, - atau _)."
	}
	switch n := len(in.Items); {
	case n == 0:
		fe["items"] = "Keranjang masih kosong."
	case n > maxSaleItems:
		fe["items"] = "Maksimal 100 baris per transaksi."
	}
	seen := map[string]bool{}
	for i, it := range in.Items {
		id := strings.ToLower(strings.TrimSpace(it.ProductID))
		if !IsUUID(id) {
			fe[fmt.Sprintf("items.%d.product_id", i)] = "Produk tidak valid."
			continue
		}
		if seen[id] {
			fe["items"] = "Produk yang sama muncul lebih dari sekali; gabungkan jumlahnya."
		}
		seen[id] = true
		if _, err := domain.ParseQuantity(string(it.Quantity), 3); err != nil {
			fe[fmt.Sprintf("items.%d.quantity", i)] = "Jumlah harus angka ≥ 0 (gunakan titik untuk desimal)."
		}
		p.items = append(p.items, CheckoutItem{ProductID: id, Quantity: it.Quantity})
	}
	if in.DiscountAmount != nil {
		v, err := strconv.ParseInt(in.DiscountAmount.String(), 10, 64)
		switch {
		case err != nil:
			fe["discount_amount"] = "Diskon harus bilangan bulat rupiah."
		case v < 0:
			fe["discount_amount"] = "Diskon tidak boleh negatif."
		}
		p.discount = v
	}
	if !slices.Contains(domain.PaymentMethods, p.method) {
		fe["payment_method"] = "Pilih metode pembayaran."
	}
	noteErrs := apperr.FieldErrors{}
	p.notes = cleanNote(noteErrs, in.Notes)
	if msg := noteErrs["note"]; msg != "" {
		fe["notes"] = msg
	}
	if err := apperr.Validation(fe); err != nil {
		return checkoutPlan{}, err
	}
	p.hash = fingerprint(p)
	return p, nil
}

// fingerprint is a canonical hash of what the sale means (items, discount,
// payment, notes) — not the key — so a retry with the same key and the same
// cart replays, while a different cart under the same key is rejected.
func fingerprint(p checkoutPlan) []byte {
	lines := make([]string, 0, len(p.items))
	for _, it := range p.items {
		q, _ := domain.ParseQuantity(string(it.Quantity), 3)
		lines = append(lines, it.ProductID+"="+q)
	}
	sort.Strings(lines)
	notes := ""
	if p.notes != nil {
		notes = *p.notes
	}
	sum := sha256.Sum256([]byte(strings.Join(lines, ",") + "|" + strconv.FormatInt(p.discount, 10) + "|" + p.method + "|" + notes))
	return sum[:]
}

func idempotencyConflict() error {
	return apperr.Conflict("IDEMPOTENCY_KEY_REUSED", "Kunci transaksi sudah dipakai untuk keranjang yang berbeda. Muat ulang kasir lalu coba lagi.")
}

// Checkout records a sale atomically (FR-SALE-01..07, FR-SALE-10, PRD §10.2):
// one transaction covers the sale, its items, stock decrements and ledger rows.
// Returns replayed=true when the same request was already processed.
func (s *SalesService) Checkout(ctx context.Context, store domain.Store, actorID string, in CheckoutInput) (domain.Sale, bool, error) {
	plan, err := validateCheckout(in)
	if err != nil {
		return domain.Sale{}, false, err
	}

	var saleID string
	replayed := false
	err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		// 1. Serialise retries of the same key, then check for a previous result.
		if err := repositories.LockIdempotencyKey(ctx, tx, store.ID, plan.key); err != nil {
			return err
		}
		if id, hash, err := repositories.FindSaleByKey(ctx, tx, store.ID, plan.key); err == nil {
			if !bytes.Equal(hash, plan.hash) {
				return idempotencyConflict()
			}
			saleID, replayed = id, true
			return nil
		} else if !errors.Is(err, domain.ErrNotFound) {
			return err
		}

		// 2. Lock every product in id order; prices come from these rows only.
		ids := make([]string, len(plan.items))
		for i, it := range plan.items {
			ids[i] = it.ProductID
		}
		locked, err := repositories.LockProductsForSale(ctx, tx, store.ID, ids)
		if err != nil {
			return err
		}
		byID := make(map[string]domain.Product, len(locked))
		for _, p := range locked {
			byID[p.ID] = p
		}

		// 3. Validate items against the locked rows and price them.
		fe := apperr.FieldErrors{}
		items := make([]domain.SaleItem, 0, len(plan.items))
		var subtotal int64
		var shortages []map[string]any
		for i, it := range plan.items {
			p, ok := byID[it.ProductID]
			if !ok {
				return &apperr.Error{Status: http.StatusNotFound, Code: "NOT_FOUND", Message: "Produk tidak ditemukan.",
					Details: map[string]any{"product_id": it.ProductID}}
			}
			if !p.IsActive {
				return &apperr.Error{Status: http.StatusConflict, Code: "PRODUCT_ARCHIVED", Message: "Produk sudah diarsipkan dan tidak dapat dijual.",
					Details: map[string]any{"product_id": p.ID, "product_name": p.Name}}
			}
			field := fmt.Sprintf("items.%d.quantity", i)
			qty := parseQty(fe, field, "Jumlah", string(it.Quantity), p.UnitScale)
			if fe[field] == "" && domain.IsZeroQuantity(qty) {
				fe[field] = "Jumlah harus lebih dari 0."
			}
			if fe[field] != "" {
				continue
			}
			line, err := domain.LineSubtotal(p.SellingPrice, qty)
			if err != nil {
				fe[field] = "Nilai baris terlalu besar."
				continue
			}
			subtotal += line
			if domain.CompareQuantity(qty, p.CurrentStock) > 0 {
				shortages = append(shortages, map[string]any{"product_id": p.ID, "product_name": p.Name, "available": p.CurrentStock, "requested": qty})
			}
			pid := p.ID
			items = append(items, domain.SaleItem{
				LineNo: i + 1, ProductID: &pid, ProductName: p.Name, SKU: p.SKU, Unit: p.Unit, UnitScale: p.UnitScale,
				Quantity: qty, UnitPrice: p.SellingPrice, CostPrice: p.CostPrice, LineSubtotal: line,
			})
		}
		if fe2 := apperr.Validation(fe); fe2 != nil {
			return fe2
		}
		if plan.discount > subtotal {
			return apperr.Validation(apperr.FieldErrors{"discount_amount": "Diskon tidak boleh melebihi subtotal."})
		}
		// FR-SALE-06: one short item rejects the whole transaction.
		if len(shortages) > 0 {
			first := shortages[0]
			return &apperr.Error{Status: http.StatusConflict, Code: "INSUFFICIENT_STOCK", Message: "Stok produk tidak mencukupi.",
				Details: map[string]any{"product_id": first["product_id"], "available": first["available"], "requested": first["requested"], "items": shortages}}
		}

		// 4. Receipt number for the store's business day (BR-13, ADR-0007).
		now := s.now()
		loc, err := time.LoadLocation(store.Timezone)
		if err != nil {
			return fmt.Errorf("store timezone: %w", err)
		}
		day := now.In(loc)
		n, err := repositories.NextSaleNumber(ctx, tx, store.ID, day)
		if err != nil {
			return err
		}

		// 5. Sale, items, then stock + ledger per item.
		saleID, err = repositories.InsertSale(ctx, tx, repositories.SaleWrite{
			StoreID: store.ID, CashierID: actorID, SaleNumber: fmt.Sprintf("TP-%s-%04d", day.Format("20060102"), n),
			PaymentMethod: plan.method, IdempotencyKey: plan.key, RequestHash: plan.hash, Notes: plan.notes,
			Subtotal: subtotal, Discount: plan.discount, NetTotal: subtotal - plan.discount, SoldAt: now,
		})
		if err != nil {
			return err
		}
		ref := "SALE"
		for _, it := range items {
			if err := repositories.InsertSaleItem(ctx, tx, store.ID, saleID, it); err != nil {
				return err
			}
			if _, err := changeStock(ctx, tx, store.ID, actorID, byID[*it.ProductID], stockChange{
				Delta: domain.NegateQuantity(it.Quantity), Type: domain.MovementSale, RefType: &ref, RefID: &saleID,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if errors.Is(err, domain.ErrDuplicateIdempotencyKey) {
		// Backstop if two requests slipped past the advisory lock: report the winner.
		id, hash, ferr := repositories.FindSaleByKey(ctx, s.pool, store.ID, plan.key)
		if ferr != nil {
			return domain.Sale{}, false, ferr
		}
		if !bytes.Equal(hash, plan.hash) {
			return domain.Sale{}, false, idempotencyConflict()
		}
		saleID, replayed, err = id, true, nil
	}
	if err != nil {
		return domain.Sale{}, false, err
	}
	sale, err := repositories.GetSale(ctx, s.pool, store.ID, saleID)
	return sale, replayed, err
}

func (s *SalesService) Get(ctx context.Context, storeID, id string) (domain.Sale, error) {
	if !IsUUID(id) {
		return domain.Sale{}, errSaleNotFound
	}
	sale, err := repositories.GetSale(ctx, s.pool, storeID, id)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.Sale{}, errSaleNotFound
	}
	return sale, err
}

type VoidInput struct {
	Reason string `json:"reason"`
}

// Void cancels a completed sale (FR-SALE-09, US-06): nothing is deleted;
// stock returns through SALE_VOID ledger rows in the same transaction.
func (s *SalesService) Void(ctx context.Context, storeID, actorID, id string, in VoidInput) (domain.Sale, error) {
	if !IsUUID(id) {
		return domain.Sale{}, errSaleNotFound
	}
	reason := strings.Join(strings.Fields(in.Reason), " ")
	if n := utf8.RuneCountInString(reason); n < 3 || n > 500 {
		return domain.Sale{}, apperr.Validation(apperr.FieldErrors{"reason": "Alasan pembatalan wajib (3–500 karakter)."})
	}
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		sale, err := repositories.LockSale(ctx, tx, storeID, id)
		if errors.Is(err, domain.ErrNotFound) {
			return errSaleNotFound
		}
		if err != nil {
			return err
		}
		if sale.Status == domain.SaleVoided {
			return apperr.Conflict("ALREADY_VOIDED", "Transaksi ini sudah dibatalkan.")
		}
		ids := []string{}
		for _, it := range sale.Items {
			if it.ProductID != nil {
				ids = append(ids, *it.ProductID)
			}
		}
		// Archived products still get their stock back: the reversal restores
		// the ledger's truth even if the product can no longer be sold.
		locked, err := repositories.LockProductsForSale(ctx, tx, storeID, ids)
		if err != nil {
			return err
		}
		byID := map[string]domain.Product{}
		for _, p := range locked {
			byID[p.ID] = p
		}
		ref := "SALE"
		for _, it := range sale.Items {
			if it.ProductID == nil {
				continue
			}
			p, ok := byID[*it.ProductID]
			if !ok {
				return fmt.Errorf("void: product %s of sale %s not found", *it.ProductID, id)
			}
			if _, err := changeStock(ctx, tx, storeID, actorID, p, stockChange{
				Delta: it.Quantity, Type: domain.MovementSaleVoid, Note: &reason, RefType: &ref, RefID: &sale.ID,
			}); err != nil {
				return err
			}
		}
		err = repositories.VoidSale(ctx, tx, storeID, id, reason, actorID, s.now())
		if errors.Is(err, domain.ErrAlreadyVoided) {
			return apperr.Conflict("ALREADY_VOIDED", "Transaksi ini sudah dibatalkan.")
		}
		return err
	})
	if err != nil {
		return domain.Sale{}, err
	}
	return repositories.GetSale(ctx, s.pool, storeID, id)
}

type SaleQuery struct {
	Status, PaymentMethod, Number, From, To string
}

func (s *SalesService) List(ctx context.Context, store domain.Store, sq SaleQuery, limit, offset int) ([]domain.Sale, int, error) {
	fe := apperr.FieldErrors{}
	if !slices.Contains([]string{"", "COMPLETED", "VOIDED"}, sq.Status) {
		fe["status"] = "Gunakan COMPLETED atau VOIDED."
	}
	if sq.PaymentMethod != "" && !slices.Contains(domain.PaymentMethods, sq.PaymentMethod) {
		fe["payment_method"] = "Metode pembayaran tidak dikenal."
	}
	number := strings.TrimSpace(sq.Number)
	if utf8.RuneCountInString(number) > 40 {
		fe["q"] = "Nomor transaksi terlalu panjang."
	}
	from, to := StoreDayRange(fe, sq.From, sq.To, store.Timezone)
	if err := apperr.Validation(fe); err != nil {
		return nil, 0, err
	}
	return repositories.ListSales(ctx, s.pool, store.ID, repositories.SaleFilter{
		Status: sq.Status, PaymentMethod: sq.PaymentMethod, Number: number, From: from, To: to, Limit: limit, Offset: offset,
	})
}
