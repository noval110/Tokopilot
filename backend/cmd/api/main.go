// Command api runs the TokoPilot HTTP API.
//
//	api                 serve HTTP
//	api migrate up      apply pending migrations (run as a deploy step)
//	api migrate status  list migration state
//	api migrate down    roll back one migration (local/test only)
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
	_ "time/tzdata" // embed IANA zones so Asia/Jakarta works in minimal containers and on Windows

	"tokopilot/backend/internal/config"
	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/handlers"
	"tokopilot/backend/internal/server"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("api exited", slog.String("error", err.Error()))
		os.Exit(1)
	}
}

func run(args []string) error {
	cfg, err := config.FromEnv()
	if err != nil {
		return err
	}

	var handler slog.Handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	if cfg.Env == config.EnvDevelopment {
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})
	}
	logger := slog.New(handler).With(slog.String("service", "tokopilot-api"))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	if len(args) > 0 && args[0] == "migrate" {
		return migrate(ctx, pool, args[1:], logger)
	}
	if len(args) > 0 && args[0] == "verify-ledger" {
		return verifyLedger(ctx, pool, logger)
	}
	if len(args) > 0 && args[0] == "seed-demo" {
		return seedDemo(ctx, pool, cfg, logger)
	}
	if len(args) > 0 {
		return fmt.Errorf("unknown command %q", args[0])
	}

	e, err := server.New(server.Deps{
		Config: cfg,
		Logger: logger,
		Pool:   pool,
		ReadinessChecks: []handlers.ReadinessCheck{
			{Name: "database", Check: pool.Ping},
		},
	})
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           e,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second, // AI answers can take up to ~15s p95 plus margin.
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("api listening", slog.String("addr", srv.Addr), slog.String("env", string(cfg.Env)))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
