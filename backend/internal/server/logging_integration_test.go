package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// syncBuffer: the server logs from request goroutines.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}
func (s *syncBuffer) String() string { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

// PRD §16.1 "unsafe logging": a full flow — including failures and a 5xx —
// must not write credentials, tokens, emails or query strings to the logs.
func TestLogsNeverContainSecretsOrPersonalData(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }))
	t.Cleanup(down.Close)
	const aiToken = "ai-service-token-that-must-not-leak-0123456789"
	logs := &syncBuffer{}
	e := newEnvLogged(t, map[string]string{"AI_SERVICE_URL": down.URL, "AI_SERVICE_TOKEN": aiToken}, logs)

	const password = "sandi-rahasia-unik-98765"
	const email = "pemilik.unik@toko.id"
	c := e.client(t)
	c.mustStatus(c.do("POST", "/api/v1/auth/register", map[string]any{"name": "Pemilik", "email": email, "password": password}), 201)
	c.mustStatus(c.do("POST", "/api/v1/stores", map[string]any{"name": "Toko Log"}), 201)
	prod := c.createProduct(kopi(nil))["id"].(string)
	c.mustStatus(c.do("POST", "/api/v1/sales", checkout("log-sale-0001", 0, line(prod, "1"))), 201)
	c.mustStatus(c.do("GET", "/api/v1/products?q=rahasia-query-term", nil), 200)
	conv := c.newConversation()
	if r := c.ask(conv, "berapa penjualan?"); r.status != http.StatusServiceUnavailable {
		t.Fatalf("AI down: status %d, want 503 (and a logged 5xx)", r.status)
	}

	bad := e.client(t)
	bad.mustStatus(bad.do("POST", "/api/v1/auth/login", map[string]any{"email": email, "password": password + "-salah"}), 401)

	out := logs.String()
	if !strings.Contains(out, `"http_request"`) || !strings.Contains(out, `"request failed"`) {
		t.Fatalf("expected access and error logs to be captured, got:\n%s", out)
	}
	secrets := map[string]string{
		"password": password, "wrong password": password + "-salah", "email": email,
		"session cookie": c.cookie("tp_session"), "csrf token": c.cookie("tp_csrf"),
		"AI service token": aiToken, "query string": "rahasia-query-term",
	}
	for what, v := range secrets {
		if v == "" {
			t.Fatalf("%s value missing from fixture", what)
		}
		if strings.Contains(out, v) {
			t.Errorf("logs contain the %s", what)
		}
	}
	for _, header := range []string{"Authorization", "Cookie", "X-Csrf-Token", "X-CSRF-Token"} {
		if strings.Contains(out, header) {
			t.Errorf("logs mention header %s", header)
		}
	}
}
