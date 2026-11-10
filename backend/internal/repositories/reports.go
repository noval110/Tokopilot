package repositories

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"tokopilot/backend/internal/db"
)

// Reporting queries. Every aggregate:
//   - is scoped to one store_id,
//   - counts COMPLETED sales only (BR-10: voided sales never enter totals),
//   - uses [from, to) UTC instants derived from store-local dates (BR-13).

type SalesTotals struct {
	GrossSales       int64 // Σ subtotal
	DiscountTotal    int64 // Σ discount_amount
	NetSales         int64 // Σ net_total
	TransactionCount int64
	COGS             int64 // Σ round_half_up(cost_price_snapshot × quantity)
	VoidedCount      int64
	VoidedNet        int64
}

func GetSalesTotals(ctx context.Context, q db.DBTX, storeID string, from, to time.Time) (SalesTotals, error) {
	var t SalesTotals
	err := q.QueryRow(ctx, `
		WITH s AS (
			SELECT id, status, subtotal, discount_amount, net_total FROM sales
			WHERE store_id = $1 AND sold_at >= $2 AND sold_at < $3
		)
		SELECT
			COALESCE(sum(subtotal)        FILTER (WHERE status = 'COMPLETED'), 0)::bigint,
			COALESCE(sum(discount_amount) FILTER (WHERE status = 'COMPLETED'), 0)::bigint,
			COALESCE(sum(net_total)       FILTER (WHERE status = 'COMPLETED'), 0)::bigint,
			count(*)                      FILTER (WHERE status = 'COMPLETED'),
			-- round() on positive NUMERIC rounds half away from zero = half-up (ADR-0005)
			COALESCE((SELECT sum(round(i.cost_price_snapshot * i.quantity))
			          FROM sale_items i JOIN s ON s.id = i.sale_id
			          WHERE i.store_id = $1 AND s.status = 'COMPLETED'), 0)::bigint,
			count(*)                      FILTER (WHERE status = 'VOIDED'),
			COALESCE(sum(net_total)       FILTER (WHERE status = 'VOIDED'), 0)::bigint
		FROM s`, storeID, from, to,
	).Scan(&t.GrossSales, &t.DiscountTotal, &t.NetSales, &t.TransactionCount, &t.COGS, &t.VoidedCount, &t.VoidedNet)
	if err != nil {
		return SalesTotals{}, fmt.Errorf("sales totals: %w", err)
	}
	return t, nil
}

type DailySales struct {
	Day              time.Time // local calendar date (midnight UTC carrier)
	NetSales         int64
	TransactionCount int64
}

// GetDailySales returns one row per local day in [fromDay, toDay], zero-filled.
func GetDailySales(ctx context.Context, q db.DBTX, storeID, timezone string, fromDay, toDay time.Time, from, to time.Time) ([]DailySales, error) {
	rows, err := q.Query(ctx, `
		WITH days AS (
			SELECT d::date AS day FROM generate_series($4::date, $5::date, interval '1 day') d
		), agg AS (
			SELECT (sold_at AT TIME ZONE $6)::date AS day, sum(net_total)::bigint AS net, count(*) AS n
			FROM sales
			WHERE store_id = $1 AND status = 'COMPLETED' AND sold_at >= $2 AND sold_at < $3
			GROUP BY 1
		)
		SELECT days.day, COALESCE(agg.net, 0), COALESCE(agg.n, 0)
		FROM days LEFT JOIN agg ON agg.day = days.day
		ORDER BY days.day`,
		storeID, from, to, fromDay.Format("2006-01-02"), toDay.Format("2006-01-02"), timezone)
	if err != nil {
		return nil, fmt.Errorf("daily sales: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DailySales, error) {
		var d DailySales
		err := r.Scan(&d.Day, &d.NetSales, &d.TransactionCount)
		return d, err
	})
}

type TopProduct struct {
	ProductID    *string
	Name         string
	SKU          *string
	Unit         string
	QuantitySold string // NUMERIC text
	Revenue      int64  // Σ line_subtotal (before transaction-level discount)
	Transactions int64
}

