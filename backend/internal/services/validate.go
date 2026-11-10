// Package services holds business rules. Handlers stay thin; repositories do SQL.
package services

import (
	"net/mail"
	"slices"
	"strings"
	"unicode/utf8"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/domain"
)

const (
	minPasswordLen = 8
	// Upper bound protects the argon2 hasher from oversized input.
	maxPasswordLen = 128
)

// NormalizeEmail trims and lower-cases an address for storage and lookup.
func NormalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func validateName(fe apperr.FieldErrors, field, value, label string) string {
	v := strings.Join(strings.Fields(value), " ")
	switch n := utf8.RuneCountInString(v); {
	case n == 0:
		fe[field] = label + " wajib diisi."
	case n > 100:
		fe[field] = label + " maksimal 100 karakter."
	}
	return v
}

func validateEmail(fe apperr.FieldErrors, value string) string {
	v := NormalizeEmail(value)
	addr, err := mail.ParseAddress(v)
	if v == "" {
		fe["email"] = "Email wajib diisi."
	} else if err != nil || addr.Address != v || len(v) > 254 || !strings.Contains(v[strings.LastIndex(v, "@")+1:], ".") {
		fe["email"] = "Format email tidak valid."
	}
	return v
}

func validatePassword(fe apperr.FieldErrors, value string) {
	switch n := utf8.RuneCountInString(value); {
	case n < minPasswordLen:
		fe["password"] = "Password minimal 8 karakter."
	case n > maxPasswordLen:
		fe["password"] = "Password maksimal 128 karakter."
	}
}

func validateTimezone(fe apperr.FieldErrors, value string) string {
	if value == "" {
		return domain.DefaultTimezone
	}
	if !slices.Contains(domain.StoreTimezones, value) {
		fe["timezone"] = "Zona waktu harus WIB, WITA, atau WIT."
	}
	return value
}

// validateAddress returns nil for blank input so an empty field clears the address.
func validateAddress(fe apperr.FieldErrors, value *string) *string {
	if value == nil {
		return nil
	}
	v := strings.TrimSpace(*value)
	if v == "" {
		return nil
	}
	if utf8.RuneCountInString(v) > 500 {
		fe["address"] = "Alamat maksimal 500 karakter."
	}
	return &v
}
