package server

// HTTP-level integration tests against a real PostgreSQL (see internal/testdb).
// They exercise the full middleware chain exactly as a browser would.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/auth"
	"tokopilot/backend/internal/config"
	"tokopilot/backend/internal/testdb"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time          { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) Advance(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

type env struct {
	srv   *httptest.Server
	pool  *pgxpool.Pool
	clock *clock
	api   *echo.Echo
}

func newEnv(t *testing.T) *env { return newEnvWith(t, nil) }

// newEnvWith lets a test override configuration (e.g. point at a fake AI service).
func newEnvWith(t *testing.T, extra map[string]string) *env {
	t.Helper()
	return newEnvLogged(t, extra, io.Discard)
}

// newEnvLogged sends the server's JSON logs to logOut (for log-hygiene tests).
func newEnvLogged(t *testing.T, extra map[string]string, logOut io.Writer) *env {
	t.Helper()
	pool := testdb.New(t)
	cfg, err := config.Load(func(k string) (string, bool) {
		if v, ok := extra[k]; ok {
			return v, true
		}
		if k == "APP_ENV" {
			return "test", true
		}
		return "", false
	})
	if err != nil {
		t.Fatal(err)
	}
	clk := &clock{t: time.Now().UTC()}
	e, err := New(Deps{
		Config: cfg, Logger: slog.New(slog.NewJSONHandler(logOut, &slog.HandlerOptions{Level: slog.LevelDebug})), Pool: pool, Now: clk.Now,
		PasswordParams: auth.Params{Memory: 1024, Iterations: 1, Parallelism: 1, SaltLen: 16, KeyLen: 32},
	})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(e)
	t.Cleanup(srv.Close)
	return &env{srv: srv, pool: pool, clock: clk, api: e}
}

type client struct {
	t      *testing.T
	base   *url.URL
	hc     *http.Client
	noCSRF bool
	origin string
}

func (e *env) client(t *testing.T) *client {
	jar, _ := cookiejar.New(nil)
	u, _ := url.Parse(e.srv.URL)
	return &client{t: t, base: u, hc: &http.Client{Jar: jar}}
}

type resp struct {
	status int
	body   map[string]any
	raw    string
	header http.Header
}

func (r resp) code() string {
	if e, ok := r.body["error"].(map[string]any); ok {
		s, _ := e["code"].(string)
		return s
	}
	return ""
}

func (c *client) cookie(name string) string {
	for _, ck := range c.hc.Jar.Cookies(c.base) {
		if ck.Name == name {
			return ck.Value
		}
	}
	return ""
}

func (c *client) do(method, path string, body any) resp {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		switch b := body.(type) {
		case string:
			rd = strings.NewReader(b)
		default:
			buf, _ := json.Marshal(b)
			rd = bytes.NewReader(buf)
		}
	}
	req, _ := http.NewRequest(method, c.base.String()+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if method != http.MethodGet && !c.noCSRF {
		if v := c.cookie("tp_csrf"); v != "" {
			req.Header.Set("X-CSRF-Token", v)
		}
	}
	if c.origin != "" {
		req.Header.Set("Origin", c.origin)
	}
	res, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := resp{status: res.StatusCode, raw: string(raw), header: res.Header}
	_ = json.Unmarshal(raw, &out.body)
	return out
}

func (c *client) mustStatus(r resp, want int) resp {
	c.t.Helper()
	if r.status != want {
		c.t.Fatalf("status = %d, want %d; body: %s", r.status, want, r.raw)
	}
	return r
}

func dig(m map[string]any, keys ...string) any {
	var cur any = m
	for _, k := range keys {
		mm, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = mm[k]
	}
	return cur
}

// ownerWithStore registers a user and creates their store.
func (e *env) ownerWithStore(t *testing.T, email, storeName string) *client {
	c := e.client(t)
	c.mustStatus(c.do("POST", "/api/v1/auth/register", map[string]any{"name": "Owner " + storeName, "email": email, "password": "rahasia-123"}), 201)
	c.mustStatus(c.do("POST", "/api/v1/stores", map[string]any{"name": storeName}), 201)
	return c
}

func TestRegisterOnboardingFlow(t *testing.T) {
	e := newEnv(t)
	c := e.client(t)

	r := c.mustStatus(c.do("POST", "/api/v1/auth/register", map[string]any{
		"name": "  Sari  Wulandari ", "email": " Sari@Warung.ID ", "password": "rahasia-123",
	}), 201)
	if dig(r.body, "user", "email") != "sari@warung.id" || dig(r.body, "user", "name") != "Sari Wulandari" {
		t.Fatalf("user not normalized: %s", r.raw)
	}
	if strings.Contains(r.raw, "password") || strings.Contains(r.raw, "argon2") {
		t.Fatal("response leaks password data")
	}
	var sessionCookie *http.Cookie
	for _, ck := range r.header.Values("Set-Cookie") {
		if strings.HasPrefix(ck, "tp_session=") {
			sessionCookie, _ = http.ParseSetCookie(ck)
		}
	}
	if sessionCookie == nil || !sessionCookie.HttpOnly || sessionCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie must be HttpOnly + SameSite=Lax: %+v", sessionCookie)
	}

	var hash string
	_ = e.pool.QueryRow(context.Background(), `SELECT password_hash FROM users WHERE email = 'sari@warung.id'`).Scan(&hash)
	if !strings.HasPrefix(hash, "$argon2id$") || strings.Contains(hash, "rahasia") {
		t.Fatalf("password not stored as argon2id: %q", hash)
	}

	r = c.mustStatus(c.do("GET", "/api/v1/me", nil), 200)
	if r.body["membership"] != nil {
		t.Fatalf("new user should have no membership: %s", r.raw)
	}

	r = c.mustStatus(c.do("POST", "/api/v1/stores", map[string]any{"name": "Warung Bu Sari", "address": "Jl. Melati 3"}), 201)
	if r.body["role"] != "OWNER" || dig(r.body, "store", "timezone") != "Asia/Jakarta" || dig(r.body, "store", "currency") != "IDR" {
		t.Fatalf("unexpected membership: %s", r.raw)
	}

	r = c.mustStatus(c.do("GET", "/api/v1/me", nil), 200)
	if dig(r.body, "membership", "store", "name") != "Warung Bu Sari" {
		t.Fatalf("me after onboarding: %s", r.raw)
	}

	// A second store is refused and the refused attempt leaves no orphan store (atomic tx).
	r = c.mustStatus(c.do("POST", "/api/v1/stores", map[string]any{"name": "Toko Kedua"}), 409)
	if r.code() != "STORE_ALREADY_EXISTS" {
		t.Fatalf("code = %s", r.code())
	}
	var stores int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM stores`).Scan(&stores)
	if stores != 1 {
		t.Fatalf("stores = %d, want 1 (rollback of failed creation)", stores)
	}
}

func TestRegisterValidationAndDuplicates(t *testing.T) {
	e := newEnv(t)
	c := e.client(t)

	r := c.mustStatus(c.do("POST", "/api/v1/auth/register", map[string]any{"name": "", "email": "bukan-email", "password": "123"}), 400)
	for _, f := range []string{"name", "email", "password"} {
		if dig(r.body, "error", "details", "fields", f) == nil {
			t.Errorf("missing field error for %s: %s", f, r.raw)
		}
	}

	// Unknown fields (e.g. trying to set a role) are rejected outright.
	c.mustStatus(c.do("POST", "/api/v1/auth/register", map[string]any{"name": "A", "email": "a@toko.id", "password": "rahasia-123", "role": "OWNER"}), 400)

	c.mustStatus(c.do("POST", "/api/v1/auth/register", map[string]any{"name": "A", "email": "a@toko.id", "password": "rahasia-123"}), 201)
	other := e.client(t)
	r = other.mustStatus(other.do("POST", "/api/v1/auth/register", map[string]any{"name": "B", "email": "A@TOKO.ID", "password": "rahasia-123"}), 409)
	if r.code() != "EMAIL_TAKEN" {
		t.Fatalf("case-insensitive duplicate: code = %s", r.code())
	}
}

func TestLoginIsGenericAndRateLimited(t *testing.T) {
	e := newEnv(t)
	e.ownerWithStore(t, "owner@toko.id", "Toko A")
	c := e.client(t)

	wrongPw := c.mustStatus(c.do("POST", "/api/v1/auth/login", map[string]any{"email": "owner@toko.id", "password": "salah-sekali"}), 401)
	noUser := c.mustStatus(c.do("POST", "/api/v1/auth/login", map[string]any{"email": "nobody@toko.id", "password": "salah-sekali"}), 401)
	if wrongPw.code() != "INVALID_CREDENTIALS" || dig(wrongPw.body, "error", "message") != dig(noUser.body, "error", "message") {
		t.Fatalf("login errors must be identical:\n%s\n%s", wrongPw.raw, noUser.raw)
	}

	r := c.mustStatus(c.do("POST", "/api/v1/auth/login", map[string]any{"email": "OWNER@toko.id", "password": "rahasia-123"}), 200)
	if dig(r.body, "membership", "role") != "OWNER" {
		t.Fatalf("login should return membership: %s", r.raw)
	}

	attacker := e.client(t)
	for range 5 {
		attacker.mustStatus(attacker.do("POST", "/api/v1/auth/login", map[string]any{"email": "owner@toko.id", "password": "tebakan-salah"}), 401)
	}
	r = attacker.mustStatus(attacker.do("POST", "/api/v1/auth/login", map[string]any{"email": "owner@toko.id", "password": "rahasia-123"}), 429)
	if r.header.Get("Retry-After") == "" {
		t.Fatal("429 must include Retry-After")
	}
	e.clock.Advance(16 * time.Minute)
	attacker.mustStatus(attacker.do("POST", "/api/v1/auth/login", map[string]any{"email": "owner@toko.id", "password": "rahasia-123"}), 200)
}

func TestLogoutRevokesSessionServerSide(t *testing.T) {
	e := newEnv(t)
	c := e.ownerWithStore(t, "owner@toko.id", "Toko A")
	stolen := c.cookie("tp_session")

	c.mustStatus(c.do("POST", "/api/v1/auth/logout", nil), 204)
	c.mustStatus(c.do("GET", "/api/v1/me", nil), 401)

	// Replaying the old cookie value must fail: the session is revoked in the DB.
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/v1/me", nil)
	req.AddCookie(&http.Cookie{Name: "tp_session", Value: stolen})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("revoked session accepted: %d", res.StatusCode)
	}
}

func TestSessionIdleExpiryAndSliding(t *testing.T) {
	e := newEnv(t)
	c := e.ownerWithStore(t, "owner@toko.id", "Toko A")

	e.clock.Advance(6 * 24 * time.Hour)
	c.mustStatus(c.do("GET", "/api/v1/me", nil), 200) // activity slides the idle window
	e.clock.Advance(6 * 24 * time.Hour)
	c.mustStatus(c.do("GET", "/api/v1/me", nil), 200) // 12 days total, still within slide
	e.clock.Advance(8 * 24 * time.Hour)
	c.mustStatus(c.do("GET", "/api/v1/me", nil), 401) // idle > 7 days
}

func TestSessionAbsoluteExpiry(t *testing.T) {
	e := newEnv(t)
	c := e.ownerWithStore(t, "owner@toko.id", "Toko A")
	for range 5 {
		e.clock.Advance(6 * 24 * time.Hour)
		c.do("GET", "/api/v1/me", nil)
	}
	// 30 days elapsed with continuous activity: the absolute cap still ends it.
	c.mustStatus(c.do("GET", "/api/v1/me", nil), 401)
}

func TestCSRFAndOriginEnforced(t *testing.T) {
	e := newEnv(t)
	c := e.client(t)
	c.mustStatus(c.do("POST", "/api/v1/auth/register", map[string]any{"name": "A", "email": "a@toko.id", "password": "rahasia-123"}), 201)

	c.noCSRF = true
	r := c.mustStatus(c.do("POST", "/api/v1/stores", map[string]any{"name": "Toko"}), 403)
	if r.code() != "CSRF_INVALID" {
		t.Fatalf("code = %s", r.code())
	}
	c.noCSRF = false

	c.origin = "https://evil.example"
	c.mustStatus(c.do("POST", "/api/v1/stores", map[string]any{"name": "Toko"}), 403)
	c.origin = "http://localhost:5173"
	c.mustStatus(c.do("POST", "/api/v1/stores", map[string]any{"name": "Toko"}), 201)
}

func TestTenantIsolationAndRoles(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	storeB := dig(b.mustStatus(b.do("GET", "/api/v1/settings/store", nil), 200).body, "id").(string)

	// Owner A always sees only Toko A, whatever store_id they try to pass.
	r := a.mustStatus(a.do("GET", "/api/v1/settings/store?store_id="+storeB, nil), 200)
	if r.body["name"] != "Toko A" {
		t.Fatalf("tenant leak via query param: %s", r.raw)
	}
	a.mustStatus(a.do("PATCH", "/api/v1/settings/store", map[string]any{"store_id": storeB, "name": "Hacked"}), 400)
	r = b.mustStatus(b.do("GET", "/api/v1/settings/store", nil), 200)
	if r.body["name"] != "Toko B" {
		t.Fatalf("store B was modified: %s", r.raw)
	}

	// Owner A adds a staff member to Toko A.
	r = a.mustStatus(a.do("POST", "/api/v1/settings/team", map[string]any{"name": "Kasir Andi", "email": "andi@toko.id", "password": "kasir-12345"}), 201)
	if r.body["role"] != "STAFF" {
		t.Fatalf("staff role: %s", r.raw)
	}

	staff := e.client(t)
	r = staff.mustStatus(staff.do("POST", "/api/v1/auth/login", map[string]any{"email": "andi@toko.id", "password": "kasir-12345"}), 200)
	if dig(r.body, "membership", "store", "name") != "Toko A" || dig(r.body, "membership", "role") != "STAFF" {
		t.Fatalf("staff membership: %s", r.raw)
	}
	// Staff cannot use owner endpoints — enforced by the backend, not the UI.
	staff.mustStatus(staff.do("GET", "/api/v1/settings/store", nil), 403)
	staff.mustStatus(staff.do("PATCH", "/api/v1/settings/store", map[string]any{"name": "X"}), 403)
	staff.mustStatus(staff.do("POST", "/api/v1/settings/team", map[string]any{"name": "Y", "email": "y@toko.id", "password": "rahasia-123"}), 403)
	// Staff cannot create a second store.
	staff.mustStatus(staff.do("POST", "/api/v1/stores", map[string]any{"name": "Toko Andi"}), 409)

	// Team lists are store-scoped.
	teamA := a.mustStatus(a.do("GET", "/api/v1/settings/team", nil), 200)
	teamB := b.mustStatus(b.do("GET", "/api/v1/settings/team", nil), 200)
	if dig(teamA.body, "meta", "total") != float64(2) || dig(teamB.body, "meta", "total") != float64(1) {
		t.Fatalf("team scope wrong:\nA=%s\nB=%s", teamA.raw, teamB.raw)
	}
	if strings.Contains(teamB.raw, "andi@toko.id") {
		t.Fatal("store B sees store A's staff")
	}

	// A user with no store gets STORE_REQUIRED on tenant routes.
	lonely := e.client(t)
	lonely.mustStatus(lonely.do("POST", "/api/v1/auth/register", map[string]any{"name": "L", "email": "l@toko.id", "password": "rahasia-123"}), 201)
	r = lonely.mustStatus(lonely.do("GET", "/api/v1/settings/store", nil), 403)
	if r.code() != "STORE_REQUIRED" {
		t.Fatalf("code = %s", r.code())
	}

	// Unauthenticated callers get 401 everywhere.
	anon := e.client(t)
	anon.mustStatus(anon.do("GET", "/api/v1/settings/store", nil), 401)
	anon.mustStatus(anon.do("GET", "/api/v1/me", nil), 401)
}

func TestUpdateStoreSettings(t *testing.T) {
	e := newEnv(t)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")

	r := a.mustStatus(a.do("PATCH", "/api/v1/settings/store", map[string]any{"name": "Toko A Jaya", "timezone": "Asia/Makassar", "address": "Jl. Kenanga 1"}), 200)
	if r.body["name"] != "Toko A Jaya" || r.body["timezone"] != "Asia/Makassar" || r.body["address"] != "Jl. Kenanga 1" {
		t.Fatalf("update: %s", r.raw)
	}
	r = a.mustStatus(a.do("PATCH", "/api/v1/settings/store", map[string]any{"address": ""}), 200)
	if r.body["address"] != nil || r.body["name"] != "Toko A Jaya" {
		t.Fatalf("partial update / clear address: %s", r.raw)
	}
	r = a.mustStatus(a.do("PATCH", "/api/v1/settings/store", map[string]any{"timezone": "Europe/London", "name": ""}), 400)
	if dig(r.body, "error", "details", "fields", "timezone") == nil || dig(r.body, "error", "details", "fields", "name") == nil {
		t.Fatalf("validation: %s", r.raw)
	}
}

func TestDatabaseConstraintsBackstopTheApp(t *testing.T) {
	e := newEnv(t)
	e.ownerWithStore(t, "a@toko.id", "Toko A")
	ctx := context.Background()

	var storeID string
	_ = e.pool.QueryRow(ctx, `SELECT id FROM stores`).Scan(&storeID)
	_, err := e.pool.Exec(ctx, `
		WITH u AS (INSERT INTO users (name, email, password_hash) VALUES ('X', 'x@toko.id', '$argon2id$x') RETURNING id)
		INSERT INTO store_members (store_id, user_id, role) SELECT $1, id, 'OWNER' FROM u`, storeID)
	if err == nil || !strings.Contains(err.Error(), "store_members_one_owner_idx") {
		t.Fatalf("second OWNER must violate one-owner index, got %v", err)
	}
	if _, err := e.pool.Exec(ctx, `INSERT INTO users (name, email, password_hash) VALUES ('P', 'p@toko.id', 'plaintext')`); err == nil {
		t.Fatal("non-argon2id password_hash must be rejected by CHECK")
	}
	if _, err := e.pool.Exec(ctx, `UPDATE stores SET currency = 'USD'`); err == nil {
		t.Fatal("non-IDR currency must be rejected by CHECK")
	}
}
