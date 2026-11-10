// Package config loads and validates runtime configuration from environment
// variables. Secrets are never logged or echoed back in error messages.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Env is the deployment environment the API runs in.
type Env string

const (
	EnvDevelopment Env = "development"
	EnvTest        Env = "test"
	EnvStaging     Env = "staging"
	EnvProduction  Env = "production"
)

// Config holds every setting the API needs. Sprint 0 only consumes a subset;
// fields for later sprints are loaded so misconfiguration surfaces early.
type Config struct {
	Env              Env
	Port             int
	DatabaseURL      string
	FrontendOrigin   string
	DefaultTimezone  *time.Location
	AIServiceURL     string
	aiServiceToken   string
	sessionSecret    string
	ShutdownTimeout  time.Duration
	RequestBodyLimit int64
	// AIRequestTimeout bounds each call to the AI service (NFR-10).
	AIRequestTimeout time.Duration
	// DBMaxConns caps the pgx pool per replica; size it to the managed DB limit (PRD §18.3).
	DBMaxConns int32
}

// AIServiceToken returns the internal service credential. Kept behind a
// method so the value is not accidentally serialised with the struct.
func (c Config) AIServiceToken() string { return c.aiServiceToken }

// SessionSecret returns the HMAC key for CSRF tokens (ADR-0002).
func (c Config) SessionSecret() []byte { return []byte(c.sessionSecret) }

// SecureCookies reports whether cookies must carry the Secure flag. Local
// development runs on plain http://localhost.
func (c Config) SecureCookies() bool { return c.Env != EnvDevelopment && c.Env != EnvTest }

// IsProduction reports whether strict production rules apply.
func (c Config) IsProduction() bool { return c.Env == EnvProduction || c.Env == EnvStaging }

// Lookup abstracts os.LookupEnv so tests can inject values.
type Lookup func(key string) (string, bool)

// FromEnv loads configuration from the process environment.
func FromEnv() (Config, error) { return Load(os.LookupEnv) }

// Load builds a Config from the given lookup and validates it. All problems
// are reported together so operators can fix them in one pass.
func Load(lookup Lookup) (Config, error) {
	get := func(key, def string) string {
		if v, ok := lookup(key); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
		return def
	}

	var errs []error
	cfg := Config{
		Env:              Env(get("APP_ENV", string(EnvDevelopment))),
		DatabaseURL:      get("DATABASE_URL", ""),
		FrontendOrigin:   strings.TrimRight(get("FRONTEND_ORIGIN", "http://localhost:5173"), "/"),
		AIServiceURL:     get("AI_SERVICE_URL", "http://localhost:8000"),
		aiServiceToken:   get("AI_SERVICE_TOKEN", ""),
		sessionSecret:    get("SESSION_SECRET", ""),
		ShutdownTimeout:  10 * time.Second,
		RequestBodyLimit: 1 << 20, // 1 MiB; no MVP endpoint needs more.
	}

	switch cfg.Env {
	case EnvDevelopment, EnvTest, EnvStaging, EnvProduction:
	default:
		errs = append(errs, fmt.Errorf("APP_ENV must be one of development|test|staging|production, got %q", cfg.Env))
	}

	aiSecs, err := strconv.Atoi(get("AI_REQUEST_TIMEOUT_SECONDS", "30"))
	if err != nil || aiSecs < 1 || aiSecs > 120 {
		errs = append(errs, errors.New("AI_REQUEST_TIMEOUT_SECONDS must be an integer between 1 and 120"))
		aiSecs = 30
	}
	cfg.AIRequestTimeout = time.Duration(aiSecs) * time.Second

	maxConns, err := strconv.Atoi(get("DB_MAX_CONNS", "10"))
	if err != nil || maxConns < 1 || maxConns > 100 {
		errs = append(errs, errors.New("DB_MAX_CONNS must be an integer between 1 and 100"))
		maxConns = 10
	}
	cfg.DBMaxConns = int32(maxConns)

	port, err := strconv.Atoi(get("PORT", "8080"))
	if err != nil || port < 1 || port > 65535 {
		errs = append(errs, errors.New("PORT must be an integer between 1 and 65535"))
	}
	cfg.Port = port

	tzName := get("STORE_DEFAULT_TIMEZONE", "Asia/Jakarta")
	loc, err := time.LoadLocation(tzName)
	if err != nil {
		errs = append(errs, fmt.Errorf("STORE_DEFAULT_TIMEZONE %q is not a valid IANA timezone", tzName))
	}
	cfg.DefaultTimezone = loc

	if err := validateOrigin(cfg.FrontendOrigin); err != nil {
		errs = append(errs, err)
	}

	if cfg.IsProduction() {
		if cfg.DatabaseURL == "" {
			errs = append(errs, errors.New("DATABASE_URL is required outside development/test"))
		}
		if len(cfg.sessionSecret) < 32 || strings.HasPrefix(cfg.sessionSecret, "replace-with") {
			errs = append(errs, errors.New("SESSION_SECRET must be at least 32 characters and not a placeholder"))
		}
		if len(cfg.aiServiceToken) < 32 || strings.HasPrefix(cfg.aiServiceToken, "replace-with") {
			errs = append(errs, errors.New("AI_SERVICE_TOKEN must be at least 32 characters and not a placeholder"))
		}
		if strings.HasPrefix(cfg.FrontendOrigin, "http://") {
			errs = append(errs, errors.New("FRONTEND_ORIGIN must use https outside development/test"))
		}
	}

	if !cfg.IsProduction() && (len(cfg.sessionSecret) < 32 || strings.HasPrefix(cfg.sessionSecret, "replace-with")) {
		// Dev/test convenience: a per-process random key. Existing CSRF
		// cookies simply stop validating after a restart.
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			errs = append(errs, errors.New("cannot generate development SESSION_SECRET"))
		}
		cfg.sessionSecret = hex.EncodeToString(b)
	}

	return cfg, errors.Join(errs...)
}

func validateOrigin(origin string) error {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" {
		return fmt.Errorf("FRONTEND_ORIGIN must be a bare origin like https://app.example.com, got %q", origin)
	}
	return nil
}
