package middleware

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/auth"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/httpx"
	"tokopilot/backend/internal/services"
)

type fakeAuth struct{}

func (fakeAuth) Authenticate(_ context.Context, token string) (services.Principal, error) {
	if token == "good" {
		return services.Principal{SessionID: "sess-1", User: domain.User{ID: "user-1"}}, nil
	}
	return services.Principal{}, apperr.Unauthenticated()
}

type fakeMembership map[string]domain.Membership

func (f fakeMembership) MembershipFor(_ context.Context, userID string) (domain.Membership, error) {
	if m, ok := f[userID]; ok {
		return m, nil
	}
	return domain.Membership{}, domain.ErrNotFound
}

var secret = []byte(strings.Repeat("k", 32))

func newEcho(m fakeMembership, roles ...domain.Role) *echo.Echo {
	e := echo.New()
	e.HTTPErrorHandler = httpx.ErrorHandler(slog.New(slog.NewTextHandler(io.Discard, nil)))
	chain := []echo.MiddlewareFunc{Session(fakeAuth{}), CSRF(secret), Tenant(m)}
	if len(roles) > 0 {
		chain = append(chain, RequireRole(roles...))
	}
	h := func(c *echo.Context) error { return c.String(http.StatusOK, TenantFrom(c).Store.ID) }
	e.GET("/x", h, chain...)
	e.POST("/x", h, chain...)
	return e
}

func call(e *echo.Echo, method, cookie, csrf string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/x", nil)
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: SessionCookie, Value: cookie})
	}
	if csrf != "" {
		req.Header.Set(CSRFHeader, csrf)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

var owner = fakeMembership{"user-1": {Store: domain.Store{ID: "store-A"}, Role: domain.RoleOwner}}

func TestSessionRequired(t *testing.T) {
	e := newEcho(owner)
	if rec := call(e, http.MethodGet, "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no cookie: %d", rec.Code)
	}
	if rec := call(e, http.MethodGet, "forged", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad cookie: %d", rec.Code)
	}
	rec := call(e, http.MethodGet, "good", "")
	if rec.Code != http.StatusOK || rec.Body.String() != "store-A" {
		t.Fatalf("good cookie: %d %s", rec.Code, rec.Body.String())
	}
}

func TestCSRFRequiredOnUnsafeMethods(t *testing.T) {
	e := newEcho(owner)
	if rec := call(e, http.MethodPost, "good", ""); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "CSRF_INVALID") {
		t.Fatalf("missing csrf: %d %s", rec.Code, rec.Body.String())
	}
	if rec := call(e, http.MethodPost, "good", auth.CSRFToken(secret, "other-session")); rec.Code != http.StatusForbidden {
		t.Fatalf("csrf for other session: %d", rec.Code)
	}
	if rec := call(e, http.MethodPost, "good", auth.CSRFToken(secret, "sess-1")); rec.Code != http.StatusOK {
		t.Fatalf("valid csrf: %d", rec.Code)
	}
}

func TestTenantRequiresMembership(t *testing.T) {
	e := newEcho(fakeMembership{})
	rec := call(e, http.MethodGet, "good", "")
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "STORE_REQUIRED") {
		t.Fatalf("no membership: %d %s", rec.Code, rec.Body.String())
	}
}

func TestRequireRole(t *testing.T) {
	staff := fakeMembership{"user-1": {Store: domain.Store{ID: "store-A"}, Role: domain.RoleStaff}}
	if rec := call(newEcho(staff, domain.RoleOwner), http.MethodGet, "good", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("staff on owner route: %d", rec.Code)
	}
	if rec := call(newEcho(owner, domain.RoleOwner), http.MethodGet, "good", ""); rec.Code != http.StatusOK {
		t.Fatalf("owner on owner route: %d", rec.Code)
	}
}

func TestOriginCheck(t *testing.T) {
	e := echo.New()
	e.HTTPErrorHandler = httpx.ErrorHandler(slog.New(slog.NewTextHandler(io.Discard, nil)))
	e.Use(OriginCheck("http://localhost:5173"))
	e.POST("/x", func(c *echo.Context) error { return c.NoContent(http.StatusNoContent) })

	for origin, want := range map[string]int{"": 204, "http://localhost:5173": 204, "https://evil.example": 403} {
		req := httptest.NewRequest(http.MethodPost, "/x", nil)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("origin %q: %d, want %d", origin, rec.Code, want)
		}
	}
}
