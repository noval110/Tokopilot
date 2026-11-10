package server

import (
	"context"
	"strings"
	"sync"
	"testing"
)

func TestRestockUpdatesStockAndLedgerAtomically(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	p := a.createProduct(kopi(map[string]any{"initial_stock": "4", "min_stock": "5"}))
	id := p["id"].(string)
	if p["stock_status"] != "LOW" {
		t.Fatalf("precondition: %v", p)
	}

	r := a.mustStatus(a.do("POST", "/api/v1/inventory/restocks", map[string]any{"product_id": id, "quantity": "20", "note": "  Supplier Pak Budi "}), 201)
	if dig(r.body, "product", "current_stock") != "24.000" || dig(r.body, "product", "stock_status") != "OK" {
		t.Fatalf("product after restock: %s", r.raw)
	}
	m := r.body["movement"].(map[string]any)
	if m["type"] != "RESTOCK" || m["quantity_delta"] != "20.000" || m["stock_before"] != "4.000" || m["stock_after"] != "24.000" ||
		m["note"] != "Supplier Pak Budi" || dig(m, "actor", "name") != "Owner Toko A" {
		t.Fatalf("movement: %v", m)
	}
	assertLedgerReconciles(t, e)
}

func TestStockChangeValidation(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	pcs := a.createProduct(kopi(nil))["id"].(string)
	kg := a.createProduct(map[string]any{"name": "Beras", "unit": "kg", "unit_scale": 3, "cost_price": 1, "selling_price": 2})["id"].(string)

	for _, c := range []struct {
		path  string
		body  map[string]any
		field string
	}{
		{"restocks", map[string]any{"product_id": pcs, "quantity": "0"}, "quantity"},
		{"restocks", map[string]any{"product_id": pcs, "quantity": "-3"}, "quantity"},
		{"restocks", map[string]any{"product_id": pcs, "quantity": "1.5"}, "quantity"}, // pcs is whole units
		{"restocks", map[string]any{"product_id": "", "quantity": "1"}, "product_id"},
		{"restocks", map[string]any{"product_id": pcs, "quantity": "1", "note": strings.Repeat("x", 501)}, "note"},
		{"adjustments", map[string]any{"product_id": pcs, "direction": "IN", "quantity": "1"}, "reason_code"},
		{"adjustments", map[string]any{"product_id": pcs, "direction": "SIDEWAYS", "quantity": "1", "reason_code": "LOST"}, "direction"},
		{"adjustments", map[string]any{"product_id": pcs, "direction": "OUT", "quantity": "1", "reason_code": "OTHER"}, "note"},
		{"adjustments", map[string]any{"product_id": pcs, "direction": "OUT", "quantity": "1", "reason_code": "STOLEN_BY_ALIENS"}, "reason_code"},
	} {
		r := a.mustStatus(a.do("POST", "/api/v1/inventory/"+c.path, c.body), 400)
		if dig(r.body, "error", "details", "fields", c.field) == nil {
			t.Errorf("%s %v: expected field error %q, got %s", c.path, c.body, c.field, r.raw)
		}
	}
	// Fractional restock works for kg.
	r := a.mustStatus(a.do("POST", "/api/v1/inventory/restocks", map[string]any{"product_id": kg, "quantity": 2.125}), 201)
	if dig(r.body, "product", "current_stock") != "2.125" {
		t.Fatalf("kg restock: %s", r.raw)
	}
	// store_id cannot be smuggled in.
	a.mustStatus(a.do("POST", "/api/v1/inventory/restocks", map[string]any{"product_id": pcs, "quantity": "1", "store_id": "x"}), 400)
	assertLedgerReconciles(t, e)
}

