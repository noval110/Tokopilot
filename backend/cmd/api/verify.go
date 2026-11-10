package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/db"
)

// verifyLedger: `api verify-ledger` — read-only stock reconciliation for every store.
// Prints the JSON report to stdout; exits non-zero when any invariant is broken.
func verifyLedger(ctx context.Context, pool *pgxpool.Pool, logger *slog.Logger) error {
	rep, err := db.VerifyLedger(ctx, pool)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(rep); err != nil {
		return err
	}
	if !rep.OK() {
		return errors.New("stock ledger reconciliation failed")
	}
	logger.Info("stock ledger reconciled", slog.Int("products", rep.Products), slog.Int("movements", rep.Movements), slog.Int("sales", rep.Sales))
	return nil
}
