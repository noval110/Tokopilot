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

// LockProductsForSale row-locks the given products of the store in a
// consistent order (by id) to avoid deadlocks between concurrent checkouts
// (PRD §10.2). Archived products are returned too; callers decide.
func LockProductsForSale(ctx context.Context, tx pgx.Tx, storeID string, ids []string) ([]domain.Product, error) {
	rows, err := tx.Query(ctx, productSelect+` WHERE p.store_id = $1 AND p.id = ANY($2::uuid[]) ORDER BY p.id FOR UPDATE OF p`, storeID, ids)
	if err != nil {
		return nil, fmt.Errorf("lock products: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Product, error) { return scanProduct(r) })
}

// LockIdempotencyKey serialises concurrent requests carrying the same key for
// a store until the transaction ends.
func LockIdempotencyKey(ctx context.Context, tx pgx.Tx, storeID, key string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "sale:"+storeID+":"+key); err != nil {
		return fmt.Errorf("advisory lock: %w", err)
	}
	return nil
}

// FindSaleByKey returns the sale already created with this idempotency key.
func FindSaleByKey(ctx context.Context, q db.DBTX, storeID, key string) (id string, hash []byte, err error) {
	err = q.QueryRow(ctx, `SELECT id, request_hash FROM sales WHERE store_id = $1 AND idempotency_key = $2`, storeID, key).Scan(&id, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, domain.ErrNotFound
	}
	if err != nil {
		return "", nil, fmt.Errorf("find sale by key: %w", err)
	}
	return id, hash, nil
}

// NextSaleNumber increments the store's counter for a business day. Runs in
// the checkout transaction, so a rolled-back sale does not consume a number.
func NextSaleNumber(ctx context.Context, tx pgx.Tx, storeID string, day time.Time) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `
		INSERT INTO store_sale_counters (store_id, day, last_number) VALUES ($1, $2::date, 1)
		ON CONFLICT (store_id, day) DO UPDATE SET last_number = store_sale_counters.last_number + 1
		RETURNING last_number`, storeID, day.Format("2006-01-02")).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("next sale number: %w", err)
	}
	return n, nil
}

type SaleWrite struct {
	StoreID, CashierID, SaleNumber, PaymentMethod, IdempotencyKey string
	Subtotal, Discount, NetTotal                                  int64
	RequestHash                                                   []byte
	Notes                                                         *string
	SoldAt                                                        time.Time
}

func InsertSale(ctx context.Context, tx pgx.Tx, s SaleWrite) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO sales (store_id, cashier_user_id, sale_number, subtotal, discount_amount, net_total,
		                   payment_method, idempotency_key, request_hash, notes, sold_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
		s.StoreID, s.CashierID, s.SaleNumber, s.Subtotal, s.Discount, s.NetTotal,
		s.PaymentMethod, s.IdempotencyKey, s.RequestHash, s.Notes, s.SoldAt,
	).Scan(&id)
	if db.IsUniqueViolation(err, "sales_store_idempotency_key") {
		return "", domain.ErrDuplicateIdempotencyKey
	}
	if err != nil {
		return "", fmt.Errorf("insert sale: %w", err)
	}
	return id, nil
}

