package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
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

const maxPrice = 1_000_000_000_000 // Rp 1 triliun; mirrors the DB CHECK.

var (
	skuRe  = regexp.MustCompile(`^[A-Z0-9][A-Z0-9._-]{0,63}$`)
	uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// IsUUID reports whether s is a canonical UUID. Malformed IDs are treated as
// "not found" so they never reach PostgreSQL as a cast error.
func IsUUID(s string) bool { return uuidRe.MatchString(s) }

var errProductNotFound = apperr.NotFound("Produk tidak ditemukan.")

type CatalogService struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewCatalogService(pool *pgxpool.Pool, now func() time.Time) *CatalogService {
	return &CatalogService{pool: pool, now: now}
}

// ---------- Categories ----------

func validateCategoryName(fe apperr.FieldErrors, raw string) string {
	v := strings.Join(strings.Fields(raw), " ")
	switch n := utf8.RuneCountInString(v); {
	case n == 0:
		fe["name"] = "Nama kategori wajib diisi."
	case n > 60:
		fe["name"] = "Nama kategori maksimal 60 karakter."
	}
	return v
}

func duplicateCategoryErr() error {
	return &apperr.Error{Status: http.StatusConflict, Code: "DUPLICATE_CATEGORY", Message: "Nama kategori sudah dipakai.",
		Details: map[string]any{"fields": map[string]string{"name": "Nama kategori sudah dipakai."}}}
}

func (s *CatalogService) ListCategories(ctx context.Context, storeID string, includeArchived bool) ([]repositories.CategoryWithCount, error) {
	return repositories.ListCategories(ctx, s.pool, storeID, includeArchived)
}

type CategoryInput struct {
	Name string `json:"name"`
}

func (s *CatalogService) CreateCategory(ctx context.Context, storeID, actorID string, in CategoryInput) (domain.Category, error) {
	fe := apperr.FieldErrors{}
	name := validateCategoryName(fe, in.Name)
	if err := apperr.Validation(fe); err != nil {
		return domain.Category{}, err
	}
	c, err := repositories.CreateCategory(ctx, s.pool, storeID, name, actorID)
	if errors.Is(err, domain.ErrDuplicateCategory) {
		return domain.Category{}, duplicateCategoryErr()
	}
	return c, err
}

func (s *CatalogService) RenameCategory(ctx context.Context, storeID, id string, in CategoryInput) (domain.Category, error) {
	if !IsUUID(id) {
		return domain.Category{}, apperr.NotFound("Kategori tidak ditemukan.")
	}
	fe := apperr.FieldErrors{}
	name := validateCategoryName(fe, in.Name)
	if err := apperr.Validation(fe); err != nil {
		return domain.Category{}, err
	}
	c, err := repositories.RenameCategory(ctx, s.pool, storeID, id, name)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return domain.Category{}, apperr.NotFound("Kategori tidak ditemukan.")
	case errors.Is(err, domain.ErrDuplicateCategory):
		return domain.Category{}, duplicateCategoryErr()
	}
	return c, err
}

func (s *CatalogService) ArchiveCategory(ctx context.Context, storeID, id string) error {
	if !IsUUID(id) {
		return apperr.NotFound("Kategori tidak ditemukan.")
	}
	err := repositories.ArchiveCategory(ctx, s.pool, storeID, id, s.now())
	if errors.Is(err, domain.ErrNotFound) {
		return apperr.NotFound("Kategori tidak ditemukan.")
	}
	return err
}

// ---------- Products ----------

// ProductInput is shared by create and PATCH. Every field is optional at the
// JSON level; create enforces required fields, PATCH merges onto current values.
type ProductInput struct {
	Name         *string              `json:"name"`
	SKU          *string              `json:"sku"`         // "" clears
	CategoryID   *string              `json:"category_id"` // "" clears
	Unit         *string              `json:"unit"`
	UnitScale    *int                 `json:"unit_scale"`
	CostPrice    *json.Number         `json:"cost_price"`
	SellingPrice *json.Number         `json:"selling_price"`
	MinStock     *domain.DecimalInput `json:"min_stock"`
}

type CreateProductInput struct {
	ProductInput
	InitialStock *domain.DecimalInput `json:"initial_stock"`
}

func parsePrice(fe apperr.FieldErrors, field, label string, n *json.Number) int64 {
	if n == nil {
		fe[field] = label + " wajib diisi."
		return 0
	}
	v, err := strconv.ParseInt(n.String(), 10, 64)
	switch {
	case err != nil:
		fe[field] = label + " harus bilangan bulat rupiah (tanpa desimal)."
	case v < 0:
		fe[field] = label + " tidak boleh negatif."
	case v > maxPrice:
		fe[field] = label + " terlalu besar."
	}
	return v
}

func parseQty(fe apperr.FieldErrors, field, label, raw string, scale int) string {
	q, err := domain.ParseQuantity(raw, scale)
	switch {
	case errors.Is(err, domain.ErrQuantityScale):
		if scale == 0 {
			fe[field] = label + " harus bilangan bulat untuk satuan ini."
		} else {
			fe[field] = label + " maksimal " + strconv.Itoa(scale) + " angka di belakang koma."
		}
	case err != nil:
		fe[field] = label + " harus angka ≥ 0 (gunakan titik untuk desimal)."
	}
	return q
}

