package config

import (
	"strings"
	"testing"
)

func lookupFrom(m map[string]string) Lookup {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func TestLoadDefaultsForDevelopment(t *testing.T) {
	cfg, err := Load(lookupFrom(nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Env != EnvDevelopment || cfg.Port != 8080 {
		t.Fatalf("unexpected defaults: env=%s port=%d", cfg.Env, cfg.Port)
	}
	if cfg.DefaultTimezone.String() != "Asia/Jakarta" {
		t.Fatalf("default timezone = %s, want Asia/Jakarta", cfg.DefaultTimezone)
	}
	if cfg.FrontendOrigin != "http://localhost:5173" {
		t.Fatalf("origin = %s", cfg.FrontendOrigin)
	}
	if cfg.DBMaxConns != 10 {
		t.Fatalf("DB_MAX_CONNS default = %d, want 10", cfg.DBMaxConns)
	}
	cfg, err = Load(lookupFrom(map[string]string{"DB_MAX_CONNS": "4"}))
	if err != nil || cfg.DBMaxConns != 4 {
		t.Fatalf("DB_MAX_CONNS=4 → %d, %v", cfg.DBMaxConns, err)
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	_, err := Load(lookupFrom(map[string]string{
		"APP_ENV":                "prod",
		"PORT":                   "99999",
		"STORE_DEFAULT_TIMEZONE": "Mars/Olympus",
		"FRONTEND_ORIGIN":        "localhost:5173/app",
		"DB_MAX_CONNS":           "0",
	}))
	if err == nil {
		t.Fatal("expected validation error")
	}
	for _, want := range []string{"APP_ENV", "PORT", "STORE_DEFAULT_TIMEZONE", "FRONTEND_ORIGIN", "DB_MAX_CONNS"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should mention %s: %v", want, err)
		}
	}
}

func TestProductionRequiresRealSecrets(t *testing.T) {
	_, err := Load(lookupFrom(map[string]string{
		"APP_ENV":          "production",
		"SESSION_SECRET":   "replace-with-strong-secret",
		"AI_SERVICE_TOKEN": "short",
		"FRONTEND_ORIGIN":  "http://app.example.com",
	}))
	if err == nil {
		t.Fatal("expected production validation error")
	}
	for _, want := range []string{"DATABASE_URL", "SESSION_SECRET", "AI_SERVICE_TOKEN", "https"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should mention %s: %v", want, err)
		}
	}
	if strings.Contains(err.Error(), "replace-with-strong-secret") {
		t.Error("error message must not echo secret values")
	}
}

func TestProductionAcceptsValidConfig(t *testing.T) {
	secret := strings.Repeat("x", 40)
	cfg, err := Load(lookupFrom(map[string]string{
		"APP_ENV":          "production",
		"DATABASE_URL":     "postgresql://u:p@db:5432/tokopilot",
		"SESSION_SECRET":   secret,
		"AI_SERVICE_TOKEN": secret,
		"FRONTEND_ORIGIN":  "https://tokopilot.example.com/",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.FrontendOrigin != "https://tokopilot.example.com" {
		t.Fatalf("trailing slash should be trimmed, got %s", cfg.FrontendOrigin)
	}
	if !cfg.IsProduction() {
		t.Fatal("expected production")
	}
}
