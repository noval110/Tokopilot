package server

// Release-gate security matrix (PRD §16.1 "Security", §16.3). Every route the
// router knows must be classified here; a new route without a classification
// fails the build, so protection can never be forgotten silently.

import (
	"net/http"
	"sort"
	"strings"
	"testing"
)

type access int

const (
	public access = iota // no session
	authed               // session + CSRF, no store needed
	tenant               // session + CSRF + store membership (owner or staff)
	owner                // tenant + OWNER role
)

var routeAccess = map[string]access{
	"GET /healthz":               public,
	"GET /readyz":                public,
	"GET /api/v1/health":         public,
	"POST /api/v1/auth/register": public,
	"POST /api/v1/auth/login":    public,

	"POST /api/v1/auth/logout": authed,
	"GET /api/v1/me":           authed,
	"POST /api/v1/stores":      authed,

	"GET /api/v1/products":                              tenant,
	"GET /api/v1/products/:id":                          tenant,
	"GET /api/v1/categories":                            tenant,
	"GET /api/v1/inventory/movements":                   tenant,
	"GET /api/v1/inventory/summary":                     tenant,
	"POST /api/v1/sales":                                tenant,
	"GET /api/v1/sales":                                 tenant,
	"GET /api/v1/sales/:id":                             tenant,
	"GET /api/v1/dashboard/summary":                     tenant,
	"GET /api/v1/dashboard/sales-trend":                 tenant,
	"GET /api/v1/dashboard/top-products":                tenant,
	"GET /api/v1/reports/sales":                         tenant,
	"GET /api/v1/reports/sales/export":                  tenant,
	"POST /api/v1/assistant/conversations":              tenant,
	"GET /api/v1/assistant/conversations":               tenant,
	"GET /api/v1/assistant/conversations/:id":           tenant,
	"POST /api/v1/assistant/conversations/:id/messages": tenant,

	"POST /api/v1/products":               owner,
	"PATCH /api/v1/products/:id":          owner,
	"POST /api/v1/products/:id/archive":   owner,
	"POST /api/v1/categories":             owner,
	"PATCH /api/v1/categories/:id":        owner,
	"POST /api/v1/categories/:id/archive": owner,
	"POST /api/v1/inventory/restocks":     owner,
	"POST /api/v1/inventory/adjustments":  owner,
	"POST /api/v1/sales/:id/void":         owner,
	"GET /api/v1/settings/store":          owner,
	"PATCH /api/v1/settings/store":        owner,
	"GET /api/v1/settings/team":           owner,
	"POST /api/v1/settings/team":          owner,
}

