package db

import (
	"context"
	"fmt"
)

// LedgerIssue is one broken invariant. Only ids and quantities — never names or PII —
// so the report is safe to paste into an incident ticket.
type LedgerIssue struct {
	Check     string `json:"check"`
	StoreID   string `json:"store_id"`
	ProductID string `json:"product_id"`
	Detail    string `json:"detail"`
}

type LedgerReport struct {
	Products  int           `json:"products"`
	Movements int           `json:"movements"`
	Sales     int           `json:"sales"`
	Issues    []LedgerIssue `json:"issues"`
}

func (r LedgerReport) OK() bool { return len(r.Issues) == 0 }

// ledgerChecks are the stock invariants of PRD BR-05/BR-07 and the release gate
// (§16.3 "reconciliation stok ledger dan current_stock"). Each query returns
// (store_id, product_id, detail) rows for violations only.
var ledgerChecks = []struct{ name, sql string }{
	{"current_stock_equals_sum_of_movements", `
		SELECT p.store_id::text, p.id::text,
		       format('current_stock=%s sum(delta)=%s', p.current_stock, COALESCE(SUM(m.quantity_delta), 0))
		FROM products p
		LEFT JOIN stock_movements m ON m.product_id = p.id AND m.store_id = p.store_id
		GROUP BY p.store_id, p.id, p.current_stock
		HAVING p.current_stock <> COALESCE(SUM(m.quantity_delta), 0)`},
	{"current_stock_equals_last_stock_after", `
		SELECT p.store_id::text, p.id::text, format('current_stock=%s last.stock_after=%s (seq %s)', p.current_stock, l.stock_after, l.seq)
		FROM products p
		JOIN LATERAL (SELECT stock_after, seq FROM stock_movements m
		              WHERE m.product_id = p.id AND m.store_id = p.store_id ORDER BY seq DESC LIMIT 1) l ON true
		WHERE l.stock_after <> p.current_stock`},
	// Products created with zero stock legitimately have no INITIAL row (delta <> 0);
	// when one exists it must be unique and come first.
	{"initial_movement_is_unique_and_first", `
		SELECT store_id::text, product_id::text, format('INITIAL at seq %s is movement #%s of the product', seq, pos)
		FROM (SELECT store_id, product_id, seq, movement_type,
		             row_number() OVER (PARTITION BY product_id ORDER BY seq) AS pos
		      FROM stock_movements) x
		WHERE movement_type = 'INITIAL' AND pos <> 1`},
	{"movement_chain_is_continuous", `
		SELECT store_id::text, product_id::text,
		       format('seq %s: stock_before=%s, previous stock_after=%s', seq, stock_before, COALESCE(prev::text, 'none (first movement must start at 0)'))
		FROM (SELECT store_id, product_id, seq, stock_before,
		             LAG(stock_after) OVER (PARTITION BY product_id ORDER BY seq) AS prev
		      FROM stock_movements) x
		WHERE (prev IS NULL AND stock_before <> 0) OR (prev IS NOT NULL AND prev <> stock_before)`},
	{"sales_match_their_movements", `
		SELECT s.store_id::text, si.product_id::text, format('sale %s (%s): %s', s.id, s.status, problem)
		FROM sales s
		JOIN sale_items si ON si.sale_id = s.id
		CROSS JOIN LATERAL (
		  SELECT CASE
		    WHEN NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.reference_id = s.id AND m.product_id = si.product_id
		                     AND m.movement_type = 'SALE' AND m.quantity_delta = -si.quantity) THEN 'missing SALE movement'
		    WHEN s.status = 'VOIDED' AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.reference_id = s.id
		                     AND m.product_id = si.product_id AND m.movement_type = 'SALE_VOID' AND m.quantity_delta = si.quantity)
		      THEN 'voided without SALE_VOID reversal'
		    WHEN s.status = 'COMPLETED' AND EXISTS (SELECT 1 FROM stock_movements m WHERE m.reference_id = s.id
		                     AND m.product_id = si.product_id AND m.movement_type = 'SALE_VOID') THEN 'completed sale has a reversal'
		  END AS problem) c
		WHERE c.problem IS NOT NULL`},
}

// VerifyLedger checks every store's stock ledger against current stock and sales.
// It only reads; run it after restores, migrations or incidents.
func VerifyLedger(ctx context.Context, q DBTX) (LedgerReport, error) {
	rep := LedgerReport{Issues: []LedgerIssue{}}
	if err := q.QueryRow(ctx, `SELECT (SELECT count(*) FROM products), (SELECT count(*) FROM stock_movements), (SELECT count(*) FROM sales)`).
		Scan(&rep.Products, &rep.Movements, &rep.Sales); err != nil {
		return rep, fmt.Errorf("count: %w", err)
	}
	for _, c := range ledgerChecks {
		rows, err := q.Query(ctx, c.sql)
		if err != nil {
			return rep, fmt.Errorf("%s: %w", c.name, err)
		}
		for rows.Next() {
			is := LedgerIssue{Check: c.name}
			if err := rows.Scan(&is.StoreID, &is.ProductID, &is.Detail); err != nil {
				rows.Close()
				return rep, fmt.Errorf("%s: %w", c.name, err)
			}
			rep.Issues = append(rep.Issues, is)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return rep, fmt.Errorf("%s: %w", c.name, err)
		}
	}
	return rep, nil
}
