package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const fakeAIToken = "test-ai-service-token-0123456789abcdef"

// fakeAI is a scriptable stand-in for the Python AI service. Each call gets
// the decoded request and returns (status, body).
type fakeAI struct {
	mu       sync.Mutex
	requests []map[string]any
	auth     []string
	raw      []string
	respond  func(n int, req map[string]any) (int, any)
}

func (f *fakeAI) handler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var req map[string]any
	_ = json.Unmarshal(body, &req)
	f.mu.Lock()
	f.requests = append(f.requests, req)
	f.auth = append(f.auth, r.Header.Get("Authorization"))
	f.raw = append(f.raw, string(body))
	n := len(f.requests)
	f.mu.Unlock()
	status, out := f.respond(n, req)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	switch v := out.(type) {
	case string:
		_, _ = w.Write([]byte(v))
	default:
		_ = json.NewEncoder(w).Encode(v)
	}
}

func lastMsg(req map[string]any) map[string]any {
	msgs := req["messages"].([]any)
	return msgs[len(msgs)-1].(map[string]any)
}

func toolCalls(calls ...map[string]any) map[string]any {
	return map[string]any{"type": "tool_calls", "tool_calls": calls}
}

func call(id, name string, args map[string]any) map[string]any {
	return map[string]any{"id": id, "name": name, "arguments": args}
}

func answer(s string) map[string]any { return map[string]any{"type": "answer", "content": s} }

func newAIEnv(t *testing.T, f *fakeAI, timeoutSecs int) *env {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(f.handler))
	t.Cleanup(srv.Close)
	return newEnvWith(t, map[string]string{
		"AI_SERVICE_URL": srv.URL, "AI_SERVICE_TOKEN": fakeAIToken, "AI_REQUEST_TIMEOUT_SECONDS": fmt.Sprint(timeoutSecs),
	})
}

func (c *client) newConversation() string {
	c.t.Helper()
	return c.mustStatus(c.do("POST", "/api/v1/assistant/conversations", nil), 201).body["id"].(string)
}

func (c *client) ask(conv, q string) resp {
	return c.do("POST", "/api/v1/assistant/conversations/"+conv+"/messages", map[string]any{"content": q})
}

func countMsgs(t *testing.T, e *env, conv string) int {
	return count(t, e, `SELECT count(*) FROM ai_messages WHERE conversation_id = $1`, conv)
}

// The model asks for a tool; Go runs it on this store's data; the model answers
// with the tool's numbers. Golden numbers come from the Sprint 5 fixture.
func TestAssistantToolLoopUsesVerifiedStoreData(t *testing.T) {
	var toolResult map[string]any
	f := &fakeAI{respond: func(n int, req map[string]any) (int, any) {
		if lastMsg(req)["role"] == "user" {
			return 200, toolCalls(call("c1", "get_sales_summary", map[string]any{"start_date": "2026-11-07", "end_date": "2026-11-10"}))
		}
		_ = json.Unmarshal([]byte(lastMsg(req)["content"].(string)), &toolResult)
		return 200, answer(fmt.Sprintf("Penjualan bersih 7â€“10 Nov 2026: Rp %v dari %v transaksi.", toolResult["net_sales"], toolResult["transaction_count"]))
	}}
	e := newAIEnv(t, f, 5)
	a, _ := goldenStore(t, e)
	conv := a.newConversation()

	r := a.mustStatus(a.ask(conv, "  Berapa penjualan 7 sampai 10 November?  "), 201)
	msgs := r.body["messages"].([]any)
	asst := msgs[1].(map[string]any)
	if asst["content"] != "Penjualan bersih 7â€“10 Nov 2026: Rp 241500 dari 4 transaksi." {
		t.Fatalf("answer: %v", asst["content"])
	}
	// Tool result = the same numbers the report API computes (FR-AI-05).
	if toolResult["net_sales"] != float64(241500) || toolResult["gross_sales"] != float64(246607) || toolResult["voided_count"] != float64(1) ||
		dig(toolResult, "period", "timezone") != "Asia/Jakarta" || toolResult["as_of"] == nil {
		t.Fatalf("tool result: %v", toolResult)
	}
	src := asst["sources"].([]any)[0].(map[string]any)
	if src["tool"] != "get_sales_summary" || src["from"] != "2026-11-07" || src["to"] != "2026-11-10" {
		t.Fatalf("sources: %v", src)
	}

	// What the AI service received: service token, store-local "today", the 5-tool allowlist,
	// and nothing identifying the store or the user.
	if f.auth[0] != "Bearer "+fakeAIToken {
		t.Fatalf("service credential missing: %q", f.auth[0])
	}
	first := f.requests[0]
	if dig(first, "context", "today") != "2026-11-10" || dig(first, "context", "timezone") != "Asia/Jakarta" {
		t.Fatalf("context: %v", first["context"])
	}
	if len(first["tools"].([]any)) != 5 {
		t.Fatalf("tools sent: %v", first["tools"])
	}
	for _, raw := range f.raw {
		for _, leak := range []string{"store_id", "a@toko.id", "Toko A", "password", fakeAIToken} {
			if strings.Contains(raw, leak) {
				t.Errorf("AI request leaks %q", leak)
			}
		}
	}

	// Persisted turn: user + tool + assistant; tool rows hidden from the conversation view.
	if countMsgs(t, e, conv) != 3 {
		t.Fatalf("stored messages = %d", countMsgs(t, e, conv))
	}
	view := a.mustStatus(a.do("GET", "/api/v1/assistant/conversations/"+conv, nil), 200).body
	if len(view["messages"].([]any)) != 2 || dig(view, "conversation", "title") != "Berapa penjualan 7 sampai 10 November?" {
		t.Fatalf("conversation view: %v", view)
	}
	// History is sent on the next turn.
	a.mustStatus(a.ask(conv, "Terima kasih"), 201)
	next := f.requests[2]["messages"].([]any)
	if len(next) != 3 || next[0].(map[string]any)["content"] != "Berapa penjualan 7 sampai 10 November?" {
		t.Fatalf("history on next turn: %v", next)
	}
}