func TestEveryRouteIsClassified(t *testing.T) {
	e := newEnv(t)
	seen := map[string]bool{}
	var missing []string
	for _, r := range e.api.Router().Routes() {
		k := r.Method + " " + r.Path
		if strings.HasPrefix(r.Method, "echo_route_") || r.Method == "" {
			continue // internal not-found / method-not-allowed handlers
		}
		seen[k] = true
		if _, ok := routeAccess[k]; !ok {
			missing = append(missing, k)
		}
	}
	var stale []string
	for k := range routeAccess {
		if !seen[k] {
			stale = append(stale, k)
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)
	if len(missing) > 0 || len(stale) > 0 {
		t.Fatalf("security matrix out of date\nunclassified routes: %v\nclassified but not registered: %v", missing, stale)
	}
}

// fixture: Toko A (owner + staff) with one of every resource, Toko B owner.
type matrixFixture struct {
	a, staff, b, anon *client
	ids               map[string]string // ":id" value per resource prefix
	productID         string
}

func newMatrixFixture(t *testing.T, e *env) matrixFixture {
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	a.mustStatus(a.do("POST", "/api/v1/settings/team", map[string]any{"name": "Kasir", "email": "kasir@toko.id", "password": "kasir-12345"}), 201)
	staff := e.client(t)
	staff.mustStatus(staff.do("POST", "/api/v1/auth/login", map[string]any{"email": "kasir@toko.id", "password": "kasir-12345"}), 200)

	cat := a.mustStatus(a.do("POST", "/api/v1/categories", map[string]any{"name": "Minuman"}), 201).body["id"].(string)
	prod := a.createProduct(kopi(nil))["id"].(string)
	sale := a.mustStatus(a.do("POST", "/api/v1/sales", checkout("matrix-sale-1", 0, line(prod, "1"))), 201).body["id"].(string)
	conv := a.newConversation()
	return matrixFixture{
		a: a, staff: staff, b: b, anon: e.client(t), productID: prod,
		ids: map[string]string{"products": prod, "categories": cat, "sales": sale, "assistant": conv},
	}
}

// path fills ":id" with Toko A's real resource id for that route.
func (f matrixFixture) path(route string) string {
	p := route[strings.Index(route, " ")+1:]
	if !strings.Contains(p, ":id") {
		return p
	}
	res := strings.Split(strings.TrimPrefix(p, "/api/v1/"), "/")[0]
	return strings.Replace(p, ":id", f.ids[res], 1)
}

// body is a *valid* request body, so a rejection proves authorization, not validation.
func (f matrixFixture) body(route string) any {
	product := kopi(map[string]any{"name": "Diretas", "selling_price": 1})
	delete(product, "initial_stock")
	switch route {
	case "POST /api/v1/products":
		return kopi(map[string]any{"sku": "new-1"})
	case "PATCH /api/v1/products/:id":
		return product
	case "POST /api/v1/categories", "PATCH /api/v1/categories/:id":
		return map[string]any{"name": "Diretas"}
	case "POST /api/v1/inventory/restocks":
		return map[string]any{"product_id": f.productID, "quantity": "5", "note": "Diretas"}
	case "POST /api/v1/inventory/adjustments":
		return map[string]any{"product_id": f.productID, "direction": "OUT", "quantity": "1", "reason_code": "DAMAGED"}
	case "POST /api/v1/sales":
		return checkout("matrix-sale-x", 0, line(f.productID, "1"))
	case "POST /api/v1/sales/:id/void":
		return map[string]any{"reason": "Diretas"}
	case "PATCH /api/v1/settings/store":
		return map[string]any{"name": "Diretas"}
	case "POST /api/v1/settings/team":
		return map[string]any{"name": "X", "email": "x@toko.id", "password": "rahasia-123"}
	case "POST /api/v1/assistant/conversations/:id/messages":
		return map[string]any{"content": "hai"}
	case "POST /api/v1/stores":
		return map[string]any{"name": "Toko Baru"}
	}
	return nil
}

func routesWith(min access) []string {
	var out []string
	for k, a := range routeAccess {
		if a >= min {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func TestSecurityMatrix(t *testing.T) {
	e := newEnv(t)
	f := newMatrixFixture(t, e)
	method := func(route string) string { return route[:strings.Index(route, " ")] }

	t.Run("anonymous gets 401 on every non-public route", func(t *testing.T) {
		for _, r := range routesWith(authed) {
			if got := f.anon.do(method(r), f.path(r), f.body(r)); got.status != http.StatusUnauthorized {
				t.Errorf("%s → %d %s, want 401", r, got.status, got.code())
			}
		}
	})

	t.Run("state-changing routes reject a missing CSRF token", func(t *testing.T) {
		noCSRF := *f.a
		noCSRF.noCSRF = true
		for _, r := range routesWith(authed) {
			if method(r) == http.MethodGet {
				continue
			}
			if got := noCSRF.do(method(r), f.path(r), f.body(r)); got.status != http.StatusForbidden || got.code() != "CSRF_INVALID" {
				t.Errorf("%s without CSRF → %d %s, want 403 CSRF_INVALID", r, got.status, got.code())
			}
		}
	})

	t.Run("staff gets 403 on every owner route (role escalation)", func(t *testing.T) {
		for _, r := range routesWith(owner) {
			if got := f.staff.do(method(r), f.path(r), f.body(r)); got.status != http.StatusForbidden || got.code() != "FORBIDDEN" {
				t.Errorf("staff %s → %d %s, want 403 FORBIDDEN", r, got.status, got.code())
			}
		}
	})

	t.Run("another store gets 404 for every :id route (IDOR)", func(t *testing.T) {
		for _, r := range routesWith(tenant) {
			if !strings.Contains(r, ":id") {
				continue
			}
			if got := f.b.do(method(r), f.path(r), f.body(r)); got.status != http.StatusNotFound {
				t.Errorf("store B %s → %d %s, want 404", r, got.status, got.code())
			}
		}
	})

	t.Run("another store cannot reference Toko A's product in a body", func(t *testing.T) {
		for _, r := range []string{"POST /api/v1/inventory/restocks", "POST /api/v1/inventory/adjustments", "POST /api/v1/sales"} {
			// 404 (not 400): the body is valid, the product just does not exist for store B.
			if got := f.b.do(method(r), f.path(r), f.body(r)); got.status != http.StatusNotFound {
				t.Errorf("store B %s with A's product → %d %s, want 404", r, got.status, got.code())
			}
		}
	})

	t.Run("nothing in Toko A changed and nothing leaked", func(t *testing.T) {
		p := f.a.mustStatus(f.a.do("GET", "/api/v1/products/"+f.productID, nil), 200).body
		if p["name"] != "Kopi Arabica 250g" || p["selling_price"] != float64(68000) || p["current_stock"] != "23.000" || p["is_active"] != true {
			t.Fatalf("product A changed: %v", p)
		}
		s := f.a.mustStatus(f.a.do("GET", "/api/v1/sales/"+f.ids["sales"], nil), 200).body
		if s["status"] != "COMPLETED" {
			t.Fatalf("sale A changed: %v", s["status"])
		}
		if n := count(t, e, `SELECT count(*) FROM stock_movements WHERE product_id = $1`, f.productID); n != 2 {
			t.Fatalf("stock movements on A's product = %d, want 2 (initial + sale)", n)
		}
		if n := count(t, e, `SELECT count(*) FROM sales`); n != 1 {
			t.Fatalf("sales = %d, want 1", n)
		}
		// List endpoints of B never contain A's data.
		for _, path := range []string{"/api/v1/products", "/api/v1/sales", "/api/v1/inventory/movements", "/api/v1/assistant/conversations", "/api/v1/categories"} {
			r := f.b.mustStatus(f.b.do("GET", path, nil), 200)
			for _, id := range f.ids {
				if strings.Contains(r.raw, id) {
					t.Errorf("store B %s leaks Toko A id %s", path, id)
				}
			}
		}
	})
}
