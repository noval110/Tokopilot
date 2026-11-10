package httpx

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
)

const requestIDKey = "request_id"

// Inbound IDs are accepted only when they are short and log-safe, so a client
// cannot inject newlines or huge values into structured logs.
var safeRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

func newRequestID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failing means the platform is broken; surface it loudly.
		panic("crypto/rand unavailable: " + err.Error())
	}
	return "req_" + hex.EncodeToString(b[:])
}

// RequestID assigns every request a correlation ID, reusing a safe inbound
// X-Request-Id when present, and echoes it in the response header.
func RequestID() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			id := c.Request().Header.Get(echo.HeaderXRequestID)
			if !safeRequestID.MatchString(id) {
				id = newRequestID()
			}
			c.Set(requestIDKey, id)
			c.Response().Header().Set(echo.HeaderXRequestID, id)
			return next(c)
		}
	}
}

// RequestIDFrom returns the request ID set by RequestID, or "" if absent.
func RequestIDFrom(c *echo.Context) string {
	if id, ok := c.Get(requestIDKey).(string); ok {
		return id
	}
	return ""
}

// AccessLog writes one structured line per request. Query strings and headers
// are deliberately omitted: they may carry tokens or personal data.
func AccessLog(logger *slog.Logger) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			start := time.Now()
			err := next(c)
			_, status := echo.ResolveResponseStatus(c.Response(), err)
			level := slog.LevelInfo
			if status >= 500 {
				level = slog.LevelError
			} else if status >= 400 {
				level = slog.LevelWarn
			}
			logger.LogAttrs(c.Request().Context(), level, "http_request",
				slog.String("request_id", RequestIDFrom(c)),
				slog.String("method", c.Request().Method),
				slog.String("path", c.Request().URL.Path),
				slog.Int("status", status),
				slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			)
			return err
		}
	}
}

// SecurityHeaders sets conservative defaults for a JSON API.
func SecurityHeaders() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			h := c.Response().Header()
			h.Set(echo.HeaderXContentTypeOptions, "nosniff")
			h.Set(echo.HeaderXFrameOptions, "DENY")
			h.Set(echo.HeaderReferrerPolicy, "no-referrer")
			h.Set(echo.HeaderContentSecurityPolicy, "default-src 'none'; frame-ancestors 'none'")
			if strings.HasPrefix(c.Request().URL.Path, "/api/") {
				h.Set(echo.HeaderCacheControl, "no-store")
			}
			return next(c)
		}
	}
}
