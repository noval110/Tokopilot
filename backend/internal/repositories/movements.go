package repositories

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
)

// Movement is one append-only ledger row. Quantities are canonical NUMERIC text.
type Movement struct {
	StoreID       string
	ProductID     string
	ActorUserID   string
	Type          domain.MovementType
	QuantityDelta string
	StockBefore   string
	StockAfter    string
	ReasonCode    *domain.ReasonCode
	Reason        *string
	ReferenceType *string
	ReferenceID   *string
}

// InsertMovement appends to the ledger. The DB checks stock_after =
// stock_before + delta, sign by type, reason rules, and same-store product.
func InsertMovement(ctx context.Context, q db.DBTX, m Movement) (string, error) {
	var id string
	err := q.QueryRow(ctx, `
		INSERT INTO stock_movements (store_id, product_id, actor_user_id, movement_type, quantity_delta,
		                             stock_before, stock_after, reason_code, reason, reference_type, reference_id)
		VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9, $10, $11)
		RETURNING id`,
		m.StoreID, m.ProductID, m.ActorUserID, string(m.Type), m.QuantityDelta,
		m.StockBefore, m.StockAfter, m.ReasonCode, m.Reason, m.ReferenceType, m.ReferenceID,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert stock movement: %w", err)
	}
	return id, nil
}

// ApplyStockDelta changes current_stock by a signed delta and returns the
// before/after values. The caller MUST hold the row lock (LockProduct) in the
// same transaction so "before" is exact. The CHECK (current_stock >= 0) is the
// last line of defence against negative stock.
func ApplyStockDelta(ctx context.Context, tx pgx.Tx, storeID, productID, delta string) (before, after string, err error) {
	err = tx.QueryRow(ctx, `
		UPDATE products SET current_stock = current_stock + $3::numeric, updated_at = now()
		WHERE store_id = $1 AND id = $2
		RETURNING (current_stock - $3::numeric)::text, current_stock::text`,
		storeID, productID, delta,
	).Scan(&before, &after)
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return "", "", domain.ErrNotFound
	case db.IsCheckViolation(err, "products_current_stock_check"):
		return "", "", domain.ErrInsufficientStock
	case errors.As(err, &pgErr) && pgErr.Code == "22003": // numeric_value_out_of_range
		return "", "", domain.ErrStockOverflow
	case err != nil:
		return "", "", fmt.Errorf("apply stock delta: %w", err)
	}
	return before, after, nil
}

// MovementFilter: From/To are UTC instants already derived from store-local dates.
type MovementFilter struct {
	ProductID string
	Type      string
	From      *time.Time
	To        *time.Time // exclusive
	Limit     int
	Offset    int
}

const movementSelect = `
	SELECT m.id, m.product_id, p.name, p.sku, p.unit, p.unit_scale, m.movement_type,
	       m.quantity_delta::text, m.stock_before::text, m.stock_after::text,
	       m.reason_code, m.reason, m.actor_user_id, u.name, m.reference_type, m.reference_id, m.created_at
	FROM stock_movements m
	JOIN products p ON p.id = m.product_id AND p.store_id = m.store_id
	JOIN users u ON u.id = m.actor_user_id`

func ListMovements(ctx context.Context, q db.DBTX, storeID string, f MovementFilter) ([]domain.StockMovement, int, error) {
	where := []string{"m.store_id = $1"}
	args := []any{storeID}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	if f.ProductID != "" {
		where = append(where, "m.product_id = "+arg(f.ProductID))
	}
	if f.Type != "" {
		where = append(where, "m.movement_type = "+arg(f.Type))
	}
	if f.From != nil {
		where = append(where, "m.created_at >= "+arg(*f.From))
	}
	if f.To != nil {
		where = append(where, "m.created_at < "+arg(*f.To))
	}
	whereSQL := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := q.QueryRow(ctx, "SELECT count(*) FROM stock_movements m"+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count movements: %w", err)
	}
	// seq is the true write order of the ledger (see migration 00003).
	rows, err := q.Query(ctx, movementSelect+whereSQL+" ORDER BY m.seq DESC LIMIT "+arg(f.Limit)+" OFFSET "+arg(f.Offset), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list movements: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.StockMovement, error) { return scanMovement(r) })
	if err != nil {
		return nil, 0, fmt.Errorf("scan movements: %w", err)
	}
	return list, total, nil
}

func scanMovement(row pgx.Row) (domain.StockMovement, error) {
	var m domain.StockMovement
	var typ string
	var reason *string
	err := row.Scan(&m.ID, &m.ProductID, &m.ProductName, &m.ProductSKU, &m.ProductUnit, &m.UnitScale, &typ,
		&m.QuantityDelta, &m.StockBefore, &m.StockAfter, &reason, &m.Note, &m.ActorID, &m.ActorName,
		&m.ReferenceType, &m.ReferenceID, &m.CreatedAt)
	m.Type = domain.MovementType(typ)
	if reason != nil {
		rc := domain.ReasonCode(*reason)
		m.ReasonCode = &rc
	}
	return m, err
}

// GetMovement returns one ledger row of the store by ID.
func GetMovement(ctx context.Context, q db.DBTX, storeID, id string) (domain.StockMovement, error) {
	m, err := scanMovement(q.QueryRow(ctx, movementSelect+" WHERE m.store_id = $1 AND m.id = $2", storeID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.StockMovement{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.StockMovement{}, fmt.Errorf("get movement: %w", err)
	}
	return m, nil
}

// InventorySummary counts active products by stock state (BR-12: OUT is also LOW).
type InventorySummary struct {
	ActiveProducts int
	LowStock       int
	OutOfStock     int
}

func GetInventorySummary(ctx context.Context, q db.DBTX, storeID string) (InventorySummary, error) {
	var s InventorySummary
	err := q.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE current_stock <= min_stock),
		       count(*) FILTER (WHERE current_stock = 0)
		FROM products WHERE store_id = $1 AND is_active`, storeID,
	).Scan(&s.ActiveProducts, &s.LowStock, &s.OutOfStock)
	if err != nil {
		return InventorySummary{}, fmt.Errorf("inventory summary: %w", err)
	}
	return s, nil
}