// mergeProduct applies in onto base and validates the full result.
func mergeProduct(fe apperr.FieldErrors, base repositories.ProductWrite, in ProductInput, creating bool) repositories.ProductWrite {
	w := base
	if in.Name != nil || creating {
		w.Name = strings.Join(strings.Fields(deref(in.Name)), " ")
		switch n := utf8.RuneCountInString(w.Name); {
		case n == 0:
			fe["name"] = "Nama produk wajib diisi."
		case n > 150:
			fe["name"] = "Nama produk maksimal 150 karakter."
		}
	}
	if in.SKU != nil {
		sku := strings.ToUpper(strings.TrimSpace(*in.SKU))
		if sku == "" {
			w.SKU = nil
		} else if !skuRe.MatchString(sku) {
			fe["sku"] = "SKU hanya huruf, angka, titik, strip, atau garis bawah (maks. 64)."
		} else {
			w.SKU = &sku
		}
	}
	if in.CategoryID != nil {
		id := strings.TrimSpace(*in.CategoryID)
		if id == "" {
			w.CategoryID = nil
		} else if !IsUUID(id) {
			fe["category_id"] = "Kategori tidak ditemukan."
		} else {
			w.CategoryID = &id
		}
	}
	if in.Unit != nil || creating {
		w.Unit = strings.TrimSpace(deref(in.Unit))
		switch n := utf8.RuneCountInString(w.Unit); {
		case n == 0:
			fe["unit"] = "Satuan wajib diisi."
		case n > 20:
			fe["unit"] = "Satuan maksimal 20 karakter."
		}
	}
	if in.UnitScale != nil {
		if *in.UnitScale < 0 || *in.UnitScale > 3 {
			fe["unit_scale"] = "Jumlah desimal harus 0 sampai 3."
		} else {
			w.UnitScale = *in.UnitScale
		}
	}
	if in.CostPrice != nil || creating {
		w.CostPrice = parsePrice(fe, "cost_price", "Harga modal", in.CostPrice)
	}
	if in.SellingPrice != nil || creating {
		w.SellingPrice = parsePrice(fe, "selling_price", "Harga jual", in.SellingPrice)
	}
	switch {
	case in.MinStock != nil:
		w.MinStock = parseQty(fe, "min_stock", "Stok minimum", string(*in.MinStock), w.UnitScale)
	case creating:
		w.MinStock = "0.000"
	default:
		// Unit scale may have changed: the existing minimum must still fit.
		if _, err := domain.ParseQuantity(w.MinStock, w.UnitScale); err != nil && fe["unit_scale"] == "" {
			fe["unit_scale"] = "Stok minimum saat ini memakai desimal; sesuaikan dulu sebelum mengurangi desimal."
		}
	}
	return w
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (s *CatalogService) checkCategory(ctx context.Context, q db.DBTX, storeID string, w repositories.ProductWrite, changed bool) error {
	if w.CategoryID == nil || !changed {
		return nil
	}
	if _, err := repositories.GetActiveCategory(ctx, q, storeID, *w.CategoryID); errors.Is(err, domain.ErrNotFound) {
		return apperr.Validation(apperr.FieldErrors{"category_id": "Kategori tidak ditemukan atau sudah diarsipkan."})
	} else if err != nil {
		return err
	}
	return nil
}

func mapProductErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrDuplicateSKU):
		return &apperr.Error{Status: http.StatusConflict, Code: "DUPLICATE_SKU", Message: "SKU sudah dipakai produk aktif lain.",
			Details: map[string]any{"fields": map[string]string{"sku": "SKU sudah dipakai produk aktif lain. Gunakan kode lain."}}}
	case errors.Is(err, domain.ErrScaleConflict):
		return apperr.Validation(apperr.FieldErrors{"unit_scale": "Stok saat ini memakai desimal; jumlah desimal tidak bisa dikurangi."})
	case errors.Is(err, domain.ErrNotFound):
		return errProductNotFound
	}
	return err
}

func (s *CatalogService) CreateProduct(ctx context.Context, storeID, actorID string, in CreateProductInput) (domain.Product, error) {
	fe := apperr.FieldErrors{}
	w := mergeProduct(fe, repositories.ProductWrite{}, in.ProductInput, true)
	initial := "0.000"
	if in.InitialStock != nil {
		initial = parseQty(fe, "initial_stock", "Stok awal", string(*in.InitialStock), w.UnitScale)
	}
	if err := apperr.Validation(fe); err != nil {
		return domain.Product{}, err
	}

	var product domain.Product
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := s.checkCategory(ctx, tx, storeID, w, true); err != nil {
			return err
		}
		id, err := repositories.InsertProduct(ctx, tx, storeID, w, initial, actorID)
		if err != nil {
			return err
		}
		// Initial stock enters through the ledger like every other change (BR-05).
		if !domain.IsZeroQuantity(initial) {
			if _, err := repositories.InsertMovement(ctx, tx, repositories.Movement{
				StoreID: storeID, ProductID: id, ActorUserID: actorID, Type: domain.MovementInitial,
				QuantityDelta: initial, StockBefore: "0.000", StockAfter: initial,
			}); err != nil {
				return err
			}
		}
		product, err = repositories.GetProduct(ctx, tx, storeID, id)
		return err
	})
	if err != nil {
		return domain.Product{}, mapProductErr(err)
	}
	return product, nil
}

