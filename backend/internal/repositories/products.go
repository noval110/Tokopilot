package repositories

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
)

const productSelect = `
	SELECT p.id, p.name, p.sku, p.category_id, c.name, p.unit, p.unit_scale,
	       p.cost_price, p.selling_price, p.current_stock::text, p.min_stock::text,
	       CASE WHEN p.current_stock = 0 THEN 'OUT'
	            WHEN p.current_stock <= p.min_stock THEN 'LOW'
	            ELSE 'OK' END,
	       p.is_active, p.archived_at, p.created_at, p.updated_at
	FROM products p
	LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id`

func scanProduct(row pgx.Row) (domain.Product, error) {
	var p domain.Product
	var status string
	err := row.Scan(&p.ID, &p.Name, &p.SKU, &p.CategoryID, &p.CategoryName, &p.Unit, &p.UnitScale,
		&p.CostPrice, &p.SellingPrice, &p.CurrentStock, &p.MinStock, &status,
		&p.IsActive, &p.ArchivedAt, &p.CreatedAt, &p.UpdatedAt)
	p.StockStatus = domain.StockStatus(status)
	return p, err
}

// ProductFilter values are validated by the service; Sort and StockStatus are
// mapped to fixed SQL fragments below, never interpolated.
type ProductFilter struct {
	Query       string
	Tokens      []string // every token must match name or SKU (AI stock lookup)
	CategoryID  string
	StockStatus string // "", "low", "out", "ok"
	Status      string // "active", "archived", "all"
	Sort        string // "name", "-updated_at", "stock"
	Limit       int
	Offset      int
}

var productOrder = map[string]string{
	"name":        "lower(p.name), p.id",
	"-updated_at": "p.updated_at DESC, p.id",
	"stock":       "p.current_stock, lower(p.name), p.id",
}

var stockStatusWhere = map[string]string{
	"low": "p.current_stock <= p.min_stock",
	"out": "p.current_stock = 0",
	"ok":  "p.current_stock > p.min_stock",
}

// escapeLike makes user input literal inside a LIKE pattern.
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func ListProducts(ctx context.Context, q db.DBTX, storeID string, f ProductFilter) ([]domain.Product, int, error) {
	where := []string{"p.store_id = $1"}
	args := []any{storeID}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }

	switch f.Status {
	case "archived":
		where = append(where, "NOT p.is_active")
	case "all":
	default:
		where = append(where, "p.is_active")
	}
	if f.Query != "" {
		name := arg("%" + escapeLike(strings.ToLower(f.Query)) + "%")
		sku := arg("%" + escapeLike(strings.ToUpper(f.Query)) + "%")
		where = append(where, fmt.Sprintf(`(lower(p.name) LIKE %s ESCAPE '\' OR p.sku LIKE %s ESCAPE '\')`, name, sku))
	}
	for _, tok := range f.Tokens {
		name := arg("%" + escapeLike(strings.ToLower(tok)) + "%")
		sku := arg("%" + escapeLike(strings.ToUpper(tok)) + "%")
		where = append(where, fmt.Sprintf(`(lower(p.name) LIKE %s ESCAPE '\' OR p.sku LIKE %s ESCAPE '\')`, name, sku))
	}
	if f.CategoryID != "" {
		where = append(where, "p.category_id = "+arg(f.CategoryID))
	}
	if cond, ok := stockStatusWhere[f.StockStatus]; ok {
		where = append(where, cond)
	}
	order, ok := productOrder[f.Sort]
	if !ok {
		order = productOrder["name"]
	}
	whereSQL := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := q.QueryRow(ctx, "SELECT count(*) FROM products p"+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count products: %w", err)
	}
	rows, err := q.Query(ctx, productSelect+whereSQL+" ORDER BY "+order+
		" LIMIT "+arg(f.Limit)+" OFFSET "+arg(f.Offset), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list products: %w", err)
	}
	products, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Product, error) { return scanProduct(r) })
	if err != nil {
		return nil, 0, fmt.Errorf("scan products: %w", err)
	}
	return products, total, nil
}

// GetProduct returns a product of the store, or ErrNotFound (also for other stores' IDs).
func GetProduct(ctx context.Context, q db.DBTX, storeID, id string) (domain.Product, error) {
	p, err := scanProduct(q.QueryRow(ctx, productSelect+" WHERE p.store_id = $1 AND p.id = $2", storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Product{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Product{}, fmt.Errorf("get product: %w", err)
	}
	return p, nil
}

// LockProduct takes a row lock on the product for the rest of the transaction.
func LockProduct(ctx context.Context, tx pgx.Tx, storeID, id string) (domain.Product, error) {
	p, err := scanProduct(tx.QueryRow(ctx, productSelect+" WHERE p.store_id = $1 AND p.id = $2 FOR UPDATE OF p", storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Product{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Product{}, fmt.Errorf("lock product: %w", err)
	}
	return p, nil
}

// ProductWrite holds validated, canonical values.
type ProductWrite struct {
	Name         string
	SKU          *string
	CategoryID   *string
	Unit         string
	UnitScale    int
	CostPrice    int64
	SellingPrice int64
	MinStock     string // canonical NUMERIC text
}

func mapProductWriteErr(err error, op string) error {
	switch {
	case db.IsUniqueViolation(err, "products_store_sku_active_idx"):
		return domain.ErrDuplicateSKU
	case db.IsCheckViolation(err, "products_stock_scale"):
		return domain.ErrScaleConflict
	}
	return fmt.Errorf("%s: %w", op, err)
}

// InsertProduct stores a product with its initial stock. The caller must
// record the matching INITIAL movement in the same transaction.
func InsertProduct(ctx context.Context, q db.DBTX, storeID string, w ProductWrite, initialStock, createdBy string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `
		INSERT INTO products (store_id, category_id, name, sku, unit, unit_scale, cost_price, selling_price,
		                      current_stock, min_stock, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric, $11)
		RETURNING id`,
		storeID, w.CategoryID, w.Name, w.SKU, w.Unit, w.UnitScale, w.CostPrice, w.SellingPrice,
		initialStock, w.MinStock, createdBy,
	).Scan(&id)
	if err != nil {
		return "", mapProductWriteErr(err, "insert product")
	}
	return id, nil
}

// UpdateProduct changes catalog fields. current_stock is deliberately not
// writable here: stock only changes through movements (BR-05).
func UpdateProduct(ctx context.Context, q db.DBTX, storeID, id string, w ProductWrite) error {
	tag, err := q.Exec(ctx, `
		UPDATE products SET category_id = $3, name = $4, sku = $5, unit = $6, unit_scale = $7,
		       cost_price = $8, selling_price = $9, min_stock = $10::numeric, updated_at = now()
		WHERE store_id = $1 AND id = $2`,
		storeID, id, w.CategoryID, w.Name, w.SKU, w.Unit, w.UnitScale, w.CostPrice, w.SellingPrice, w.MinStock)
	if err != nil {
		return mapProductWriteErr(err, "update product")
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func ArchiveProduct(ctx context.Context, q db.DBTX, storeID, id string, now time.Time) error {
	if _, err := q.Exec(ctx, `
		UPDATE products SET is_active = false, archived_at = $3, updated_at = $3
		WHERE store_id = $1 AND id = $2 AND is_active`, storeID, id, now); err != nil {
		return fmt.Errorf("archive product: %w", err)
	}
	return nil
}
