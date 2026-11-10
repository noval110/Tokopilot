package ratelimit

import (
	"testing"
	"time"
)

func TestLimiterWindow(t *testing.T) {
	now := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	l := New(3, 15*time.Minute, func() time.Time { return now })

	for i := range 3 {
		if ok, _ := l.Allow("k"); !ok {
			t.Fatalf("hit %d should be allowed", i+1)
		}
	}
	ok, wait := l.Allow("k")
	if ok || wait != 15*time.Minute {
		t.Fatalf("4th hit: ok=%v wait=%v", ok, wait)
	}
	if ok, _ := l.Allow("other"); !ok {
		t.Fatal("keys must be independent")
	}

	now = now.Add(15 * time.Minute)
	if ok, _ := l.Allow("k"); !ok {
		t.Fatal("window should reset after period")
	}
}

func TestResetClearsFailures(t *testing.T) {
	l := New(2, time.Hour, nil)
	l.Hit("login")
	l.Hit("login")
	if blocked, _ := l.Blocked("login"); !blocked {
		t.Fatal("should be blocked")
	}
	l.Reset("login")
	if blocked, _ := l.Blocked("login"); blocked {
		t.Fatal("reset should unblock")
	}
}