func (s *CatalogService) GetProduct(ctx context.Context, storeID, id string) (domain.Product, error) {
	if !IsUUID(id) {
		return domain.Product{}, errProductNotFound
	}
	p, err := repositories.GetProduct(ctx, s.pool, storeID, id)
	if err != nil {
		return domain.Product{}, mapProductErr(err)
	}
	return p, nil
}

func toWrite(p domain.Product) repositories.ProductWrite {
	return repositories.ProductWrite{
		Name: p.Name, SKU: p.SKU, CategoryID: p.CategoryID, Unit: p.Unit, UnitScale: p.UnitScale,
		CostPrice: p.CostPrice, SellingPrice: p.SellingPrice, MinStock: p.MinStock,
	}
}

func archivedErr() error {
	return apperr.Conflict("PRODUCT_ARCHIVED", "Produk sudah diarsipkan dan tidak dapat diubah.")
}

func (s *CatalogService) UpdateProduct(ctx context.Context, storeID, id string, in ProductInput) (domain.Product, error) {
	if !IsUUID(id) {
		return domain.Product{}, errProductNotFound
	}
	var product domain.Product
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		current, err := repositories.LockProduct(ctx, tx, storeID, id)
		if err != nil {
			return err
		}
		if !current.IsActive {
			return archivedErr()
		}
		fe := apperr.FieldErrors{}
		w := mergeProduct(fe, toWrite(current), in, false)
		if err := apperr.Validation(fe); err != nil {
			return err
		}
		changed := in.CategoryID != nil && deref(in.CategoryID) != deref(current.CategoryID)
		if err := s.checkCategory(ctx, tx, storeID, w, changed); err != nil {
			return err
		}
		if err := repositories.UpdateProduct(ctx, tx, storeID, id, w); err != nil {
			return err
		}
		product, err = repositories.GetProduct(ctx, tx, storeID, id)
		return err
	})
	if err != nil {
		return domain.Product{}, mapProductErr(err)
	}
	return product, nil
}

// ArchiveProduct hides a product from new sales without touching history
// (FR-PROD-03, BR-17). Products are never hard-deleted.
func (s *CatalogService) ArchiveProduct(ctx context.Context, storeID, id string) (domain.Product, error) {
	if !IsUUID(id) {
		return domain.Product{}, errProductNotFound
	}
	var product domain.Product
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		current, err := repositories.LockProduct(ctx, tx, storeID, id)
		if err != nil {
			return err
		}
		if !current.IsActive {
			return apperr.Conflict("ALREADY_ARCHIVED", "Produk sudah diarsipkan.")
		}
		if err := repositories.ArchiveProduct(ctx, tx, storeID, id, s.now()); err != nil {
			return err
		}
		product, err = repositories.GetProduct(ctx, tx, storeID, id)
		return err
	})
	if err != nil {
		return domain.Product{}, mapProductErr(err)
	}
	return product, nil
}

type ProductQuery struct {
	Q           string
	CategoryID  string
	StockStatus string
	Status      string
	Sort        string
}

func (s *CatalogService) ListProducts(ctx context.Context, storeID string, pq ProductQuery, limit, offset int) ([]domain.Product, int, error) {
	fe := apperr.FieldErrors{}
	q := strings.TrimSpace(pq.Q)
	if utf8.RuneCountInString(q) > 100 {
		fe["q"] = "Kata kunci maksimal 100 karakter."
	}
	if pq.CategoryID != "" && !IsUUID(pq.CategoryID) {
		fe["category_id"] = "Kategori tidak valid."
	}
	if !oneOf(pq.StockStatus, "", "low", "out", "ok") {
		fe["stock_status"] = "Gunakan low, out, atau ok."
	}
	if !oneOf(pq.Status, "", "active", "archived", "all") {
		fe["status"] = "Gunakan active, archived, atau all."
	}
	if !oneOf(pq.Sort, "", "name", "-updated_at", "stock") {
		fe["sort"] = "Gunakan name, -updated_at, atau stock."
	}
	if err := apperr.Validation(fe); err != nil {
		return nil, 0, err
	}
	return repositories.ListProducts(ctx, s.pool, storeID, repositories.ProductFilter{
		Query: q, CategoryID: pq.CategoryID, StockStatus: pq.StockStatus, Status: pq.Status, Sort: pq.Sort,
		Limit: limit, Offset: offset,
	})
}

func oneOf(v string, allowed ...string) bool {
	for _, a := range allowed {
		if v == a {
			return true
		}
	}
	return false
}