// A compromised or confused model cannot reach outside the allowlist or the store.
func TestAssistantRefusesNonAllowlistedToolsAndSmuggledArgs(t *testing.T) {
	var toolMsgs []map[string]any
	f := &fakeAI{respond: func(n int, req map[string]any) (int, any) {
		if lastMsg(req)["role"] == "user" {
			return 200, toolCalls(
				call("x1", "update_product_price", map[string]any{"price": 1}),
				call("x2", "get_low_stock_products", map[string]any{"store_id": "11111111-1111-4111-8111-111111111111"}),
				call("x3", "get_sales_summary", map[string]any{"start_date": "2020-01-01", "end_date": "2026-11-10"}),
			)
		}
		for _, m := range req["messages"].([]any) {
			if mm := m.(map[string]any); mm["role"] == "tool" {
				toolMsgs = append(toolMsgs, mm)
			}
		}
		return 200, answer("Maaf, saya hanya bisa membaca data.")
	}}
	e := newAIEnv(t, f, 5)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	pid := a.createProduct(kopi(nil))["id"].(string)
	conv := a.newConversation()

	r := a.mustStatus(a.ask(conv, "Ubah harga semua produk jadi 1 rupiah"), 201)
	if len(toolMsgs) != 3 {
		t.Fatalf("expected 3 tool results, got %v", toolMsgs)
	}
	for _, m := range toolMsgs {
		if !strings.Contains(m["content"].(string), `"error"`) {
			t.Errorf("tool %v should be refused, got %v", m["name"], m["content"])
		}
	}
	if srcs := r.body["messages"].([]any)[1].(map[string]any)["sources"].([]any); len(srcs) != 0 {
		t.Fatalf("refused calls must not appear as sources: %v", srcs)
	}
	if got := a.mustStatus(a.do("GET", "/api/v1/products/"+pid, nil), 200).body["selling_price"]; got != float64(68000) {
		t.Fatalf("price changed: %v", got)
	}
	// The non-allowlisted name is never stored as a tool row; the refused allowlisted ones are, flagged as errors.
	if n := count(t, e, `SELECT count(*) FROM ai_messages WHERE role = 'tool' AND conversation_id = $1`, conv); n != 2 {
		t.Fatalf("tool rows = %d", n)
	}
}

