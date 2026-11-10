package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/config"
	"tokopilot/backend/internal/handlers"
)

func newTestServer(t *testing.T, checks ...handlers.ReadinessCheck) *echo.Echo {
	t.Helper()
	cfg, err := config.Load(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	e, err := New(Deps{Config: cfg, Logger: logger, ReadinessChecks: checks})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func do(e *echo.Echo, method, path string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

type envelope struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
	} `json:"error"`
}

func TestLiveness(t *testing.T) {
	rec := do(newTestServer(t), http.MethodGet, "/healthz", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("security headers missing")
	}
}

func TestReadinessReportsFailingDependencyWithoutDetails(t *testing.T) {
	e := newTestServer(t, handlers.ReadinessCheck{
		Name:  "database",
		Check: func(context.Context) error { return errors.New("dial tcp 10.0.0.5:5432: secret-host refused") },
	})
	rec := do(e, http.MethodGet, "/readyz", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "secret-host") {
		t.Fatal("readiness must not leak dependency error details")
	}
	if !strings.Contains(rec.Body.String(), `"database":"unavailable"`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

func TestRequestIDGeneratedAndSafeInboundReused(t *testing.T) {
	e := newTestServer(t)

	rec := do(e, http.MethodGet, "/healthz", nil)
	if id := rec.Header().Get(echo.HeaderXRequestID); !strings.HasPrefix(id, "req_") {
		t.Fatalf("generated id = %q", id)
	}

	rec = do(e, http.MethodGet, "/healthz", map[string]string{echo.HeaderXRequestID: "client-trace-123"})
	if id := rec.Header().Get(echo.HeaderXRequestID); id != "client-trace-123" {
		t.Fatalf("safe inbound id not reused: %q", id)
	}

	rec = do(e, http.MethodGet, "/healthz", map[string]string{echo.HeaderXRequestID: "bad id\twith tabs"})
	if id := rec.Header().Get(echo.HeaderXRequestID); !strings.HasPrefix(id, "req_") {
		t.Fatalf("unsafe inbound id should be replaced, got %q", id)
	}
}

func TestUnknownRouteReturnsErrorEnvelope(t *testing.T) {
	rec := do(newTestServer(t), http.MethodGet, "/api/v1/does-not-exist", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
	var env envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("invalid json: %v (%s)", err, rec.Body.String())
	}
	if env.Error.Code != "NOT_FOUND" || env.Error.RequestID == "" {
		t.Fatalf("unexpected envelope: %+v", env)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("api responses must be no-store")
	}
}

func TestPanicBecomesGeneric500WithoutStackTrace(t *testing.T) {
	e := newTestServer(t)
	e.GET("/api/v1/boom", func(*echo.Context) error { panic("db password leaked in panic") })

	rec := do(e, http.MethodGet, "/api/v1/boom", nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "password") || strings.Contains(body, "goroutine") {
		t.Fatalf("500 body leaks internals: %s", body)
	}
	var env envelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Error.Code != "INTERNAL_ERROR" {
		t.Fatalf("code = %s", env.Error.Code)
	}
}

func TestAccessLogRecordsClientVisibleStatus(t *testing.T) {
	cfg, _ := config.Load(func(string) (string, bool) { return "", false })
	var buf strings.Builder
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	e, _ := New(Deps{Config: cfg, Logger: logger})

	rec := do(e, http.MethodGet, "/api/v1/nope?token=secret-in-query", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
	logs := buf.String()
	if !strings.Contains(logs, "status=404") {
		t.Fatalf("access log should record 404, got: %s", logs)
	}
	if strings.Contains(logs, "secret-in-query") {
		t.Fatal("access log must not include query strings")
	}
}

func TestCORSOnlyAllowsConfiguredOrigin(t *testing.T) {
	e := newTestServer(t)
	preflight := map[string]string{
		"Origin":                        "http://localhost:5173",
		"Access-Control-Request-Method": http.MethodPost,
	}
	rec := do(e, http.MethodOptions, "/api/v1/health", preflight)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("allowed origin header = %q", got)
	}

	preflight["Origin"] = "https://evil.example"
	rec = do(e, http.MethodOptions, "/api/v1/health", preflight)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("foreign origin must not be allowed, got %q", got)
	}
}
