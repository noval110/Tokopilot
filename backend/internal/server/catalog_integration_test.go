package server

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func (c *client) createProduct(body map[string]any) map[string]any {
	c.t.Helper()
	return c.mustStatus(c.do("POST", "/api/v1/products", body), 201).body
}

func kopi(extra map[string]any) map[string]any {
	b := map[string]any{"name": "Kopi Arabica 250g", "sku": "kop-250", "unit": "pcs", "cost_price": 52000, "selling_price": 68000,
		"initial_stock": "24", "min_stock": "5"}
	for k, v := range extra {
		b[k] = v
	}
	return b
}

func TestCreateProductRecordsInitialMovement(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")

	p := a.createProduct(kopi(nil))
	if p["sku"] != "KOP-250" || p["current_stock"] != "24.000" || p["min_stock"] != "5.000" ||
		p["cost_price"] != float64(52000) || p["stock_status"] != "OK" {
		t.Fatalf("unexpected product: %v", p)
	}

	ctx := context.Background()
	var n int
	var typ, delta, before, after string
	_ = e.pool.QueryRow(ctx, `SELECT count(*), max(movement_type), max(quantity_delta::text), max(stock_before::text), max(stock_after::text)
		FROM stock_movements WHERE product_id = $1`, p["id"]).Scan(&n, &typ, &delta, &before, &after)
	if n != 1 || typ != "INITIAL" || delta != "24.000" || before != "0.000" || after != "24.000" {
		t.Fatalf("initial movement wrong: n=%d %s %s %s→%s", n, typ, delta, before, after)
	}

	// Zero initial stock creates no movement; the ledger still reconciles.
	z := a.createProduct(map[string]any{"name": "Gula Aren", "unit": "botol", "cost_price": 20000, "selling_price": 32500})
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM stock_movements WHERE product_id = $1`, z["id"]).Scan(&n)
	if n != 0 || z["current_stock"] != "0.000" || z["stock_status"] != "OUT" {
		t.Fatalf("zero-stock product: movements=%d %v", n, z)
	}

	assertLedgerReconciles(t, e)
}

// assertLedgerReconciles: for every product, current_stock == SUM(quantity_delta).
func assertLedgerReconciles(t *testing.T, e *env) {
	t.Helper()
	var bad int
	_ = e.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM products p
		WHERE p.current_stock <> COALESCE((SELECT sum(quantity_delta) FROM stock_movements m WHERE m.product_id = p.id), 0)`).Scan(&bad)
	if bad != 0 {
		t.Fatalf("%d products do not reconcile with the stock ledger", bad)
	}
}

func TestProductValidation(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")

	r := a.mustStatus(a.do("POST", "/api/v1/products", map[string]any{
		"name": "", "unit": "", "cost_price": -1, "selling_price": 1500.5, "sku": "kode spasi", "unit_scale": 0, "initial_stock": "2.5",
	}), 400)
	for _, f := range []string{"name", "unit", "cost_price", "selling_price", "sku", "initial_stock"} {
		if dig(r.body, "error", "details", "fields", f) == nil {
			t.Errorf("missing field error %s: %s", f, r.raw)
		}
	}

	// Missing prices are required; quantities beyond NUMERIC(14,3) rejected.
	r = a.mustStatus(a.do("POST", "/api/v1/products", map[string]any{"name": "X", "unit": "kg", "unit_scale": 3, "min_stock": "1.2345"}), 400)
	for _, f := range []string{"cost_price", "selling_price", "min_stock"} {
		if dig(r.body, "error", "details", "fields", f) == nil {
			t.Errorf("missing field error %s: %s", f, r.raw)
		}
	}

	// Fractional units work within their scale; numbers are accepted as JSON numbers too.
	p := a.createProduct(map[string]any{"name": "Beras Pandan", "unit": "kg", "unit_scale": 3, "cost_price": 12333, "selling_price": 15000,
		"initial_stock": 12.125, "min_stock": "2.5"})
	if p["current_stock"] != "12.125" || p["min_stock"] != "2.500" {
		t.Fatalf("decimal quantities: %v", p)
	}

	// current_stock cannot be smuggled in on create or update.
	a.mustStatus(a.do("POST", "/api/v1/products", kopi(map[string]any{"current_stock": "999"})), 400)
	a.mustStatus(a.do("PATCH", "/api/v1/products/"+p["id"].(string), map[string]any{"current_stock": "999"}), 400)
	a.mustStatus(a.do("PATCH", "/api/v1/products/"+p["id"].(string), map[string]any{"initial_stock": "999"}), 400)
}

