package domain

import (
	"encoding/json"
	"testing"
)

func TestParseQuantity(t *testing.T) {
	cases := []struct {
		in    string
		scale int
		want  string
		err   error
	}{
		{"10", 0, "10.000", nil},
		{"0", 0, "0.000", nil},
		{"007", 0, "7.000", nil},
		{"2.5", 3, "2.500", nil},
		{"2.500", 1, "2.500", nil},
		{"2.000", 0, "2.000", nil}, // only trailing zeros: fits scale 0
		{"2.5", 0, "", ErrQuantityScale},
		{"1.25", 1, "", ErrQuantityScale},
		{"12345678901.125", 3, "12345678901.125", nil},
		{"123456789012", 0, "", ErrQuantityFormat}, // > 11 integer digits
		{"-1", 0, "", ErrQuantityFormat},
		{"1e3", 0, "", ErrQuantityFormat},
		{"1,5", 1, "", ErrQuantityFormat},
		{"", 0, "", ErrQuantityFormat},
		{"1.2345", 3, "", ErrQuantityFormat},
	}
	for _, c := range cases {
		got, err := ParseQuantity(c.in, c.scale)
		if err != c.err || (err == nil && got != c.want) {
			t.Errorf("ParseQuantity(%q,%d) = %q,%v; want %q,%v", c.in, c.scale, got, err, c.want, c.err)
		}
	}
}

func TestCompareAndNegateQuantity(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"5.000", "5", 0}, {"10.000", "9.999", 1}, {"0.001", "0.010", -1}, {"100.000", "20.500", 1},
		{"007.000", "7.000", 0}, {"0.000", "0", 0}, {"12345678901.125", "12345678901.124", 1},
	}
	for _, c := range cases {
		if got := CompareQuantity(c.a, c.b); got != c.want {
			t.Errorf("CompareQuantity(%s,%s) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
	if NegateQuantity("2.500") != "-2.500" || NegateQuantity("0.000") != "0.000" {
		t.Fatal("NegateQuantity wrong")
	}
}

func TestIsZeroQuantity(t *testing.T) {
	if !IsZeroQuantity("0.000") || IsZeroQuantity("0.001") || IsZeroQuantity("10.000") {
		t.Fatal("IsZeroQuantity wrong")
	}
}

func TestDecimalInputAcceptsStringAndNumber(t *testing.T) {
	var v struct {
		A DecimalInput `json:"a"`
		B DecimalInput `json:"b"`
	}
	if err := json.Unmarshal([]byte(`{"a":"2.50","b":12.125}`), &v); err != nil {
		t.Fatal(err)
	}
	if v.A != "2.50" || v.B != "12.125" {
		t.Fatalf("got %q %q", v.A, v.B)
	}
	if err := json.Unmarshal([]byte(`{"a":true}`), &v); err == nil {
		t.Fatal("bool must be rejected")
	}
}
