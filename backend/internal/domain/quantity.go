package domain

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
)

// NUMERIC(14,3): at most 11 integer digits and 3 decimals.
var quantityRe = regexp.MustCompile(`^(\d{1,11})(?:\.(\d{1,3}))?$`)

var (
	ErrQuantityFormat = errors.New("invalid quantity format")
	ErrQuantityScale  = errors.New("too many decimal places for unit")
)

// ParseQuantity validates a non-negative decimal string against a unit scale
// and returns a canonical form with exactly 3 decimals (e.g. "2.5" -> "2.500").
// Arithmetic on quantities happens in PostgreSQL NUMERIC, never in float64.
func ParseQuantity(s string, unitScale int) (string, error) {
	s = strings.TrimSpace(s)
	m := quantityRe.FindStringSubmatch(s)
	if m == nil {
		return "", ErrQuantityFormat
	}
	whole, frac := strings.TrimLeft(m[1], "0"), strings.TrimRight(m[2], "0")
	if whole == "" {
		whole = "0"
	}
	if len(frac) > unitScale {
		return "", ErrQuantityScale
	}
	return whole + "." + frac + strings.Repeat("0", 3-len(frac)), nil
}

// IsZeroQuantity reports whether a canonical quantity is zero.
func IsZeroQuantity(q string) bool { return strings.Trim(q, "0.-") == "" }

// NegateQuantity flips the sign of a canonical non-negative quantity.
func NegateQuantity(q string) string {
	if IsZeroQuantity(q) {
		return q
	}
	return "-" + q
}

// CompareQuantity compares two non-negative NUMERIC strings exactly
// (no float): -1 if a < b, 0 if equal, 1 if a > b.
func CompareQuantity(a, b string) int {
	split := func(s string) (string, string) {
		w, f, _ := strings.Cut(s, ".")
		w = strings.TrimLeft(w, "0")
		return w, (f + "000")[:3]
	}
	aw, af := split(a)
	bw, bf := split(b)
	switch {
	case len(aw) != len(bw):
		if len(aw) < len(bw) {
			return -1
		}
		return 1
	case aw != bw:
		return strings.Compare(aw, bw)
	default:
		return strings.Compare(af, bf)
	}
}

// DecimalInput accepts a quantity as a JSON string ("2.5") or bare number (2.5)
// and keeps the original text so no precision is lost to float parsing.
type DecimalInput string

func (d *DecimalInput) UnmarshalJSON(b []byte) error {
	if len(b) > 0 && b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*d = DecimalInput(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	*d = DecimalInput(n.String())
	return nil
}