func TestAdjustmentOutCannotGoNegative(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	id := a.createProduct(kopi(map[string]any{"initial_stock": "3"}))["id"].(string)

	r := a.mustStatus(a.do("POST", "/api/v1/inventory/adjustments", map[string]any{
		"product_id": id, "direction": "OUT", "quantity": "4", "reason_code": "DAMAGED",
	}), 409)
	if r.code() != "INSUFFICIENT_STOCK" || dig(r.body, "error", "details", "available") != "3.000" || dig(r.body, "error", "details", "requested") != "4.000" {
		t.Fatalf("insufficient: %s", r.raw)
	}
	// Nothing changed: no stock update, no ledger row.
	var n int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM stock_movements WHERE product_id = $1`, id).Scan(&n)
	if n != 1 {
		t.Fatalf("failed adjustment must not write the ledger: %d rows", n)
	}

	r = a.mustStatus(a.do("POST", "/api/v1/inventory/adjustments", map[string]any{
		"product_id": id, "direction": "OUT", "quantity": "3", "reason_code": "OTHER", "note": "Dipakai untuk sampel",
	}), 201)
	if dig(r.body, "product", "current_stock") != "0.000" || dig(r.body, "product", "stock_status") != "OUT" ||
		dig(r.body, "movement", "quantity_delta") != "-3.000" || dig(r.body, "movement", "reason_code") != "OTHER" {
		t.Fatalf("adjust to zero: %s", r.raw)
	}
	r = a.mustStatus(a.do("POST", "/api/v1/inventory/adjustments", map[string]any{
		"product_id": id, "direction": "IN", "quantity": "2", "reason_code": "COUNT_CORRECTION",
	}), 201)
	if dig(r.body, "movement", "type") != "ADJUSTMENT_IN" || dig(r.body, "product", "current_stock") != "2.000" {
		t.Fatalf("adjust in: %s", r.raw)
	}
	assertLedgerReconciles(t, e)
}

// TestConcurrentStockOutNeverOversells fires more concurrent stock-outs than
// there is stock. Row locking must let exactly `stock` of them succeed, the
// rest must get a clean 409 (not a 500), and stock must end at zero.
func TestConcurrentStockOutNeverOversells(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	id := a.createProduct(kopi(map[string]any{"initial_stock": "10"}))["id"].(string)

	const workers = 20
	var wg sync.WaitGroup
	statuses := make(chan int, workers)
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := a.do("POST", "/api/v1/inventory/adjustments", map[string]any{
				"product_id": id, "direction": "OUT", "quantity": "1", "reason_code": "LOST",
			})
			statuses <- r.status
		}()
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for s := range statuses {
		counts[s]++
	}
	if counts[201] != 10 || counts[409] != 10 || len(counts) != 2 {
		t.Fatalf("want 10×201 and 10×409, got %v", counts)
	}
	var stock string
	_ = e.pool.QueryRow(context.Background(), `SELECT current_stock::text FROM products WHERE id = $1`, id).Scan(&stock)
	if stock != "0.000" {
		t.Fatalf("final stock = %s, want 0.000", stock)
	}
	assertLedgerReconciles(t, e)
}

func TestConcurrentMixedChangesReconcile(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	id := a.createProduct(map[string]any{"name": "Beras", "unit": "kg", "unit_scale": 3, "cost_price": 1, "selling_price": 2, "initial_stock": "50"})["id"].(string)

	var wg sync.WaitGroup
	for i := range 30 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if i%2 == 0 {
				a.do("POST", "/api/v1/inventory/restocks", map[string]any{"product_id": id, "quantity": "1.250"})
			} else {
				a.do("POST", "/api/v1/inventory/adjustments", map[string]any{"product_id": id, "direction": "OUT", "quantity": "0.750", "reason_code": "DAMAGED"})
			}
		}()
	}
	wg.Wait()
	var stock string
	_ = e.pool.QueryRow(context.Background(), `SELECT current_stock::text FROM products WHERE id = $1`, id).Scan(&stock)
	// 50 + 15×1.250 − 15×0.750 = 57.500, regardless of interleaving.
	if stock != "57.500" {
		t.Fatalf("final stock = %s, want 57.500", stock)
	}
	assertLedgerReconciles(t, e)
	// Each ledger row chains: stock_before equals the previous row's stock_after.
	var broken int
	_ = e.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM (
		  SELECT stock_before, lag(stock_after) OVER (ORDER BY seq) AS prev
		  FROM stock_movements WHERE product_id = $1) x
		WHERE prev IS NOT NULL AND stock_before <> prev`, id).Scan(&broken)
	if broken != 0 {
		t.Fatalf("%d ledger rows do not chain", broken)
	}
}

