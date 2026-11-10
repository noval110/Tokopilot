package main

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"tokopilot/backend/internal/config"
	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/testdb"
)

func testConfig(t *testing.T, env string) config.Config {
	t.Helper()
	cfg, err := config.Load(func(k string) (string, bool) {
		switch k {
		case "APP_ENV":
			return env, true
		case "DATABASE_URL":
			return "postgres://unused", true
		case "SESSION_SECRET", "AI_SERVICE_TOKEN":
			return strings.Repeat("s", 40), true
		case "FRONTEND_ORIGIN":
			return "https://demo.tokopilot.test", true
		}
		return "", false
	})
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

// The demo seed must complete on an empty database, go through the real services,
// leave a reconciled ledger, and refuse to run twice or in production by accident.
func TestSeedDemoCompletesAndReconciles(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	t.Setenv("DEMO_EMAIL", "demo@toko.test")
	t.Setenv("DEMO_STAFF_EMAIL", "kasir@toko.test")
	t.Setenv("DEMO_PASSWORD", "demo-password-123")

	if err := seedDemo(ctx, pool, testConfig(t, "production"), logger); err == nil || !strings.Contains(err.Error(), "refusing") {
		t.Fatalf("production without opt-in must refuse, got %v", err)
	}
	if err := seedDemo(ctx, pool, testConfig(t, "test"), logger); err != nil {
		t.Fatalf("seed: %v", err)
	}

	rep, err := db.VerifyLedger(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if !rep.OK() {
		t.Fatalf("seeded ledger does not reconcile: %+v", rep.Issues)
	}
	if rep.Products != len(demoCatalog) || rep.Sales < 150 {
		t.Fatalf("unexpected demo size: %+v", rep)
	}
	var days, voided, outOfStock, cashiers int
	if err := pool.QueryRow(ctx, `SELECT count(DISTINCT (sold_at AT TIME ZONE 'Asia/Jakarta')::date),
	                                     count(*) FILTER (WHERE status = 'VOIDED'), count(DISTINCT cashier_user_id) FROM sales`).
		Scan(&days, &voided, &cashiers); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM products WHERE current_stock = 0`).Scan(&outOfStock); err != nil {
		t.Fatal(err)
	}
	if days < 28 || voided != 2 || outOfStock < 1 || cashiers != 2 {
		t.Fatalf("demo story incomplete: days=%d voided=%d out_of_stock=%d cashiers=%d", days, voided, outOfStock, cashiers)
	}

	if err := seedDemo(ctx, pool, testConfig(t, "test"), logger); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("second run must refuse without changes, got %v", err)
	}
}