// GetTopProducts ranks products by revenue, then quantity, then name and id,
// so the order is fully deterministic. The current product name is shown when
// the product still exists, else the latest snapshot.
func GetTopProducts(ctx context.Context, q db.DBTX, storeID string, from, to time.Time, limit int) ([]TopProduct, error) {
	rows, err := q.Query(ctx, `
		WITH lines AS (
			SELECT i.product_id, i.product_name_snapshot, i.sku_snapshot, i.unit_snapshot, i.quantity, i.line_subtotal, i.sale_id, s.sold_at
			FROM sale_items i JOIN sales s ON s.id = i.sale_id AND s.store_id = i.store_id
			WHERE i.store_id = $1 AND s.status = 'COMPLETED' AND s.sold_at >= $2 AND s.sold_at < $3
		), grouped AS (
			SELECT product_id,
			       (array_agg(product_name_snapshot ORDER BY sold_at DESC))[1] AS snap_name,
			       (array_agg(sku_snapshot ORDER BY sold_at DESC))[1]          AS snap_sku,
			       (array_agg(unit_snapshot ORDER BY sold_at DESC))[1]         AS snap_unit,
			       sum(quantity) AS qty, sum(line_subtotal)::bigint AS revenue, count(DISTINCT sale_id) AS n
			FROM lines GROUP BY product_id
		)
		SELECT g.product_id, COALESCE(p.name, g.snap_name), COALESCE(p.sku, g.snap_sku), COALESCE(p.unit, g.snap_unit),
		       g.qty::numeric(14,3)::text, g.revenue, g.n
		FROM grouped g LEFT JOIN products p ON p.id = g.product_id AND p.store_id = $1
		ORDER BY g.revenue DESC, g.qty DESC, COALESCE(p.name, g.snap_name), g.product_id
		LIMIT $4`, storeID, from, to, limit)
	if err != nil {
		return nil, fmt.Errorf("top products: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (TopProduct, error) {
		var t TopProduct
		err := r.Scan(&t.ProductID, &t.Name, &t.SKU, &t.Unit, &t.QuantitySold, &t.Revenue, &t.Transactions)
		return t, err
	})
}

type PaymentBreakdown struct {
	Method           string
	TransactionCount int64
	NetSales         int64
}

func GetPaymentBreakdown(ctx context.Context, q db.DBTX, storeID string, from, to time.Time) ([]PaymentBreakdown, error) {
	rows, err := q.Query(ctx, `
		SELECT payment_method, count(*), sum(net_total)::bigint FROM sales
		WHERE store_id = $1 AND status = 'COMPLETED' AND sold_at >= $2 AND sold_at < $3
		GROUP BY payment_method ORDER BY sum(net_total) DESC, payment_method`, storeID, from, to)
	if err != nil {
		return nil, fmt.Errorf("payment breakdown: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PaymentBreakdown, error) {
		var p PaymentBreakdown
		err := r.Scan(&p.Method, &p.TransactionCount, &p.NetSales)
		return p, err
	})
}

// ExportRow is one transaction line of the CSV export (voided included, with status).
type ExportRow struct {
	SaleNumber, Status, PaymentMethod, Cashier string
	SoldAt                                     time.Time
	ItemCount                                  int64
	Subtotal, Discount, NetTotal               int64
	VoidReason                                 *string
}

// StreamSalesExport calls fn for each sale in the range, oldest first.
func StreamSalesExport(ctx context.Context, q db.DBTX, storeID string, from, to time.Time, fn func(ExportRow) error) error {
	rows, err := q.Query(ctx, `
		SELECT s.sale_number, s.status, s.payment_method, u.name, s.sold_at,
		       (SELECT count(*) FROM sale_items i WHERE i.sale_id = s.id), s.subtotal, s.discount_amount, s.net_total, s.void_reason
		FROM sales s JOIN users u ON u.id = s.cashier_user_id
		WHERE s.store_id = $1 AND s.sold_at >= $2 AND s.sold_at < $3
		ORDER BY s.sold_at, s.id`, storeID, from, to)
	if err != nil {
		return fmt.Errorf("export sales: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var r ExportRow
		if err := rows.Scan(&r.SaleNumber, &r.Status, &r.PaymentMethod, &r.Cashier, &r.SoldAt, &r.ItemCount,
			&r.Subtotal, &r.Discount, &r.NetTotal, &r.VoidReason); err != nil {
			return fmt.Errorf("scan export row: %w", err)
		}
		if err := fn(r); err != nil {
			return err
		}
	}
	return rows.Err()
}