func InsertSaleItem(ctx context.Context, tx pgx.Tx, storeID, saleID string, it domain.SaleItem) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO sale_items (sale_id, store_id, line_no, product_id, product_name_snapshot, sku_snapshot, unit_snapshot,
		                        unit_scale_snapshot, quantity, unit_price, cost_price_snapshot, line_subtotal)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10, $11, $12)`,
		saleID, storeID, it.LineNo, it.ProductID, it.ProductName, it.SKU, it.Unit, it.UnitScale,
		it.Quantity, it.UnitPrice, it.CostPrice, it.LineSubtotal)
	if err != nil {
		return fmt.Errorf("insert sale item: %w", err)
	}
	return nil
}

const saleSelect = `
	SELECT s.id, s.sale_number, s.status, s.subtotal, s.discount_amount, s.net_total, s.payment_method, s.notes,
	       s.cashier_user_id, cu.name, s.sold_at, s.void_reason, s.voided_by, vu.name, s.voided_at,
	       (SELECT count(*) FROM sale_items i WHERE i.sale_id = s.id)
	FROM sales s
	JOIN users cu ON cu.id = s.cashier_user_id
	LEFT JOIN users vu ON vu.id = s.voided_by`

func scanSale(row pgx.Row) (domain.Sale, error) {
	var s domain.Sale
	var status string
	err := row.Scan(&s.ID, &s.SaleNumber, &status, &s.Subtotal, &s.DiscountAmount, &s.NetTotal, &s.PaymentMethod, &s.Notes,
		&s.CashierID, &s.CashierName, &s.SoldAt, &s.VoidReason, &s.VoidedByID, &s.VoidedByName, &s.VoidedAt, &s.ItemCount)
	s.Status = domain.SaleStatus(status)
	return s, err
}

func saleItems(ctx context.Context, q db.DBTX, storeID, saleID string) ([]domain.SaleItem, error) {
	rows, err := q.Query(ctx, `
		SELECT line_no, product_id, product_name_snapshot, sku_snapshot, unit_snapshot, unit_scale_snapshot,
		       quantity::text, unit_price, cost_price_snapshot, line_subtotal
		FROM sale_items WHERE store_id = $1 AND sale_id = $2 ORDER BY line_no`, storeID, saleID)
	if err != nil {
		return nil, fmt.Errorf("list sale items: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.SaleItem, error) {
		var it domain.SaleItem
		err := r.Scan(&it.LineNo, &it.ProductID, &it.ProductName, &it.SKU, &it.Unit, &it.UnitScale,
			&it.Quantity, &it.UnitPrice, &it.CostPrice, &it.LineSubtotal)
		return it, err
	})
}

// GetSale returns a sale of the store with its items, or ErrNotFound.
func GetSale(ctx context.Context, q db.DBTX, storeID, id string) (domain.Sale, error) {
	s, err := scanSale(q.QueryRow(ctx, saleSelect+" WHERE s.store_id = $1 AND s.id = $2", storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Sale{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Sale{}, fmt.Errorf("get sale: %w", err)
	}
	if s.Items, err = saleItems(ctx, q, storeID, id); err != nil {
		return domain.Sale{}, err
	}
	return s, nil
}

// LockSale row-locks a sale (for void) and loads its items.
func LockSale(ctx context.Context, tx pgx.Tx, storeID, id string) (domain.Sale, error) {
	var status string
	err := tx.QueryRow(ctx, `SELECT status FROM sales WHERE store_id = $1 AND id = $2 FOR UPDATE`, storeID, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Sale{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Sale{}, fmt.Errorf("lock sale: %w", err)
	}
	return GetSale(ctx, tx, storeID, id)
}

func VoidSale(ctx context.Context, tx pgx.Tx, storeID, id, reason, actorID string, at time.Time) error {
	tag, err := tx.Exec(ctx, `
		UPDATE sales SET status = 'VOIDED', void_reason = $3, voided_by = $4, voided_at = $5
		WHERE store_id = $1 AND id = $2 AND status = 'COMPLETED'`, storeID, id, reason, actorID, at)
	if err != nil {
		return fmt.Errorf("void sale: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return domain.ErrAlreadyVoided
	}
	return nil
}

// SaleFilter: From/To are UTC instants derived from store-local dates.
type SaleFilter struct {
	Status        string
	PaymentMethod string
	Number        string
	From, To      *time.Time
	Limit, Offset int
}

func ListSales(ctx context.Context, q db.DBTX, storeID string, f SaleFilter) ([]domain.Sale, int, error) {
	where := []string{"s.store_id = $1"}
	args := []any{storeID}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	if f.Status != "" {
		where = append(where, "s.status = "+arg(f.Status))
	}
	if f.PaymentMethod != "" {
		where = append(where, "s.payment_method = "+arg(f.PaymentMethod))
	}
	if f.Number != "" {
		where = append(where, `s.sale_number LIKE `+arg("%"+escapeLike(strings.ToUpper(f.Number))+"%")+` ESCAPE '\'`)
	}
	if f.From != nil {
		where = append(where, "s.sold_at >= "+arg(*f.From))
	}
	if f.To != nil {
		where = append(where, "s.sold_at < "+arg(*f.To))
	}
	whereSQL := " WHERE " + strings.Join(where, " AND ")
	var total int
	if err := q.QueryRow(ctx, "SELECT count(*) FROM sales s"+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count sales: %w", err)
	}
	rows, err := q.Query(ctx, saleSelect+whereSQL+" ORDER BY s.sold_at DESC, s.id DESC LIMIT "+arg(f.Limit)+" OFFSET "+arg(f.Offset), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list sales: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Sale, error) { return scanSale(r) })
	if err != nil {
		return nil, 0, fmt.Errorf("scan sales: %w", err)
	}
	return list, total, nil
}