func TestArchivedProductStockIsFrozen(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	id := a.createProduct(kopi(nil))["id"].(string)
	a.mustStatus(a.do("POST", "/api/v1/products/"+id+"/archive", nil), 200)
	r := a.mustStatus(a.do("POST", "/api/v1/inventory/restocks", map[string]any{"product_id": id, "quantity": "1"}), 409)
	if r.code() != "PRODUCT_ARCHIVED" {
		t.Fatalf("archived restock: %s", r.raw)
	}
}

func TestInventoryTenantIsolationAndRoles(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	idB := b.createProduct(kopi(map[string]any{"name": "Rahasia B"}))["id"].(string)
	idA := a.createProduct(kopi(nil))["id"].(string)

	a.mustStatus(a.do("POST", "/api/v1/inventory/restocks", map[string]any{"product_id": idB, "quantity": "100"}), 404)
	a.mustStatus(a.do("POST", "/api/v1/inventory/adjustments", map[string]any{"product_id": idB, "direction": "OUT", "quantity": "1", "reason_code": "LOST"}), 404)
	if got := b.mustStatus(b.do("GET", "/api/v1/products/"+idB, nil), 200).body["current_stock"]; got != "24.000" {
		t.Fatalf("store B stock changed: %v", got)
	}
	for _, q := range []string{"", "?product_id=" + idB} {
		r := a.mustStatus(a.do("GET", "/api/v1/inventory/movements"+q, nil), 200)
		if strings.Contains(r.raw, "Rahasia") || strings.Contains(r.raw, idB) {
			t.Fatalf("store A sees store B movements (%s): %s", q, r.raw)
		}
	}
	if s := a.mustStatus(a.do("GET", "/api/v1/inventory/summary", nil), 200).body; s["active_products"] != float64(1) {
		t.Fatalf("summary must count only store A: %v", s)
	}

	a.mustStatus(a.do("POST", "/api/v1/settings/team", map[string]any{"name": "Kasir", "email": "kasir@toko.id", "password": "kasir-12345"}), 201)
	staff := e.client(t)
	staff.mustStatus(staff.do("POST", "/api/v1/auth/login", map[string]any{"email": "kasir@toko.id", "password": "kasir-12345"}), 200)
	staff.mustStatus(staff.do("GET", "/api/v1/inventory/movements", nil), 200)
	staff.mustStatus(staff.do("GET", "/api/v1/inventory/summary", nil), 200)
	staff.mustStatus(staff.do("POST", "/api/v1/inventory/restocks", map[string]any{"product_id": idA, "quantity": "1"}), 403)
	staff.mustStatus(staff.do("POST", "/api/v1/inventory/adjustments", map[string]any{"product_id": idA, "direction": "IN", "quantity": "1", "reason_code": "LOST"}), 403)
}