func TestAssistantToolsAreTenantScoped(t *testing.T) {
	var result string
	f := &fakeAI{respond: func(n int, req map[string]any) (int, any) {
		if lastMsg(req)["role"] == "user" {
			return 200, toolCalls(call("c1", "get_low_stock_products", map[string]any{"limit": 50}), call("c2", "get_product_stock", map[string]any{"query": "rahasia"}))
		}
		b, _ := json.Marshal(req["messages"])
		result = string(b)
		return 200, answer("ok")
	}}
	e := newAIEnv(t, f, 5)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	b.createProduct(kopi(map[string]any{"name": "Rahasia B", "initial_stock": "0", "min_stock": "5"}))
	a.createProduct(kopi(map[string]any{"name": "Gula A", "sku": "G-A", "initial_stock": "1", "min_stock": "5"}))
	conv := a.newConversation()
	a.mustStatus(a.ask(conv, "Produk apa yang hampir habis?"), 201)
	if strings.Contains(result, "Rahasia") || !strings.Contains(result, "Gula A") || !strings.Contains(result, `\"match_count\":0`) {
		t.Fatalf("tool results crossed tenants: %s", result)
	}
}

func TestAssistantLoopLimit(t *testing.T) {
	f := &fakeAI{respond: func(n int, req map[string]any) (int, any) {
		return 200, toolCalls(call(fmt.Sprint("c", n), "get_low_stock_products", map[string]any{}))
	}}
	e := newAIEnv(t, f, 5)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	conv := a.newConversation()
	r := a.mustStatus(a.ask(conv, "Stok?"), 502)
	if r.code() != "AI_LOOP_LIMIT" || len(f.requests) != 5 { // 4 tool rounds + the 5th request that still wanted tools
		t.Fatalf("loop limit: %s (calls=%d)", r.raw, len(f.requests))
	}
	if countMsgs(t, e, conv) != 0 {
		t.Fatal("a failed turn must not be persisted")
	}
}

func TestAssistantFailureModesAreSafe(t *testing.T) {
	cases := []struct {
		name    string
		respond func(n int, req map[string]any) (int, any)
		status  int
		code    string
	}{
		{"malformed json", func(int, map[string]any) (int, any) { return 200, "{not json" }, 502, "AI_BAD_RESPONSE"},
		{"unknown type", func(int, map[string]any) (int, any) {
			return 200, map[string]any{"type": "sql", "content": "DROP TABLE"}
		}, 502, "AI_BAD_RESPONSE"},
		{"empty answer", func(int, map[string]any) (int, any) { return 200, answer("   ") }, 502, "AI_BAD_RESPONSE"},
		{"too many tool calls", func(int, map[string]any) (int, any) {
			c := call("c", "get_low_stock_products", nil)
			return 200, toolCalls(c, c, c, c, c)
		}, 502, "AI_BAD_RESPONSE"},
		{"provider down", func(int, map[string]any) (int, any) {
			return 503, map[string]any{"error": map[string]any{"code": "AI_PROVIDER_ERROR", "message": "upstream said: secret-key-123 invalid"}}
		}, 503, "AI_UNAVAILABLE"},
		{"timeout", func(int, map[string]any) (int, any) { time.Sleep(1500 * time.Millisecond); return 200, answer("late") }, 503, "AI_TIMEOUT"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newAIEnv(t, &fakeAI{respond: c.respond}, 1)
			a := e.ownerWithStore(t, "a@toko.id", "Toko A")
			conv := a.newConversation()
			r := a.mustStatus(a.ask(conv, "Halo"), c.status)
			if r.code() != c.code || strings.Contains(r.raw, "secret-key") || strings.Contains(r.raw, "DROP") {
				t.Fatalf("%s: %s", c.name, r.raw)
			}
			if countMsgs(t, e, conv) != 0 {
				t.Fatal("failed turn persisted")
			}
		})
	}
	// AI service completely unreachable.
	e := newEnvWith(t, map[string]string{"AI_SERVICE_URL": "http://127.0.0.1:1", "AI_SERVICE_TOKEN": fakeAIToken, "AI_REQUEST_TIMEOUT_SECONDS": "1"})
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	if r := a.mustStatus(a.ask(a.newConversation(), "Halo"), 503); r.code() != "AI_UNAVAILABLE" {
		t.Fatalf("unreachable: %s", r.raw)
	}
	// Core features keep working while AI is down (NFR-11).
	a.createProduct(kopi(nil))
}

