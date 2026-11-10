package server

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"tokopilot/backend/internal/db"
)

func issuesBy(rep db.LedgerReport) map[string]int {
	m := map[string]int{}
	for _, is := range rep.Issues {
		m[is.Check]++
	}
	return m
}

// Release gate §16.3: ledger and current_stock reconcile after every kind of
// stock change — and the verifier really detects each kind of corruption.
func TestLedgerReconciliationAfterRealOperations(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	kopiID := a.createProduct(kopi(map[string]any{"initial_stock": "50"}))["id"].(string)
	beras := a.createProduct(map[string]any{"name": "Beras", "unit": "kg", "unit_scale": 3, "cost_price": 10000, "selling_price": 12333, "initial_stock": "20.5", "min_stock": "2"})["id"].(string)
	b.createProduct(kopi(nil))
	a.createProduct(kopi(map[string]any{"sku": "zero-1", "initial_stock": "0"})) // no INITIAL row by design

	a.mustStatus(a.do("POST", "/api/v1/inventory/restocks", map[string]any{"product_id": kopiID, "quantity": "10"}), 201)
	a.mustStatus(a.do("POST", "/api/v1/inventory/adjustments", map[string]any{"product_id": beras, "direction": "OUT", "quantity": "0.125", "reason_code": "DAMAGED"}), 201)
	a.mustStatus(a.do("POST", "/api/v1/inventory/adjustments", map[string]any{"product_id": kopiID, "direction": "IN", "quantity": "1", "reason_code": "COUNT_CORRECTION"}), 201)
	voided := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("ledger-sale-01", 0, line(kopiID, "2"), line(beras, "1.5"))), 201).body["id"].(string)
	a.mustStatus(a.do("POST", "/api/v1/sales/"+voided+"/void", map[string]any{"reason": "Salah input"}), 200)

	var wg sync.WaitGroup
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a.do("POST", "/api/v1/sales", checkout(fmt.Sprintf("ledger-par-%02d", i), 0, line(kopiID, "3"), line(beras, "0.333")))
		}()
	}
	wg.Wait()

	rep, err := db.VerifyLedger(context.Background(), e.pool)
	if err != nil {
		t.Fatal(err)
	}
	if !rep.OK() || rep.Products != 4 || rep.Sales != 9 {
		t.Fatalf("clean ledger should reconcile: %+v", rep)
	}

	corruptions := []struct {
		name, sql string
		want      string
	}{
		{"current_stock edited directly", `UPDATE products SET current_stock = current_stock + 1 WHERE id = '` + kopiID + `'`, "current_stock_equals_sum_of_movements"},
		{"INITIAL movement deleted", `DELETE FROM stock_movements WHERE product_id = '` + beras + `' AND movement_type = 'INITIAL'`, "movement_chain_is_continuous"},
		{"later movement relabelled INITIAL", `UPDATE stock_movements SET movement_type = 'INITIAL'
			WHERE product_id = '` + kopiID + `' AND movement_type = 'RESTOCK'`, "initial_movement_is_unique_and_first"},
		{"movement shifted out of the chain", `UPDATE stock_movements SET stock_before = stock_before + 1, stock_after = stock_after + 1
			WHERE seq = (SELECT seq FROM stock_movements WHERE product_id = '` + kopiID + `' AND movement_type = 'RESTOCK')`, "movement_chain_is_continuous"},
		{"void reversal deleted", `DELETE FROM stock_movements WHERE reference_id = '` + voided + `' AND movement_type = 'SALE_VOID'`, "sales_match_their_movements"},
		{"last movement disagrees", `UPDATE stock_movements SET stock_before = stock_before + 5, stock_after = stock_after + 5
			WHERE seq = (SELECT max(seq) FROM stock_movements WHERE product_id = '` + kopiID + `')`, "current_stock_equals_last_stock_after"},
	}
	for _, c := range corruptions {
		t.Run(c.name, func(t *testing.T) {
			ctx := context.Background()
			tx, err := e.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = tx.Rollback(ctx) }()
			// Bypass the append-only/immutability triggers to simulate corruption (test superuser only).
			if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(ctx, c.sql); err != nil {
				t.Fatal(err)
			}
			rep, err := db.VerifyLedger(ctx, tx)
			if err != nil {
				t.Fatal(err)
			}
			if issuesBy(rep)[c.want] == 0 {
				t.Fatalf("verifier missed %q: %+v", c.want, rep.Issues)
			}
		})
	}
}
