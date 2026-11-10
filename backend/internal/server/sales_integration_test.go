package server

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

var saleNumberRe = regexp.MustCompile(`^TP-\d{8}-\d{4}$`)

func checkout(key string, discount int, items ...map[string]any) map[string]any {
	return map[string]any{"idempotency_key": key, "items": items, "discount_amount": discount, "payment_method": "CASH"}
}

func line(id string, qty any) map[string]any {
	return map[string]any{"product_id": id, "quantity": qty}
}

func stockOf(t *testing.T, e *env, id string) string {
	t.Helper()
	var s string
	if err := e.pool.QueryRow(context.Background(), `SELECT current_stock::text FROM products WHERE id = $1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func count(t *testing.T, e *env, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestCheckoutHappyPath(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	kp := a.createProduct(kopi(nil))["id"].(string) // 68.000, stock 24
	beras := a.createProduct(map[string]any{"name": "Beras", "sku": "BRS", "unit": "kg", "unit_scale": 3, "cost_price": 10000, "selling_price": 12333, "initial_stock": "10"})["id"].(string)

	r := a.mustStatus(a.do("POST", "/api/v1/sales", map[string]any{
		"idempotency_key": "key-happy-0001", "discount_amount": 5000, "payment_method": "QRIS", "notes": " Pelanggan tetap ",
		"items": []any{line(kp, "2"), line(beras, "1.5")},
	}), 201)
	s := r.body
	if !saleNumberRe.MatchString(s["sale_number"].(string)) || !strings.HasSuffix(s["sale_number"].(string), "-0001") {
		t.Fatalf("sale number: %v", s["sale_number"])
	}
	// 2 × 68.000 = 136.000; 1,5 × 12.333 = 18.499,5 → 18.500 (half-up); subtotal 154.500; net 149.500
	if s["subtotal"] != float64(154500) || s["discount_amount"] != float64(5000) || s["net_total"] != float64(149500) ||
		s["status"] != "COMPLETED" || s["payment_method"] != "QRIS" || s["notes"] != "Pelanggan tetap" || s["item_count"] != float64(2) {
		t.Fatalf("totals: %s", r.raw)
	}
	items := s["items"].([]any)
	if items[1].(map[string]any)["line_subtotal"] != float64(18500) || items[0].(map[string]any)["unit_price"] != float64(68000) {
		t.Fatalf("items: %v", items)
	}
	if strings.Contains(r.raw, "cost_price") {
		t.Fatal("sale response must not expose cost snapshots")
	}
	if stockOf(t, e, kp) != "22.000" || stockOf(t, e, beras) != "8.500" {
		t.Fatalf("stock: kopi=%s beras=%s", stockOf(t, e, kp), stockOf(t, e, beras))
	}
	if n := count(t, e, `SELECT count(*) FROM stock_movements WHERE movement_type = 'SALE' AND reference_type = 'SALE' AND reference_id = $1`, s["id"]); n != 2 {
		t.Fatalf("SALE movements = %d", n)
	}
	// The cashier is recorded; cost snapshot stored for reports.
	if dig(s, "cashier", "name") != "Owner Toko A" ||
		count(t, e, `SELECT count(*) FROM sale_items WHERE sale_id = $1 AND cost_price_snapshot = 52000`, s["id"]) != 1 {
		t.Fatalf("cashier / cost snapshot: %s", r.raw)
	}
	// Second sale the same day gets the next number.
	r2 := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-happy-0002", 0, line(kp, 1))), 201)
	if !strings.HasSuffix(r2.body["sale_number"].(string), "-0002") {
		t.Fatalf("second number: %v", r2.body["sale_number"])
	}
	assertLedgerReconciles(t, e)
}

func TestCheckoutRejectsClientPricesAndBadInput(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	kp := a.createProduct(kopi(nil))["id"].(string)

	// The client cannot dictate prices: unknown fields are rejected outright.
	a.mustStatus(a.do("POST", "/api/v1/sales", map[string]any{
		"idempotency_key": "key-price-0001", "payment_method": "CASH",
		"items": []any{map[string]any{"product_id": kp, "quantity": "1", "unit_price": 1}},
	}), 400)
	a.mustStatus(a.do("POST", "/api/v1/sales", map[string]any{
		"idempotency_key": "key-price-0002", "payment_method": "CASH", "subtotal": 1, "items": []any{line(kp, "1")},
	}), 400)

	for _, c := range []struct {
		body  map[string]any
		field string
	}{
		{map[string]any{"idempotency_key": "short", "payment_method": "CASH", "items": []any{line(kp, "1")}}, "idempotency_key"},
		{map[string]any{"idempotency_key": "key-bad-00001", "payment_method": "CASH", "items": []any{}}, "items"},
		{map[string]any{"idempotency_key": "key-bad-00002", "payment_method": "BITCOIN", "items": []any{line(kp, "1")}}, "payment_method"},
		{map[string]any{"idempotency_key": "key-bad-00003", "payment_method": "CASH", "items": []any{line(kp, "1"), line(kp, "2")}}, "items"},
		{map[string]any{"idempotency_key": "key-bad-00004", "payment_method": "CASH", "items": []any{line(kp, "1.5")}}, "items.0.quantity"},
		{map[string]any{"idempotency_key": "key-bad-00005", "payment_method": "CASH", "items": []any{line(kp, "0")}}, "items.0.quantity"},
		{map[string]any{"idempotency_key": "key-bad-00006", "payment_method": "CASH", "discount_amount": -1, "items": []any{line(kp, "1")}}, "discount_amount"},
		{map[string]any{"idempotency_key": "key-bad-00007", "payment_method": "CASH", "discount_amount": 68001, "items": []any{line(kp, "1")}}, "discount_amount"},
		{map[string]any{"idempotency_key": "key-bad-00008", "payment_method": "CASH", "discount_amount": 100.5, "items": []any{line(kp, "1")}}, "discount_amount"},
	} {
		r := a.mustStatus(a.do("POST", "/api/v1/sales", c.body), 400)
		if dig(r.body, "error", "details", "fields", c.field) == nil {
			t.Errorf("%v: expected field %q, got %s", c.body, c.field, r.raw)
		}
	}
	// Discount equal to subtotal is allowed (net 0).
	r := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-free-00001", 68000, line(kp, 1))), 201)
	if r.body["net_total"] != float64(0) {
		t.Fatalf("full discount: %s", r.raw)
	}
	if count(t, e, `SELECT count(*) FROM sales`) != 1 {
		t.Fatal("rejected requests must not create sales")
	}
}

func TestCheckoutInsufficientStockRollsBackEverything(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	ok := a.createProduct(kopi(nil))["id"].(string)                                                                                                                 // 24
	short := a.createProduct(map[string]any{"name": "Gula", "sku": "GLA", "unit": "pcs", "cost_price": 1, "selling_price": 2, "initial_stock": "1"})["id"].(string) // 1

	r := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-short-0001", 0, line(ok, 2), line(short, 3))), 409)
	if r.code() != "INSUFFICIENT_STOCK" || dig(r.body, "error", "details", "product_id") != short ||
		dig(r.body, "error", "details", "available") != "1.000" || dig(r.body, "error", "details", "requested") != "3.000" {
		t.Fatalf("insufficient: %s", r.raw)
	}
	// FR-SALE-06: nothing at all was written — not even for the first, valid line.
	if stockOf(t, e, ok) != "24.000" || stockOf(t, e, short) != "1.000" ||
		count(t, e, `SELECT count(*) FROM sales`) != 0 || count(t, e, `SELECT count(*) FROM sale_items`) != 0 ||
		count(t, e, `SELECT count(*) FROM stock_movements WHERE movement_type = 'SALE'`) != 0 ||
		count(t, e, `SELECT count(*) FROM store_sale_counters`) != 0 {
		t.Fatal("failed checkout left partial writes")
	}
	// The same key can be used once the cart is fixed (nothing was stored under it).
	r = a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-short-0001", 0, line(ok, 2), line(short, 1))), 201)
	if !strings.HasSuffix(r.body["sale_number"].(string), "-0001") {
		t.Fatalf("rolled-back sale must not consume a receipt number: %v", r.body["sale_number"])
	}
	assertLedgerReconciles(t, e)
}

func TestCheckoutIdempotency(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	kp := a.createProduct(kopi(nil))["id"].(string)

	body := checkout("key-idem-00001", 0, line(kp, 2))
	first := a.mustStatus(a.do("POST", "/api/v1/sales", body), 201)
	again := a.mustStatus(a.do("POST", "/api/v1/sales", body), 200)
	if again.body["id"] != first.body["id"] || again.header.Get("Idempotent-Replayed") != "true" {
		t.Fatalf("replay must return the same sale: %s", again.raw)
	}
	if stockOf(t, e, kp) != "22.000" {
		t.Fatalf("stock decremented more than once: %s", stockOf(t, e, kp))
	}
	// Same key, different cart → conflict, nothing written.
	r := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-idem-00001", 0, line(kp, 5))), 409)
	if r.code() != "IDEMPOTENCY_KEY_REUSED" || stockOf(t, e, kp) != "22.000" {
		t.Fatalf("key reuse: %s", r.raw)
	}
	// Keys are per store: another store may use the same key.
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	kb := b.createProduct(kopi(nil))["id"].(string)
	b.mustStatus(b.do("POST", "/api/v1/sales", checkout("key-idem-00001", 0, line(kb, 1))), 201)
}

func TestConcurrentDuplicateSubmitsCreateOneSale(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	kp := a.createProduct(kopi(nil))["id"].(string)
	body := checkout("key-double-click-1", 0, line(kp, 3))

	var wg sync.WaitGroup
	results := make(chan resp, 10)
	for range 10 {
		wg.Add(1)
		go func() { defer wg.Done(); results <- a.do("POST", "/api/v1/sales", body) }()
	}
	wg.Wait()
	close(results)
	ids := map[any]bool{}
	created := 0
	for r := range results {
		if r.status != 201 && r.status != 200 {
			t.Fatalf("unexpected status %d: %s", r.status, r.raw)
		}
		if r.status == 201 {
			created++
		}
		ids[r.body["id"]] = true
	}
	if created != 1 || len(ids) != 1 || count(t, e, `SELECT count(*) FROM sales`) != 1 || stockOf(t, e, kp) != "21.000" {
		t.Fatalf("double submit: created=%d distinct=%d sales=%d stock=%s", created, len(ids), count(t, e, `SELECT count(*) FROM sales`), stockOf(t, e, kp))
	}
	assertLedgerReconciles(t, e)
}

func TestConcurrentCheckoutOfLastUnit(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	last := a.createProduct(kopi(map[string]any{"initial_stock": "1"}))["id"].(string)
	other := a.createProduct(map[string]any{"name": "Teh", "sku": "TEH", "unit": "pcs", "cost_price": 1, "selling_price": 5000, "initial_stock": "100"})["id"].(string)

	var wg sync.WaitGroup
	statuses := make(chan int, 10)
	for i := range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Mixed carts in both orders exercise the sorted lock order (no deadlocks).
			items := []map[string]any{line(last, 1), line(other, 1)}
			if i%2 == 1 {
				items = []map[string]any{line(other, 1), line(last, 1)}
			}
			statuses <- a.do("POST", "/api/v1/sales", checkout(fmt.Sprintf("key-last-unit-%02d", i), 0, items...)).status
		}()
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for s := range statuses {
		counts[s]++
	}
	if counts[201] != 1 || counts[409] != 9 || len(counts) != 2 {
		t.Fatalf("want 1×201 and 9×409, got %v", counts)
	}
	if stockOf(t, e, last) != "0.000" || stockOf(t, e, other) != "99.000" {
		t.Fatalf("stock last=%s other=%s (losers must not decrement the other line)", stockOf(t, e, last), stockOf(t, e, other))
	}
	assertLedgerReconciles(t, e)
}

func TestSaleSnapshotsSurviveProductEdits(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	kp := a.createProduct(kopi(nil))["id"].(string)
	sale := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-snap-00001", 0, line(kp, 1))), 201).body

	a.mustStatus(a.do("PATCH", "/api/v1/products/"+kp, map[string]any{"name": "Kopi Baru", "selling_price": 99000, "sku": "NEW-1", "unit": "sachet"}), 200)
	a.mustStatus(a.do("POST", "/api/v1/products/"+kp+"/archive", nil), 200)

	r := a.mustStatus(a.do("GET", "/api/v1/sales/"+sale["id"].(string), nil), 200)
	it := r.body["items"].([]any)[0].(map[string]any)
	if it["product_name"] != "Kopi Arabica 250g" || it["sku"] != "KOP-250" || it["unit"] != "pcs" ||
		it["unit_price"] != float64(68000) || r.body["subtotal"] != float64(68000) {
		t.Fatalf("snapshot changed: %s", r.raw)
	}
	// Archived products cannot be sold anymore.
	r = a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-snap-00002", 0, line(kp, 1))), 409)
	if r.code() != "PRODUCT_ARCHIVED" {
		t.Fatalf("archived sale: %s", r.raw)
	}
}

func TestVoidSale(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	kp := a.createProduct(kopi(nil))["id"].(string)
	id := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-void-00001", 0, line(kp, 4))), 201).body["id"].(string)
	if stockOf(t, e, kp) != "20.000" {
		t.Fatal("precondition")
	}

	a.mustStatus(a.do("POST", "/api/v1/sales/"+id+"/void", map[string]any{"reason": "x"}), 400) // too short
	r := a.mustStatus(a.do("POST", "/api/v1/sales/"+id+"/void", map[string]any{"reason": "Salah input jumlah"}), 200)
	if r.body["status"] != "VOIDED" || dig(r.body, "void", "reason") != "Salah input jumlah" || dig(r.body, "void", "by", "name") != "Owner Toko A" {
		t.Fatalf("void: %s", r.raw)
	}
	if stockOf(t, e, kp) != "24.000" {
		t.Fatalf("stock not restored: %s", stockOf(t, e, kp))
	}
	if count(t, e, `SELECT count(*) FROM stock_movements WHERE movement_type = 'SALE_VOID' AND reference_id = $1`, id) != 1 {
		t.Fatal("expected exactly one reversal movement")
	}
	// Void twice → conflict; the reversal happens only once.
	r = a.mustStatus(a.do("POST", "/api/v1/sales/"+id+"/void", map[string]any{"reason": "Lagi"}), 409)
	if r.code() != "ALREADY_VOIDED" || stockOf(t, e, kp) != "24.000" {
		t.Fatalf("second void: %s", r.raw)
	}
	// History is kept: the sale and its items still exist.
	if count(t, e, `SELECT count(*) FROM sale_items WHERE sale_id = $1`, id) != 1 {
		t.Fatal("void must not delete items")
	}
	if got := a.mustStatus(a.do("GET", "/api/v1/sales?status=VOIDED", nil), 200).body["meta"].(map[string]any)["total"]; got != float64(1) {
		t.Fatalf("voided filter: %v", got)
	}
	assertLedgerReconciles(t, e)
}

func TestConcurrentVoidReversesOnce(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	kp := a.createProduct(kopi(nil))["id"].(string)
	id := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-cvoid-0001", 0, line(kp, 4))), 201).body["id"].(string)

	var wg sync.WaitGroup
	statuses := make(chan int, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses <- a.do("POST", "/api/v1/sales/"+id+"/void", map[string]any{"reason": "Dobel klik void"}).status
		}()
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for s := range statuses {
		counts[s]++
	}
	if counts[200] != 1 || counts[409] != 7 || stockOf(t, e, kp) != "24.000" {
		t.Fatalf("concurrent void: %v stock=%s", counts, stockOf(t, e, kp))
	}
}

func TestVoidReturnsStockToArchivedProduct(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	kp := a.createProduct(kopi(nil))["id"].(string)
	id := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-varch-0001", 0, line(kp, 4))), 201).body["id"].(string)
	a.mustStatus(a.do("POST", "/api/v1/products/"+kp+"/archive", nil), 200)
	a.mustStatus(a.do("POST", "/api/v1/sales/"+id+"/void", map[string]any{"reason": "Retur pelanggan"}), 200)
	if stockOf(t, e, kp) != "24.000" {
		t.Fatalf("archived product stock: %s", stockOf(t, e, kp))
	}
	assertLedgerReconciles(t, e)
}

func TestSalesTenantIsolationAndRoles(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	pb := b.createProduct(kopi(map[string]any{"name": "Rahasia B"}))["id"].(string)
	saleB := b.mustStatus(b.do("POST", "/api/v1/sales", checkout("key-tenant-001", 0, line(pb, 1))), 201).body["id"].(string)
	pa := a.createProduct(kopi(nil))["id"].(string)

	// A cannot sell B's product, read B's sale, or void it.
	r := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-tenant-002", 0, line(pb, 1))), 404)
	if strings.Contains(r.raw, "Rahasia") || stockOf(t, e, pb) != "23.000" {
		t.Fatalf("cross-store sale: %s", r.raw)
	}
	a.mustStatus(a.do("GET", "/api/v1/sales/"+saleB, nil), 404)
	a.mustStatus(a.do("POST", "/api/v1/sales/"+saleB+"/void", map[string]any{"reason": "Iseng"}), 404)
	a.mustStatus(a.do("GET", "/api/v1/sales/not-a-uuid", nil), 404)
	if strings.Contains(a.mustStatus(a.do("GET", "/api/v1/sales", nil), 200).raw, saleB) {
		t.Fatal("store A lists store B's sale")
	}
	if b.mustStatus(b.do("GET", "/api/v1/sales/"+saleB, nil), 200).body["status"] != "COMPLETED" {
		t.Fatal("store B sale changed")
	}

	// Staff can sell and view; only the owner can void.
	a.mustStatus(a.do("POST", "/api/v1/settings/team", map[string]any{"name": "Kasir Andi", "email": "kasir@toko.id", "password": "kasir-12345"}), 201)
	staff := e.client(t)
	staff.mustStatus(staff.do("POST", "/api/v1/auth/login", map[string]any{"email": "kasir@toko.id", "password": "kasir-12345"}), 200)
	s := staff.mustStatus(staff.do("POST", "/api/v1/sales", checkout("key-staff-0001", 0, line(pa, 1))), 201).body
	if dig(s, "cashier", "name") != "Kasir Andi" {
		t.Fatalf("cashier should be the staff member: %v", s["cashier"])
	}
	staff.mustStatus(staff.do("GET", "/api/v1/sales", nil), 200)
	staff.mustStatus(staff.do("GET", "/api/v1/sales/"+s["id"].(string), nil), 200)
	staff.mustStatus(staff.do("POST", "/api/v1/sales/"+s["id"].(string)+"/void", map[string]any{"reason": "Mau batal"}), 403)
}

func TestSaleNumbersArePerStoreAndPerStoreDay(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	pa := a.createProduct(kopi(nil))["id"].(string)
	pb := b.createProduct(kopi(nil))["id"].(string)

	// 23:50 WIB on 10 Nov 2026 (16:50Z), then 20 minutes later = 00:10 WIB on 11 Nov.
	e.clock.mu.Lock()
	e.clock.t = time.Date(2026, 11, 10, 16, 50, 0, 0, time.UTC)
	e.clock.mu.Unlock()
	n1 := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-day-000001", 0, line(pa, 1))), 201).body["sale_number"]
	nb := b.mustStatus(b.do("POST", "/api/v1/sales", checkout("key-day-000002", 0, line(pb, 1))), 201).body["sale_number"]
	e.clock.Advance(20 * time.Minute)
	n2 := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-day-000003", 0, line(pa, 1))), 201).body["sale_number"]
	if n1 != "TP-20261110-0001" || nb != "TP-20261110-0001" || n2 != "TP-20261111-0001" {
		t.Fatalf("numbers: a1=%v b1=%v a2=%v", n1, nb, n2)
	}
	// Filtering by store-local date follows the same boundary.
	if got := a.mustStatus(a.do("GET", "/api/v1/sales?from=2026-11-11&to=2026-11-11", nil), 200).body["meta"].(map[string]any)["total"]; got != float64(1) {
		t.Fatalf("date filter: %v", got)
	}
	if got := a.mustStatus(a.do("GET", "/api/v1/sales?q=20261110", nil), 200).body["meta"].(map[string]any)["total"]; got != float64(1) {
		t.Fatalf("number search: %v", got)
	}
}

func TestSalesAreImmutableInTheDatabase(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	kp := a.createProduct(kopi(nil))["id"].(string)
	id := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("key-immut-0001", 0, line(kp, 1))), 201).body["id"].(string)
	ctx := context.Background()
	for _, stmt := range []string{
		`UPDATE sales SET subtotal = 1, net_total = 1 WHERE id = $1`,
		`UPDATE sales SET payment_method = 'TRANSFER' WHERE id = $1`,
		`DELETE FROM sales WHERE id = $1`,
		`UPDATE sale_items SET unit_price = 1 WHERE sale_id = $1`,
		`DELETE FROM sale_items WHERE sale_id = $1`,
	} {
		if _, err := e.pool.Exec(ctx, stmt, id); err == nil {
			t.Errorf("DB must block: %s", stmt)
		}
	}
	// Inconsistent void (status without reason) is rejected by the CHECK.
	if _, err := e.pool.Exec(ctx, `UPDATE sales SET status = 'VOIDED' WHERE id = $1`, id); err == nil {
		t.Error("void without reason/actor must be rejected")
	}
	// Totals must add up at insert time too.
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO sales (store_id, cashier_user_id, sale_number, subtotal, discount_amount, net_total, payment_method, idempotency_key, request_hash, sold_at)
		SELECT store_id, cashier_user_id, 'TP-20990101-0001', 100, 10, 100, 'CASH', 'key-bad-net-01', request_hash, now() FROM sales WHERE id = $1`, id); err == nil {
		t.Error("net_total != subtotal - discount must be rejected")
	}
}
