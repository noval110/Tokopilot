package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/auth"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/httpx"
	"tokopilot/backend/internal/middleware"
	"tokopilot/backend/internal/ratelimit"
	"tokopilot/backend/internal/services"
)

type Auth struct {
	Svc          *services.AuthService
	Stores       *services.StoreService
	CSRFSecret   []byte
	SecureCookie bool
	// LoginFailures: 5 failed attempts / 15 min per email+IP (ADR-0008).
	LoginFailures *ratelimit.Limiter
	// AuthRequests: coarse per-IP cap on login/register calls.
	AuthRequests *ratelimit.Limiter
}

func (h *Auth) setSessionCookies(c *echo.Context, issued services.IssuedSession) {
	maxAge := int(time.Until(issued.Session.AbsoluteExpiresAt).Seconds())
	c.SetCookie(&http.Cookie{
		Name: middleware.SessionCookie, Value: issued.Token, Path: "/", MaxAge: maxAge,
		HttpOnly: true, Secure: h.SecureCookie, SameSite: http.SameSiteLaxMode,
	})
	// Readable by JS on purpose: the SPA echoes it in X-CSRF-Token.
	c.SetCookie(&http.Cookie{
		Name: middleware.CSRFCookie, Value: auth.CSRFToken(h.CSRFSecret, issued.Session.ID), Path: "/", MaxAge: maxAge,
		HttpOnly: false, Secure: h.SecureCookie, SameSite: http.SameSiteLaxMode,
	})
}

func (h *Auth) clearSessionCookies(c *echo.Context) {
	for _, name := range []string{middleware.SessionCookie, middleware.CSRFCookie} {
		c.SetCookie(&http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: name == middleware.SessionCookie,
			Secure: h.SecureCookie, SameSite: http.SameSiteLaxMode})
	}
}

func (h *Auth) throttleIP(c *echo.Context) error {
	if ok, wait := h.AuthRequests.Allow("ip:" + c.RealIP()); !ok {
		return apperr.RateLimited(wait)
	}
	return nil
}

// Register: POST /api/v1/auth/register
func (h *Auth) Register(c *echo.Context) error {
	if err := h.throttleIP(c); err != nil {
		return err
	}
	var in services.RegisterInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	user, issued, err := h.Svc.Register(c.Request().Context(), in)
	if err != nil {
		return err
	}
	h.setSessionCookies(c, issued)
	return c.JSON(http.StatusCreated, meDTO{User: toUser(user)})
}

// Login: POST /api/v1/auth/login
func (h *Auth) Login(c *echo.Context) error {
	if err := h.throttleIP(c); err != nil {
		return err
	}
	var in services.LoginInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	key := "login:" + services.NormalizeEmail(in.Email) + "|" + c.RealIP()
	if blocked, wait := h.LoginFailures.Blocked(key); blocked {
		return apperr.RateLimited(wait)
	}

	user, issued, err := h.Svc.Login(c.Request().Context(), in)
	if err != nil {
		var ae *apperr.Error
		if errors.As(err, &ae) && ae.Code == "INVALID_CREDENTIALS" {
			h.LoginFailures.Hit(key)
		}
		return err
	}
	h.LoginFailures.Reset(key)
	h.setSessionCookies(c, issued)

	resp := meDTO{User: toUser(user)}
	if m, err := h.Stores.MembershipFor(c.Request().Context(), user.ID); err == nil {
		resp.Membership = toMembership(m)
	} else if !errors.Is(err, domain.ErrNotFound) {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}

// Logout: POST /api/v1/auth/logout (behind Session + CSRF)
func (h *Auth) Logout(c *echo.Context) error {
	if err := h.Svc.Logout(c.Request().Context(), middleware.PrincipalFrom(c).SessionID); err != nil {
		return err
	}
	h.clearSessionCookies(c)
	return c.NoContent(http.StatusNoContent)
}