func TestAssistantNotConfigured(t *testing.T) {
	e := newEnv(t) // no AI_SERVICE_TOKEN
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	r := a.mustStatus(a.ask(a.newConversation(), "Halo"), 503)
	if r.code() != "AI_NOT_CONFIGURED" {
		t.Fatalf("code = %s", r.code())
	}
}

func TestAssistantConversationsArePrivate(t *testing.T) {
	f := &fakeAI{respond: func(int, map[string]any) (int, any) { return 200, answer("ok") }}
	e := newAIEnv(t, f, 5)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	b := e.ownerWithStore(t, "b@toko.id", "Toko B")
	conv := a.newConversation()
	a.mustStatus(a.ask(conv, "Rahasia owner A"), 201)

	a.mustStatus(a.do("POST", "/api/v1/settings/team", map[string]any{"name": "Kasir", "email": "kasir@toko.id", "password": "kasir-12345"}), 201)
	staff := e.client(t)
	staff.mustStatus(staff.do("POST", "/api/v1/auth/login", map[string]any{"email": "kasir@toko.id", "password": "kasir-12345"}), 200)

	for name, c := range map[string]*client{"staff same store": staff, "other store": b} {
		if r := c.do("GET", "/api/v1/assistant/conversations/"+conv, nil); r.status != 404 || strings.Contains(r.raw, "Rahasia") {
			t.Errorf("%s GET: %d %s", name, r.status, r.raw)
		}
		if r := c.ask(conv, "intip"); r.status != 404 {
			t.Errorf("%s POST: %d", name, r.status)
		}
		if strings.Contains(c.mustStatus(c.do("GET", "/api/v1/assistant/conversations", nil), 200).raw, conv) {
			t.Errorf("%s lists owner's conversation", name)
		}
	}
	staffConv := staff.newConversation() // staff can use the assistant for their own conversations
	staff.mustStatus(staff.ask(staffConv, "Halo"), 201)
	if got := dig(a.mustStatus(a.do("GET", "/api/v1/assistant/conversations", nil), 200).body, "meta", "total"); got != float64(1) {
		t.Fatalf("owner list must not include staff conversation: %v", got)
	}
	a.mustStatus(a.ask(conv, strings.Repeat("x", 1001)), 400)
	a.mustStatus(a.do("POST", "/api/v1/assistant/conversations/"+conv+"/messages", map[string]any{"content": "hai", "store_id": "x"}), 400)
}

func TestAssistantRateLimit(t *testing.T) {
	f := &fakeAI{respond: func(int, map[string]any) (int, any) { return 200, answer("ok") }}
	e := newAIEnv(t, f, 5)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	conv := a.newConversation()
	for i := range 20 {
		a.mustStatus(a.ask(conv, fmt.Sprint("q", i)), 201)
	}
	r := a.mustStatus(a.ask(conv, "q21"), 429)
	if r.header.Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
	if r.code() != "RATE_LIMITED" || !strings.Contains(fmt.Sprint(dig(r.body, "error", "message")), "per jam") {
		t.Fatalf("code = %s, message = %v (want the per-user quota message)", r.code(), dig(r.body, "error", "message"))
	}
	e.clock.Advance(61 * time.Minute)
	a.mustStatus(a.ask(conv, "q22"), 201)
}

func TestProductStockToolMatchesAllWords(t *testing.T) {
	var result string
	f := &fakeAI{respond: func(n int, req map[string]any) (int, any) {
		if lastMsg(req)["role"] == "user" {
			return 200, toolCalls(call("c1", "get_product_stock", map[string]any{"query": "kopi 250g"}))
		}
		result = lastMsg(req)["content"].(string)
		return 200, answer("ok")
	}}
	e := newAIEnv(t, f, 5)
	a := e.ownerWithStore(t, "a@toko.id", "Toko A")
	a.createProduct(kopi(map[string]any{"name": "Kopi Arabica Gayo 250g"}))
	a.createProduct(kopi(map[string]any{"name": "Kopi Robusta 1kg", "sku": "ROB-1"}))
	a.mustStatus(a.ask(a.newConversation(), "Berapa stok kopi 250g?"), 201)
	if !strings.Contains(result, "Kopi Arabica Gayo 250g") || strings.Contains(result, "Robusta") || !strings.Contains(result, `"match_count":1`) {
		t.Fatalf("token search: %s", result)
	}
}
