package domain

import "testing"

func TestLineSubtotalHalfUp(t *testing.T) {
	cases := []struct {
		price int64
		qty   string
		want  int64
	}{
		{68000, "2.000", 136000},
		{12333, "1.500", 18500}, // 18.499,5 → 18.500 (ADR-0005 example)
		{12333, "1.499", 18487}, // 18.487,167 → 18.487
		{12333, "0.001", 12},    // 12,333 → 12
		{1, "0.500", 1},         // 0,5 → 1 (half-up)
		{1, "0.499", 0},
		{0, "5.000", 0},
		{15000, "12.125", 181875},
		{1_000_000_000_000, "999.000", 999_000_000_000_000}, // within the Rp 10^15 cap
	}
	for _, c := range cases {
		got, err := LineSubtotal(c.price, c.qty)
		if err != nil || got != c.want {
			t.Errorf("LineSubtotal(%d, %s) = %d, %v; want %d", c.price, c.qty, got, err, c.want)
		}
	}
	if _, err := LineSubtotal(1_000_000_000_000, "1001.000"); err != ErrLineTooLarge {
		t.Errorf("expected ErrLineTooLarge, got %v", err)
	}
}
