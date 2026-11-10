// Package httpx contains HTTP plumbing shared by every handler: the error
// envelope from PRD §12.2, request IDs, access logging and security headers.
package httpx

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/apperr"
)

// Error codes are stable, machine-readable identifiers for clients.
const (
	CodeValidation       = "VALIDATION_ERROR"
	CodeUnauthenticated  = "UNAUTHENTICATED"
	CodeForbidden        = "FORBIDDEN"
	CodeNotFound         = "NOT_FOUND"
	CodeMethodNotAllowed = "METHOD_NOT_ALLOWED"
	CodeConflict         = "CONFLICT"
	CodePayloadTooLarge  = "PAYLOAD_TOO_LARGE"
	CodeRateLimited      = "RATE_LIMITED"
	CodeUnavailable      = "SERVICE_UNAVAILABLE"
	CodeInternal         = "INTERNAL_ERROR"
)

// AppError is the client-visible error type (defined in apperr so services do
// not depend on the HTTP layer).
type AppError = apperr.Error

// NewError builds an AppError with the given status, code and message.
func NewError(status int, code, message string) *AppError { return apperr.New(status, code, message) }

type errorBody struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	Details   map[string]any `json:"details,omitempty"`
	RequestID string         `json:"request_id"`
}

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

// Messages are in Bahasa Indonesia because they may be shown directly in UI.
var defaultByStatus = map[int]struct{ code, msg string }{
	http.StatusBadRequest:            {CodeValidation, "Permintaan tidak valid."},
	http.StatusUnauthorized:          {CodeUnauthenticated, "Silakan masuk terlebih dahulu."},
	http.StatusForbidden:             {CodeForbidden, "Anda tidak memiliki akses untuk tindakan ini."},
	http.StatusNotFound:              {CodeNotFound, "Data tidak ditemukan."},
	http.StatusMethodNotAllowed:      {CodeMethodNotAllowed, "Metode tidak didukung."},
	http.StatusConflict:              {CodeConflict, "Permintaan bertentangan dengan data saat ini."},
	http.StatusRequestEntityTooLarge: {CodePayloadTooLarge, "Ukuran permintaan terlalu besar."},
	http.StatusTooManyRequests:       {CodeRateLimited, "Terlalu banyak permintaan. Coba lagi nanti."},
	http.StatusServiceUnavailable:    {CodeUnavailable, "Layanan sementara tidak tersedia."},
}

// ErrorHandler converts any returned error into the standard envelope. Unknown
// errors become a generic 500 so internals and stack traces never leak.
func ErrorHandler(logger *slog.Logger) echo.HTTPErrorHandler {
	return func(c *echo.Context, err error) {
		if resp, uerr := echo.UnwrapResponse(c.Response()); uerr == nil && resp.Committed {
			return
		}

		body := errorBody{RequestID: RequestIDFrom(c)}
		status := http.StatusInternalServerError

		var appErr *AppError
		var coder interface{ StatusCode() int }
		switch {
		case errors.As(err, &appErr):
			status, body.Code, body.Message, body.Details = appErr.Status, appErr.Code, appErr.Message, appErr.Details
		case errors.As(err, &coder) && coder.StatusCode() >= 400 && coder.StatusCode() < 500:
			status = coder.StatusCode()
		case errors.As(err, &coder) && coder.StatusCode() == http.StatusServiceUnavailable:
			status = coder.StatusCode()
		}

		if body.Code == "" {
			if d, ok := defaultByStatus[status]; ok {
				body.Code, body.Message = d.code, d.msg
			} else if status >= 500 {
				body.Code, body.Message = CodeInternal, "Terjadi kesalahan pada server."
			} else {
				body.Code, body.Message = CodeValidation, http.StatusText(status)
			}
		}

		if status == http.StatusTooManyRequests {
			if ra, ok := body.Details["retry_after_seconds"].(string); ok {
				c.Response().Header().Set(echo.HeaderRetryAfter, ra)
			}
		}

		if status >= 500 {
			logger.ErrorContext(c.Request().Context(), "request failed",
				slog.String("request_id", body.RequestID),
				slog.Int("status", status),
				slog.String("error", err.Error()))
		}

		if c.Request().Method == http.MethodHead {
			_ = c.NoContent(status)
			return
		}
		if werr := c.JSON(status, errorEnvelope{Error: body}); werr != nil {
			logger.ErrorContext(c.Request().Context(), "write error response", slog.String("error", werr.Error()))
		}
	}
}