func TestSKUUniquenessAndArchive(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")

	p := a.createProduct(kopi(nil))
	r := a.mustStatus(a.do("POST", "/api/v1/products", kopi(map[string]any{"name": "Kopi lain", "sku": "KOP-250"})), 409)
	if r.code() != "DUPLICATE_SKU" || dig(r.body, "error", "details", "fields", "sku") == nil {
		t.Fatalf("duplicate sku: %s", r.raw)
	}
	a.mustStatus(a.do("POST", "/api/v1/products", kopi(map[string]any{"sku": "Kop-250 "})), 409) // case/space-insensitive
	b.createProduct(kopi(nil))                                                                   // same SKU in another store is fine

	id := p["id"].(string)
	r = a.mustStatus(a.do("POST", "/api/v1/products/"+id+"/archive", nil), 200)
	if r.body["is_active"] != false || r.body["archived_at"] == nil {
		t.Fatalf("archive: %s", r.raw)
	}
	a.mustStatus(a.do("POST", "/api/v1/products/"+id+"/archive", nil), 409)
	r = a.mustStatus(a.do("PATCH", "/api/v1/products/"+id, map[string]any{"name": "Ubah"}), 409)
	if r.code() != "PRODUCT_ARCHIVED" {
		t.Fatalf("edit archived: %s", r.raw)
	}

	// History is preserved and the SKU can be reused by a new active product.
	var movements, products int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM stock_movements WHERE product_id = $1`, id).Scan(&movements)
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM products WHERE id = $1`, id).Scan(&products)
	if movements != 1 || products != 1 {
		t.Fatalf("archive must not delete: movements=%d products=%d", movements, products)
	}
	a.createProduct(kopi(map[string]any{"name": "Kopi Arabica 250g (baru)"}))

	list := a.mustStatus(a.do("GET", "/api/v1/products", nil), 200)
	if dig(list.body, "meta", "total") != float64(1) {
		t.Fatalf("archived product must be hidden from default list: %s", list.raw)
	}
	list = a.mustStatus(a.do("GET", "/api/v1/products?status=archived", nil), 200)
	if dig(list.body, "meta", "total") != float64(1) {
		t.Fatalf("archived filter: %s", list.raw)
	}
}

func TestProductUpdateAndUnitScale(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	p := a.createProduct(map[string]any{"name": "Beras", "unit": "kg", "unit_scale": 3, "cost_price": 12000, "selling_price": 15000,
		"initial_stock": "10.5", "min_stock": "2"})
	id := p["id"].(string)

	r := a.mustStatus(a.do("PATCH", "/api/v1/products/"+id, map[string]any{"selling_price": 16000, "sku": "brs-01"}), 200)
	if r.body["selling_price"] != float64(16000) || r.body["sku"] != "BRS-01" || r.body["name"] != "Beras" || r.body["current_stock"] != "10.500" {
		t.Fatalf("partial update: %s", r.raw)
	}
	r = a.mustStatus(a.do("PATCH", "/api/v1/products/"+id, map[string]any{"sku": ""}), 200)
	if r.body["sku"] != nil {
		t.Fatalf("clear sku: %s", r.raw)
	}
	// Stock 10.500 cannot be represented with 0 decimals: rejected by the DB CHECK, mapped to a field error.
	r = a.mustStatus(a.do("PATCH", "/api/v1/products/"+id, map[string]any{"unit_scale": 0}), 400)
	if dig(r.body, "error", "details", "fields", "unit_scale") == nil {
		t.Fatalf("scale conflict: %s", r.raw)
	}
	// Min stock above stock flips the derived status to LOW.
	r = a.mustStatus(a.do("PATCH", "/api/v1/products/"+id, map[string]any{"min_stock": "12"}), 200)
	if r.body["stock_status"] != "LOW" {
		t.Fatalf("status after min change: %s", r.raw)
	}
}

