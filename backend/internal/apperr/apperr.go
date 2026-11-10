// Package apperr defines client-visible errors returned by services. The HTTP
// layer renders them into the PRD §12.2 envelope; Cause is logged only.
package apperr

import (
	"net/http"
	"strconv"
	"time"
)

type Error struct {
	Status  int
	Code    string
	Message string
	Details map[string]any
	Cause   error
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return e.Code + ": " + e.Cause.Error()
	}
	return e.Code + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.Cause }

// StatusCode lets Echo (and the access log) resolve the real HTTP status.
func (e *Error) StatusCode() int { return e.Status }

func New(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

// FieldErrors maps a JSON field name to an Indonesian, user-facing message.
type FieldErrors map[string]string

// Validation returns a 400 with per-field messages, or nil when fe is empty.
func Validation(fe FieldErrors) error {
	if len(fe) == 0 {
		return nil
	}
	return &Error{
		Status:  http.StatusBadRequest,
		Code:    "VALIDATION_ERROR",
		Message: "Periksa kembali isian formulir.",
		Details: map[string]any{"fields": map[string]string(fe)},
	}
}

func Unauthenticated() *Error {
	return New(http.StatusUnauthorized, "UNAUTHENTICATED", "Silakan masuk terlebih dahulu.")
}

func Forbidden(message string) *Error {
	if message == "" {
		message = "Anda tidak memiliki akses untuk tindakan ini."
	}
	return New(http.StatusForbidden, "FORBIDDEN", message)
}

func NotFound(message string) *Error {
	if message == "" {
		message = "Data tidak ditemukan."
	}
	return New(http.StatusNotFound, "NOT_FOUND", message)
}

func Conflict(code, message string) *Error {
	return New(http.StatusConflict, code, message)
}

func RateLimited(retryAfter time.Duration) *Error {
	secs := int(retryAfter.Seconds())
	if secs < 1 {
		secs = 1
	}
	return &Error{
		Status:  http.StatusTooManyRequests,
		Code:    "RATE_LIMITED",
		Message: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit.",
		Details: map[string]any{"retry_after_seconds": strconv.Itoa(secs)},
	}
}
