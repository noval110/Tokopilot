// Package middleware enforces authentication, CSRF, tenant scope and roles.
// Order on protected routes: Session → CSRF → Tenant → RequireRole.
package middleware

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/auth"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/services"
)

const (
	SessionCookie = "tp_session"
	CSRFCookie    = "tp_csrf"
	CSRFHeader    = "X-CSRF-Token"

	principalKey = "principal"
	tenantKey    = "tenant"
)

type Authenticator interface {
	Authenticate(ctx context.Context, token string) (services.Principal, error)
}

type MembershipResolver interface {
	MembershipFor(ctx context.Context, userID string) (domain.Membership, error)
}

// Session requires a valid session cookie and stores the principal.
func Session(a Authenticator) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			cookie, err := c.Request().Cookie(SessionCookie)
			if err != nil {
				return apperr.Unauthenticated()
			}
			p, err := a.Authenticate(c.Request().Context(), cookie.Value)
			if err != nil {
				return err
			}
			c.Set(principalKey, p)
			return next(c)
		}
	}
}

// PrincipalFrom returns the authenticated caller. Only valid behind Session.
func PrincipalFrom(c *echo.Context) services.Principal {
	p, _ := c.Get(principalKey).(services.Principal)
	return p
}

func unsafeMethod(m string) bool {
	return m != http.MethodGet && m != http.MethodHead && m != http.MethodOptions
}

// CSRF requires state-changing requests to echo the session-bound token from
// the tp_csrf cookie in the X-CSRF-Token header (double submit, ADR-0002).
func CSRF(secret []byte) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			if unsafeMethod(c.Request().Method) {
				p := PrincipalFrom(c)
				if !auth.ValidCSRF(secret, p.SessionID, c.Request().Header.Get(CSRFHeader)) {
					return apperr.New(http.StatusForbidden, "CSRF_INVALID", "Sesi formulir tidak valid. Muat ulang halaman lalu coba lagi.")
				}
			}
			return next(c)
		}
	}
}

// OriginCheck rejects state-changing browser requests from foreign origins.
// Requests without an Origin header (non-browser clients) are allowed; they
// cannot carry a victim's cookies cross-site anyway.
func OriginCheck(allowed string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			if unsafeMethod(c.Request().Method) {
				if o := c.Request().Header.Get(echo.HeaderOrigin); o != "" && o != allowed {
					return apperr.Forbidden("Asal permintaan tidak diizinkan.")
				}
			}
			return next(c)
		}
	}
}

// Tenant resolves the caller's store from server-side membership. This is the
// ONLY place store_id and role enter the request context (BR-01, FR-STORE-03).
func Tenant(r MembershipResolver) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			m, err := r.MembershipFor(c.Request().Context(), PrincipalFrom(c).User.ID)
			if errors.Is(err, domain.ErrNotFound) {
				return apperr.New(http.StatusForbidden, "STORE_REQUIRED", "Buat toko terlebih dahulu.")
			}
			if err != nil {
				return err
			}
			c.Set(tenantKey, m)
			return next(c)
		}
	}
}

// TenantFrom returns the verified membership. Only valid behind Tenant.
func TenantFrom(c *echo.Context) domain.Membership {
	m, _ := c.Get(tenantKey).(domain.Membership)
	return m
}

// RequireRole allows only the listed roles (checked server-side, not by hiding buttons).
func RequireRole(roles ...domain.Role) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			m := TenantFrom(c)
			if m.Store.ID == "" || !slices.Contains(roles, m.Role) {
				return apperr.Forbidden("")
			}
			return next(c)
		}
	}
}
