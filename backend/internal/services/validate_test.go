package services

import (
	"strings"
	"testing"

	"tokopilot/backend/internal/apperr"
)

func TestValidateEmail(t *testing.T) {
	cases := map[string]bool{
		"sari@warung.id":         true,
		"  Sari@Warung.ID  ":     true,
		"bu.sari+kasir@toko.com": true,
		"":                       false,
		"sari":                   false,
		"sari@localhost":         false,
		"Sari <sari@warung.id>":  false,
		"sari @warung.id":        false,
	}
	for in, ok := range cases {
		fe := apperr.FieldErrors{}
		out := validateEmail(fe, in)
		if got := fe["email"] == ""; got != ok {
			t.Errorf("validateEmail(%q) ok=%v, want %v (%s)", in, got, ok, fe["email"])
		}
		if ok && out != strings.ToLower(strings.TrimSpace(in)) {
			t.Errorf("email not normalized: %q", out)
		}
	}
}

func TestValidateNameCollapsesWhitespaceAndBounds(t *testing.T) {
	fe := apperr.FieldErrors{}
	if got := validateName(fe, "name", "  Warung   Bu  Sari ", "Nama"); got != "Warung Bu Sari" {
		t.Fatalf("got %q", got)
	}
	validateName(fe, "a", "   ", "Nama")
	validateName(fe, "b", strings.Repeat("x", 101), "Nama")
	if fe["a"] == "" || fe["b"] == "" || fe["name"] != "" {
		t.Fatalf("unexpected field errors: %v", fe)
	}
}

func TestValidatePasswordBounds(t *testing.T) {
	for pw, ok := range map[string]bool{"1234567": false, "12345678": true, strings.Repeat("a", 128): true, strings.Repeat("a", 129): false} {
		fe := apperr.FieldErrors{}
		validatePassword(fe, pw)
		if (fe["password"] == "") != ok {
			t.Errorf("len %d ok=%v, want %v", len(pw), fe["password"] == "", ok)
		}
	}
}

func TestValidateTimezone(t *testing.T) {
	fe := apperr.FieldErrors{}
	if validateTimezone(fe, "") != "Asia/Jakarta" {
		t.Fatal("blank timezone should default to Asia/Jakarta")
	}
	validateTimezone(fe, "Asia/Makassar")
	if len(fe) != 0 {
		t.Fatalf("WITA rejected: %v", fe)
	}
	validateTimezone(fe, "Europe/London")
	if fe["timezone"] == "" {
		t.Fatal("non-Indonesian timezone accepted")
	}
}

func TestValidateAddressBlankClears(t *testing.T) {
	fe := apperr.FieldErrors{}
	blank := "   "
	if validateAddress(fe, &blank) != nil {
		t.Fatal("blank address should become nil")
	}
	long := strings.Repeat("x", 501)
	validateAddress(fe, &long)
	if fe["address"] == "" {
		t.Fatal("over-long address accepted")
	}
}
