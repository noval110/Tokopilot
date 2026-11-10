// Package handlers holds thin HTTP handlers. Business logic lives in services.
package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
)

// ReadinessCheck reports whether a dependency (e.g. PostgreSQL from Sprint 1)
// is usable. Name is public; error details are never returned to callers.
type ReadinessCheck struct {
	Name  string
	Check func(ctx context.Context) error
}

// Health serves liveness and readiness probes.
type Health struct {
	checks  []ReadinessCheck
	timeout time.Duration
}

// NewHealth builds the health handler with the given readiness checks.
func NewHealth(checks ...ReadinessCheck) *Health {
	return &Health{checks: checks, timeout: 2 * time.Second}
}

type healthResponse struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks,omitempty"`
}

// Live reports that the process is up. It never touches dependencies.
func (h *Health) Live(c *echo.Context) error {
	return c.JSON(http.StatusOK, healthResponse{Status: "ok"})
}

// Ready reports whether every dependency is reachable.
func (h *Health) Ready(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), h.timeout)
	defer cancel()

	resp := healthResponse{Status: "ok", Checks: map[string]string{}}
	status := http.StatusOK
	for _, chk := range h.checks {
		if err := chk.Check(ctx); err != nil {
			resp.Checks[chk.Name] = "unavailable"
			resp.Status = "degraded"
			status = http.StatusServiceUnavailable
			continue
		}
		resp.Checks[chk.Name] = "ok"
	}
	return c.JSON(status, resp)
}