func TestProductSearchFilterSortPaginate(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	minuman := a.mustStatus(a.do("POST", "/api/v1/categories", map[string]any{"name": "Minuman"}), 201).body["id"].(string)

	a.createProduct(map[string]any{"name": "Teh Melati", "sku": "TEH-01", "unit": "pcs", "cost_price": 3000, "selling_price": 5000, "initial_stock": "50", "min_stock": "10", "category_id": minuman})
	a.createProduct(map[string]any{"name": "Kopi Susu", "sku": "KOP-02", "unit": "pcs", "cost_price": 8000, "selling_price": 12000, "initial_stock": "3", "min_stock": "5", "category_id": minuman})
	a.createProduct(map[string]any{"name": "Sabun 100% Alami", "sku": "SBN_01", "unit": "pcs", "cost_price": 4000, "selling_price": 7000, "initial_stock": "0", "min_stock": "2"})

	total := func(q string) float64 {
		t.Helper()
		return dig(a.mustStatus(a.do("GET", "/api/v1/products"+q, nil), 200).body, "meta", "total").(float64)
	}
	cases := map[string]float64{
		"":                        3,
		"?q=kopi":                 1,
		"?q=teh-01":               1, // SKU match, case-insensitive
		"?q=%25":                  1, // literal "%" only matches "100%"
		"?q=_":                    1, // literal "_" only matches SBN_01
		"?category_id=" + minuman: 2,
		"?stock_status=low":       2, // includes OUT (BR-12)
		"?stock_status=out":       1,
		"?stock_status=ok":        1,
		"?category_id=" + minuman + "&stock_status=low": 1,
	}
	for q, want := range cases {
		if got := total(q); got != want {
			t.Errorf("GET /products%s total = %v, want %v", q, got, want)
		}
	}

	r := a.mustStatus(a.do("GET", "/api/v1/products?sort=stock&per_page=2&page=1", nil), 200)
	data := r.body["data"].([]any)
	if len(data) != 2 || data[0].(map[string]any)["name"] != "Sabun 100% Alami" || dig(r.body, "meta", "total") != float64(3) {
		t.Fatalf("sort/paginate: %s", r.raw)
	}
	r = a.mustStatus(a.do("GET", "/api/v1/products?sort=stock&per_page=2&page=2", nil), 200)
	if len(r.body["data"].([]any)) != 1 {
		t.Fatalf("page 2: %s", r.raw)
	}
	for _, bad := range []string{"?per_page=101", "?sort=price", "?stock_status=x", "?category_id=not-a-uuid", "?status=deleted"} {
		a.mustStatus(a.do("GET", "/api/v1/products"+bad, nil), 400)
	}
}

func TestCategories(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	id := a.mustStatus(a.do("POST", "/api/v1/categories", map[string]any{"name": "Minuman"}), 201).body["id"].(string)
	r := a.mustStatus(a.do("POST", "/api/v1/categories", map[string]any{"name": " minuman "}), 409)
	if r.code() != "DUPLICATE_CATEGORY" {
		t.Fatalf("dup category: %s", r.raw)
	}
	a.mustStatus(a.do("PATCH", "/api/v1/categories/"+id, map[string]any{"name": "Minuman Dingin"}), 200)
	a.createProduct(kopi(map[string]any{"category_id": id}))

	list := a.mustStatus(a.do("GET", "/api/v1/categories", nil), 200)
	if !strings.Contains(list.raw, `"product_count":1`) {
		t.Fatalf("product count: %s", list.raw)
	}
	a.mustStatus(a.do("POST", "/api/v1/categories/"+id+"/archive", nil), 204)
	if strings.Contains(a.mustStatus(a.do("GET", "/api/v1/categories", nil), 200).raw, "Minuman Dingin") {
		t.Fatal("archived category must be hidden by default")
	}
	// Archived categories cannot be assigned to new products; existing links survive.
	r = a.mustStatus(a.do("POST", "/api/v1/products", kopi(map[string]any{"sku": "X-1", "category_id": id})), 400)
	if dig(r.body, "error", "details", "fields", "category_id") == nil {
		t.Fatalf("archived category assignment: %s", r.raw)
	}
	if !strings.Contains(a.mustStatus(a.do("GET", "/api/v1/products", nil), 200).raw, "Minuman Dingin") {
		t.Fatal("existing product must keep its archived category name")
	}
	// The name is free again for a new active category.
	a.mustStatus(a.do("POST", "/api/v1/categories", map[string]any{"name": "Minuman Dingin"}), 201)
}

