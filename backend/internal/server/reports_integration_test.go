package server

import (
	"context"
	"encoding/csv"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func (e *env) at(t time.Time) {
	e.clock.mu.Lock()
	e.clock.t = t
	e.clock.mu.Unlock()
}

var wib = time.FixedZone("WIB", 7*3600)

// goldenStore builds a store with sales whose totals were computed by hand.
//
//	S1 08 Nov 10:00 WIB  CASH     kopi 2 + beras 1,5 kg − disc 5.000  subtotal 154.500 net 149.500 cogs 119.000
//	S2 08 Nov 23:50 WIB  QRIS     teh 3                               15.000                       cogs   9.000
//	S3 09 Nov 00:10 WIB  CASH     kopi 1  (belongs to the 9th in WIB) 68.000                       cogs  52.000
//	S4 09 Nov 12:00 WIB  TRANSFER gula 2  → VOIDED (excluded)         65.000
//	S5 10 Nov 09:00 WIB  QRIS     beras 0,333 kg (4.106,889→4.107) + teh 1 − disc 107
//	                              subtotal 9.107 net 9.000  cogs 3.330 + 3.000
//
// Period 07–10 Nov: gross 246.607, discount 5.107, net 241.500, 4 tx, avg 60.375,
// cogs 186.330, gross profit 55.170, voided 1 (65.000).
func goldenStore(t *testing.T, e *env) (*client, map[string]string) {
	t.Helper()
	// Register inside the 7-day idle session window of the first sale (sessions expire otherwise — by design).
	e.at(time.Date(2026, 11, 7, 9, 0, 0, 0, wib))
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	ids := map[string]string{
		"kopi":  a.createProduct(map[string]any{"name": "Kopi Arabica", "sku": "KOP", "unit": "pcs", "cost_price": 52000, "selling_price": 68000, "initial_stock": "100", "min_stock": "5"})["id"].(string),
		"beras": a.createProduct(map[string]any{"name": "Beras Pandan", "sku": "BRS", "unit": "kg", "unit_scale": 3, "cost_price": 10000, "selling_price": 12333, "initial_stock": "100", "min_stock": "5"})["id"].(string),
		"teh":   a.createProduct(map[string]any{"name": "Teh Melati", "sku": "TEH", "unit": "pcs", "cost_price": 3000, "selling_price": 5000, "initial_stock": "100", "min_stock": "100"})["id"].(string),
		"gula":  a.createProduct(map[string]any{"name": "Gula Aren", "sku": "GLA", "unit": "botol", "cost_price": 20000, "selling_price": 32500, "initial_stock": "100", "min_stock": "5"})["id"].(string),
	}
	sell := func(when time.Time, key, method string, discount int, items ...map[string]any) string {
		e.at(when)
		body := map[string]any{"idempotency_key": key, "items": items, "discount_amount": discount, "payment_method": method}
		return a.mustStatus(a.do("POST", "/api/v1/sales", body), 201).body["id"].(string)
	}
	sell(time.Date(2026, 11, 8, 10, 0, 0, 0, wib), "golden-s1-key", "CASH", 5000, line(ids["kopi"], "2"), line(ids["beras"], "1.5"))
	sell(time.Date(2026, 11, 8, 23, 50, 0, 0, wib), "golden-s2-key", "QRIS", 0, line(ids["teh"], "3"))
	sell(time.Date(2026, 11, 9, 0, 10, 0, 0, wib), "golden-s3-key", "CASH", 0, line(ids["kopi"], "1"))
	s4 := sell(time.Date(2026, 11, 9, 12, 0, 0, 0, wib), "golden-s4-key", "TRANSFER", 0, line(ids["gula"], "2"))
	a.mustStatus(a.do("POST", "/api/v1/sales/"+s4+"/void", map[string]any{"reason": "=SUM(1+1) salah input"}), 200)
	sell(time.Date(2026, 11, 10, 9, 0, 0, 0, wib), "golden-s5-key", "QRIS", 107, line(ids["beras"], "0.333"), line(ids["teh"], "1"))
	e.at(time.Date(2026, 11, 10, 15, 0, 0, 0, wib)) // "now" for the report
	return a, ids
}

func num(t *testing.T, m map[string]any, keys ...string) int64 {
	t.Helper()
	v, ok := dig(m, keys...).(float64)
	if !ok {
		t.Fatalf("missing number at %v in %v", keys, m)
	}
	return int64(v)
}

func TestSalesReportGoldenFigures(t *testing.T) {
	e := newEnv(t)
	a, ids := goldenStore(t, e)
	r := a.mustStatus(a.do("GET", "/api/v1/reports/sales?from=2026-11-07&to=2026-11-10", nil), 200).body

	want := map[string]int64{
		"gross_sales": 246607, "discount_total": 5107, "net_sales": 241500, "transaction_count": 4,
		"avg_transaction_value": 60375, "cogs": 186330, "gross_profit": 55170, "voided_count": 1, "voided_net_total": 65000,
	}
	for k, v := range want {
		if got := num(t, r, "summary", k); got != v {
			t.Errorf("summary.%s = %d, want %d", k, got, v)
		}
	}
	if dig(r, "period", "from") != "2026-11-07" || dig(r, "period", "to") != "2026-11-10" || dig(r, "period", "timezone") != "Asia/Jakarta" || num(t, r, "period", "days") != 4 {
		t.Fatalf("period: %v", r["period"])
	}

	// Daily buckets follow WIB: S2 (23:50) stays on the 8th, S3 (00:10) moves to the 9th. Empty day is zero-filled.
	daily := r["daily"].([]any)
	wantDaily := []struct {
		date string
		net  int64
		n    int64
	}{{"2026-11-07", 0, 0}, {"2026-11-08", 164500, 2}, {"2026-11-09", 68000, 1}, {"2026-11-10", 9000, 1}}
	if len(daily) != len(wantDaily) {
		t.Fatalf("daily len %d", len(daily))
	}
	var dailySum int64
	for i, w := range wantDaily {
		d := daily[i].(map[string]any)
		if d["date"] != w.date || int64(d["net_sales"].(float64)) != w.net || int64(d["transaction_count"].(float64)) != w.n {
			t.Errorf("daily[%d] = %v, want %+v", i, d, w)
		}
		dailySum += int64(d["net_sales"].(float64))
	}
	if dailySum != want["net_sales"] {
		t.Errorf("daily sum %d != net %d", dailySum, want["net_sales"])
	}

	// Top products: revenue before transaction discount, voided excluded, deterministic order.
	top := r["top_products"].([]any)
	wantTop := []struct {
		id, qty string
		rev     int64
	}{{ids["kopi"], "3.000", 204000}, {ids["beras"], "1.833", 22607}, {ids["teh"], "4.000", 20000}}
	if len(top) != 3 {
		t.Fatalf("top products (gula must be excluded): %v", top)
	}
	for i, w := range wantTop {
		p := top[i].(map[string]any)
		if p["product_id"] != w.id || p["quantity_sold"] != w.qty || int64(p["revenue"].(float64)) != w.rev || p["rank"] != float64(i+1) {
			t.Errorf("top[%d] = %v, want %+v", i, p, w)
		}
	}

	pm := r["payment_methods"].([]any)
	if len(pm) != 2 || dig(pm[0].(map[string]any), "payment_method") != "CASH" || int64(pm[0].(map[string]any)["net_sales"].(float64)) != 217500 ||
		int64(pm[1].(map[string]any)["net_sales"].(float64)) != 24000 {
		t.Fatalf("payments: %v", pm)
	}
}

// TestReportMatchesIndependentSQL recomputes the headline numbers with a
// separate, simpler query straight from the source tables.
func TestReportMatchesIndependentSQL(t *testing.T) {
	e := newEnv(t)
	a, _ := goldenStore(t, e)
	for _, rng := range [][2]string{{"2026-11-07", "2026-11-10"}, {"2026-11-08", "2026-11-08"}, {"2026-11-09", "2026-11-09"}, {"2026-11-01", "2026-11-30"}} {
		r := a.mustStatus(a.do("GET", "/api/v1/reports/sales?from="+rng[0]+"&to="+rng[1], nil), 200).body
		var net, gross, disc, n int64
		_ = e.pool.QueryRow(context.Background(), `
			SELECT COALESCE(sum(net_total),0), COALESCE(sum(subtotal),0), COALESCE(sum(discount_amount),0), count(*)
			FROM sales
			WHERE status = 'COMPLETED' AND (sold_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date`,
			rng[0], rng[1]).Scan(&net, &gross, &disc, &n)
		if num(t, r, "summary", "net_sales") != net || num(t, r, "summary", "gross_sales") != gross ||
			num(t, r, "summary", "discount_total") != disc || num(t, r, "summary", "transaction_count") != n {
			t.Errorf("range %v: API %v vs SQL net=%d gross=%d disc=%d n=%d", rng, r["summary"], net, gross, disc, n)
		}
	}
	day8 := a.mustStatus(a.do("GET", "/api/v1/reports/sales?from=2026-11-08&to=2026-11-08", nil), 200).body
	if num(t, day8, "summary", "net_sales") != 164500 || num(t, day8, "summary", "transaction_count") != 2 {
		t.Fatalf("8 Nov (WIB): %v", day8["summary"])
	}
}

func TestDashboardDefaultsAndStockKPIs(t *testing.T) {
	e := newEnv(t)
	a, _ := goldenStore(t, e)
	r := a.mustStatus(a.do("GET", "/api/v1/dashboard/summary", nil), 200).body
	// Default: last 7 days including today (10 Nov WIB) = 4–10 Nov.
	if dig(r, "period", "from") != "2026-11-04" || dig(r, "period", "to") != "2026-11-10" || num(t, r, "period", "days") != 7 {
		t.Fatalf("default period: %v", r["period"])
	}
	if num(t, r, "sales", "net_sales") != 241500 || num(t, r, "sales", "transaction_count") != 4 {
		t.Fatalf("dashboard sales: %v", r["sales"])
	}
	// teh: stock 100 − 4 = 96 ≤ min 100 → low. Stock KPIs are current, not per period.
	if num(t, r, "active_products") != 4 || num(t, r, "low_stock_count") != 1 || num(t, r, "out_of_stock_count") != 0 {
		t.Fatalf("stock KPIs: %v", r)
	}

	trend := a.mustStatus(a.do("GET", "/api/v1/dashboard/sales-trend", nil), 200).body["data"].([]any)
	if len(trend) != 7 || trend[0].(map[string]any)["date"] != "2026-11-04" || trend[6].(map[string]any)["date"] != "2026-11-10" {
		t.Fatalf("trend: %v", trend)
	}
	top := a.mustStatus(a.do("GET", "/api/v1/dashboard/top-products?limit=2", nil), 200).body["data"].([]any)
	if len(top) != 2 || top[0].(map[string]any)["product_name"] != "Kopi Arabica" {
		t.Fatalf("top: %v", top)
	}

	today := a.mustStatus(a.do("GET", "/api/v1/dashboard/summary?from=2026-11-10&to=2026-11-10", nil), 200).body
	if num(t, today, "sales", "net_sales") != 9000 || num(t, today, "sales", "avg_transaction_value") != 9000 {
		t.Fatalf("today: %v", today["sales"])
	}
	empty := a.mustStatus(a.do("GET", "/api/v1/dashboard/summary?from=2026-10-01&to=2026-10-07", nil), 200).body
	if num(t, empty, "sales", "net_sales") != 0 || num(t, empty, "sales", "avg_transaction_value") != 0 {
		t.Fatalf("empty period must be zeros (no division by zero): %v", empty["sales"])
	}
}

func TestReportValidation(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	for _, q := range []string{"?from=2026-11-10&to=2026-11-01", "?from=2025-01-01&to=2026-11-10", "?from=10/11/2026", "?to=kemarin"} {
		a.mustStatus(a.do("GET", "/api/v1/reports/sales"+q, nil), 400)
		a.mustStatus(a.do("GET", "/api/v1/dashboard/summary"+q, nil), 400)
	}
	a.mustStatus(a.do("GET", "/api/v1/dashboard/top-products?limit=0", nil), 400)
	a.mustStatus(a.do("GET", "/api/v1/dashboard/top-products?limit=21", nil), 400)
	a.mustStatus(a.do("GET", "/api/v1/reports/sales?from=2025-11-11&to=2026-11-11", nil), 200) // 366 days inclusive
}

func TestReportsTenantIsolationAndStaffAccess(t *testing.T) {
	e := newEnv(t)
	a, _ := goldenStore(t, e)
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	pb := b.createProduct(kopi(nil))["id"].(string)
	e.at(time.Date(2026, 11, 9, 10, 0, 0, 0, wib))
	b.mustStatus(b.do("POST", "/api/v1/sales", checkout("tenant-b-sale-1", 0, line(pb, 10))), 201)
	e.at(time.Date(2026, 11, 10, 15, 0, 0, 0, wib))

	ra := a.mustStatus(a.do("GET", "/api/v1/reports/sales?from=2026-11-07&to=2026-11-10", nil), 200).body
	rb := b.mustStatus(b.do("GET", "/api/v1/reports/sales?from=2026-11-07&to=2026-11-10", nil), 200).body
	if num(t, ra, "summary", "net_sales") != 241500 || num(t, rb, "summary", "net_sales") != 680000 || num(t, rb, "summary", "transaction_count") != 1 {
		t.Fatalf("tenant mix: A=%v B=%v", ra["summary"], rb["summary"])
	}
	if strings.Contains(a.mustStatus(a.do("GET", "/api/v1/dashboard/top-products?limit=20", nil), 200).raw, pb) {
		t.Fatal("store A top products include store B's product")
	}

	a.mustStatus(a.do("POST", "/api/v1/settings/team", map[string]any{"name": "Kasir", "email": "kasir@toko.id", "password": "kasir-12345"}), 201)
	staff := e.client(t)
	staff.mustStatus(staff.do("POST", "/api/v1/auth/login", map[string]any{"email": "kasir@toko.id", "password": "kasir-12345"}), 200)
	rs := staff.mustStatus(staff.do("GET", "/api/v1/reports/sales?from=2026-11-07&to=2026-11-10", nil), 200).body
	if num(t, rs, "summary", "net_sales") != 241500 {
		t.Fatalf("staff report: %v", rs["summary"])
	}
	staff.mustStatus(staff.do("GET", "/api/v1/dashboard/summary", nil), 200)

	anon := e.client(t)
	anon.mustStatus(anon.do("GET", "/api/v1/reports/sales", nil), 401)
	anon.mustStatus(anon.do("GET", "/api/v1/reports/sales/export", nil), 401)
}

func TestSalesCSVExport(t *testing.T) {
	e := newEnv(t)
	a, _ := goldenStore(t, e)
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/v1/reports/sales/export?from=2026-11-07&to=2026-11-10", nil)
	res, err := a.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/csv") ||
		!strings.Contains(res.Header.Get("Content-Disposition"), `tokopilot-penjualan-2026-11-07_2026-11-10.csv`) {
		t.Fatalf("headers: %d %v", res.StatusCode, res.Header)
	}
	if !strings.HasPrefix(string(raw), "\xEF\xBB\xBF") {
		t.Fatal("CSV must start with a UTF-8 BOM for Excel")
	}
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(raw), "\xEF\xBB\xBF"))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 6 || rows[0][0] != "Nomor nota" || rows[0][1] != "Waktu (WIB)" {
		t.Fatalf("rows: %v", rows)
	}
	// Oldest first, local time; S2 23:50 WIB stays on the 8th.
	if rows[2][1] != "2026-11-08 23:50" || rows[3][1] != "2026-11-09 00:10" {
		t.Fatalf("local times: %v / %v", rows[2], rows[3])
	}
	var lunasNet int64
	var voidRow []string
	for _, r := range rows[1:] {
		switch r[3] {
		case "Lunas":
			var v int64
			for _, ch := range r[8] {
				v = v*10 + int64(ch-'0')
			}
			lunasNet += v
		case "Void":
			voidRow = r
		}
	}
	if lunasNet != 241500 {
		t.Fatalf("CSV Lunas net %d must reconcile with report net 241500", lunasNet)
	}
	// Formula injection is neutralised.
	if voidRow == nil || voidRow[9] != "'=SUM(1+1) salah input" {
		t.Fatalf("void row / formula escaping: %v", voidRow)
	}
}
