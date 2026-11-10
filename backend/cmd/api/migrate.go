package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/db"
)

func migrate(ctx context.Context, pool *pgxpool.Pool, args []string, logger *slog.Logger) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: api migrate up|down|status")
	}
	p, err := db.Migrator(pool)
	if err != nil {
		return err
	}
	switch args[0] {
	case "up":
		results, err := p.Up(ctx)
		for _, r := range results {
			logger.Info("migration applied", slog.String("source", r.Source.Path), slog.Duration("took", r.Duration))
		}
		if err != nil {
			return err
		}
		v, _ := p.GetDBVersion(ctx)
		logger.Info("database up to date", slog.Int64("version", v))
	case "down":
		r, err := p.Down(ctx)
		if err != nil {
			return err
		}
		logger.Info("migration rolled back", slog.String("source", r.Source.Path))
	case "status":
		statuses, err := p.Status(ctx)
		if err != nil {
			return err
		}
		for _, s := range statuses {
			logger.Info("migration", slog.String("source", s.Source.Path), slog.String("state", string(s.State)))
		}
	default:
		return fmt.Errorf("unknown migrate command %q (want up|down|status)", args[0])
	}
	return nil
}