func TestCatalogTenantIsolationAndRoles(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	pb := b.createProduct(kopi(map[string]any{"name": "Produk Rahasia B"}))
	catB := b.mustStatus(b.do("POST", "/api/v1/categories", map[string]any{"name": "Kategori B"}), 201).body["id"].(string)
	idB := pb["id"].(string)

	// Every way of touching store B's product from store A looks like "not found".
	for _, call := range []struct {
		m, p string
		body any
	}{
		{"GET", "/api/v1/products/" + idB, nil},
		{"PATCH", "/api/v1/products/" + idB, map[string]any{"name": "Hacked"}},
		{"POST", "/api/v1/products/" + idB + "/archive", nil},
		{"PATCH", "/api/v1/categories/" + catB, map[string]any{"name": "Hacked"}},
		{"POST", "/api/v1/categories/" + catB + "/archive", nil},
		{"GET", "/api/v1/products/not-a-uuid", nil},
	} {
		r := a.do(call.m, call.p, call.body)
		if r.status != 404 || strings.Contains(r.raw, "Rahasia") {
			t.Errorf("%s %s from other store: %d %s", call.m, call.p, r.status, r.raw)
		}
	}
	// A's product cannot point at B's category (service check + composite FK).
	r := a.mustStatus(a.do("POST", "/api/v1/products", kopi(map[string]any{"category_id": catB})), 400)
	if dig(r.body, "error", "details", "fields", "category_id") == nil {
		t.Fatalf("cross-store category: %s", r.raw)
	}
	if strings.Contains(a.mustStatus(a.do("GET", "/api/v1/products?status=all", nil), 200).raw, "Rahasia") {
		t.Fatal("store A lists store B's product")
	}
	if strings.Contains(a.mustStatus(a.do("GET", "/api/v1/categories?include_archived=true", nil), 200).raw, "Kategori B") {
		t.Fatal("store A lists store B's category")
	}
	if got := b.mustStatus(b.do("GET", "/api/v1/products/"+idB, nil), 200).body["name"]; got != "Produk Rahasia B" {
		t.Fatalf("store B product modified: %v", got)
	}

	// Staff: read yes, write no.
	a.mustStatus(a.do("POST", "/api/v1/settings/team", map[string]any{"name": "Kasir", "email": "kasir@toko.id", "password": "kasir-12345"}), 201)
	staff := e.client(t)
	staff.mustStatus(staff.do("POST", "/api/v1/auth/login", map[string]any{"email": "kasir@toko.id", "password": "kasir-12345"}), 200)
	pa := a.createProduct(kopi(nil))
	staff.mustStatus(staff.do("GET", "/api/v1/products", nil), 200)
	staff.mustStatus(staff.do("GET", "/api/v1/products/"+pa["id"].(string), nil), 200)
	staff.mustStatus(staff.do("GET", "/api/v1/categories", nil), 200)
	staff.mustStatus(staff.do("POST", "/api/v1/products", kopi(map[string]any{"sku": "S-1"})), 403)
	staff.mustStatus(staff.do("PATCH", "/api/v1/products/"+pa["id"].(string), map[string]any{"selling_price": 1}), 403)
	staff.mustStatus(staff.do("POST", "/api/v1/products/"+pa["id"].(string)+"/archive", nil), 403)
	staff.mustStatus(staff.do("POST", "/api/v1/categories", map[string]any{"name": "X"}), 403)
}

func TestStockLedgerIsAppendOnlyAndSameStore(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	pa := a.createProduct(kopi(nil))
	b.createProduct(kopi(nil))
	ctx := context.Background()

	for _, stmt := range []string{
		`UPDATE stock_movements SET quantity_delta = 999`,
		`DELETE FROM stock_movements`,
		`TRUNCATE stock_movements`,
	} {
		if _, err := e.pool.Exec(ctx, stmt); err == nil || !strings.Contains(err.Error(), "append-only") {
			t.Errorf("%q must be blocked, got %v", stmt, err)
		}
	}

	var storeB, actor string
	_ = e.pool.QueryRow(ctx, `SELECT id FROM stores WHERE name = 'Toko B'`).Scan(&storeB)
	_ = e.pool.QueryRow(ctx, `SELECT created_by FROM products WHERE id = $1`, pa["id"]).Scan(&actor)
	bad := []string{
		// movement for A's product filed under store B → composite FK
		fmt.Sprintf(`INSERT INTO stock_movements (store_id, product_id, actor_user_id, movement_type, quantity_delta, stock_before, stock_after)
		 VALUES ('%s', '%s', '%s', 'RESTOCK', 1, 24, 25)`, storeB, pa["id"], actor),
		// arithmetic mismatch
		fmt.Sprintf(`INSERT INTO stock_movements (store_id, product_id, actor_user_id, movement_type, quantity_delta, stock_before, stock_after)
		 SELECT store_id, id, '%s', 'RESTOCK', 1, 24, 30 FROM products WHERE id = '%s'`, actor, pa["id"]),
		// SALE must be negative
		fmt.Sprintf(`INSERT INTO stock_movements (store_id, product_id, actor_user_id, movement_type, quantity_delta, stock_before, stock_after)
		 SELECT store_id, id, '%s', 'SALE', 1, 24, 25 FROM products WHERE id = '%s'`, actor, pa["id"]),
		// negative stock
		`UPDATE products SET current_stock = -1`,
	}
	for _, stmt := range bad {
		if _, err := e.pool.Exec(ctx, stmt); err == nil {
			t.Errorf("constraint should reject: %s", stmt)
		}
	}
	assertLedgerReconciles(t, e)
}