func TestMovementListFiltersAndStoreTimezone(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	p1 := a.createProduct(kopi(nil))["id"].(string)
	p2 := a.createProduct(map[string]any{"name": "Teh", "unit": "pcs", "cost_price": 1, "selling_price": 2, "initial_stock": "5"})["id"].(string)
	a.mustStatus(a.do("POST", "/api/v1/inventory/restocks", map[string]any{"product_id": p1, "quantity": "6"}), 201)
	a.mustStatus(a.do("POST", "/api/v1/inventory/adjustments", map[string]any{"product_id": p1, "direction": "OUT", "quantity": "2", "reason_code": "EXPIRED"}), 201)

	total := func(q string) float64 {
		t.Helper()
		return dig(a.mustStatus(a.do("GET", "/api/v1/inventory/movements"+q, nil), 200).body, "meta", "total").(float64)
	}
	if total("") != 4 || total("?product_id="+p1) != 3 || total("?product_id="+p2) != 1 || total("?type=RESTOCK") != 1 {
		t.Fatalf("filters: all=%v p1=%v p2=%v restock=%v", total(""), total("?product_id="+p1), total("?product_id="+p2), total("?type=RESTOCK"))
	}
	first := a.mustStatus(a.do("GET", "/api/v1/inventory/movements?per_page=1", nil), 200).body["data"].([]any)[0].(map[string]any)
	if first["type"] != "ADJUSTMENT_OUT" || first["reason_code"] != "EXPIRED" {
		t.Fatalf("newest first: %v", first)
	}

	// Two rows either side of midnight in Jakarta (UTC+7): 16:30Z = 23:30 WIB on the 9th; 17:30Z = 00:30 WIB on the 10th.
	ctx := context.Background()
	for _, ts := range []string{"2026-11-09T16:30:00Z", "2026-11-09T17:30:00Z"} {
		if _, err := e.pool.Exec(ctx, `
			INSERT INTO stock_movements (store_id, product_id, actor_user_id, movement_type, quantity_delta, stock_before, stock_after, created_at)
			SELECT store_id, id, created_by, 'RESTOCK', 1, 0, 1, $2 FROM products WHERE id = $1`, p2, ts); err != nil {
			t.Fatal(err)
		}
	}
	if got := total("?product_id=" + p2 + "&from=2026-11-10&to=2026-11-10&type=RESTOCK"); got != 1 {
		t.Fatalf("10 Nov (WIB) should include only 00:30 WIB row, got %v", got)
	}
	if got := total("?product_id=" + p2 + "&from=2026-11-09&to=2026-11-09&type=RESTOCK"); got != 1 {
		t.Fatalf("9 Nov (WIB) should include only 23:30 WIB row, got %v", got)
	}

	for _, bad := range []string{"?from=2026-11-10&to=2026-11-01", "?from=2025-01-01&to=2026-11-10", "?from=10-11-2026", "?type=STEAL", "?product_id=x"} {
		a.mustStatus(a.do("GET", "/api/v1/inventory/movements"+bad, nil), 400)
	}
	a.mustStatus(a.do("GET", "/api/v1/inventory/movements?from=2025-11-10&to=2026-11-10", nil), 200) // exactly 366 days inclusive
}

func TestInventorySummaryCounts(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	a.createProduct(kopi(map[string]any{"initial_stock": "24", "min_stock": "5"}))                     // OK
	a.createProduct(kopi(map[string]any{"sku": "B", "initial_stock": "5", "min_stock": "5"}))          // LOW (equal)
	a.createProduct(kopi(map[string]any{"sku": "C", "initial_stock": "0", "min_stock": "0"}))          // OUT (and LOW)
	archived := a.createProduct(kopi(map[string]any{"sku": "D", "initial_stock": "0"}))["id"].(string) // excluded
	a.mustStatus(a.do("POST", "/api/v1/products/"+archived+"/archive", nil), 200)

	s := a.mustStatus(a.do("GET", "/api/v1/inventory/summary", nil), 200).body
	if s["active_products"] != float64(3) || s["low_stock"] != float64(2) || s["out_of_stock"] != float64(1) {
		t.Fatalf("summary: %v", s)
	}
}

func TestLedgerAdjustmentReasonEnforcedByDatabase(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	id := a.createProduct(kopi(nil))["id"].(string)
	ctx := context.Background()
	for _, stmt := range []string{
		`INSERT INTO stock_movements (store_id, product_id, actor_user_id, movement_type, quantity_delta, stock_before, stock_after)
		 SELECT store_id, id, created_by, 'ADJUSTMENT_IN', 1, 24, 25 FROM products WHERE id = $1`,
		`INSERT INTO stock_movements (store_id, product_id, actor_user_id, movement_type, quantity_delta, stock_before, stock_after, reason_code)
		 SELECT store_id, id, created_by, 'ADJUSTMENT_IN', 1, 24, 25, 'OTHER' FROM products WHERE id = $1`,
	} {
		if _, err := e.pool.Exec(ctx, stmt, id); err == nil || !strings.Contains(err.Error(), "stock_movements_adjustment_reason") {
			t.Errorf("DB must reject adjustment without proper reason, got %v", err)
		}
	}
}
