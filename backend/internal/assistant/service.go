package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/ratelimit"
)

// MaxToolIterations caps model↔tool round-trips per user turn (PRD §13.4).
const MaxToolIterations = 4

const historyTurns = 10 // previous user/assistant messages sent for context

type Service struct {
	pool        *pgxpool.Pool
	client      *Client
	tools       *Tools
	now         func() time.Time
	perUser     *ratelimit.Limiter // 20 messages / hour / user (ADR-0008)
	perStore    *ratelimit.Limiter // 200 messages / day / store
	turnTimeout time.Duration
}

func NewService(pool *pgxpool.Pool, client *Client, tools *Tools, now func() time.Time, turnTimeout time.Duration) *Service {
	return &Service{
		pool: pool, client: client, tools: tools, now: now, turnTimeout: turnTimeout,
		perUser:  ratelimit.New(20, time.Hour, now),
		perStore: ratelimit.New(200, 24*time.Hour, now),
	}
}

type Conversation struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Message struct {
	ID        string    `json:"id"`
	Role      string    `json:"role"` // user | assistant
	Content   string    `json:"content"`
	Sources   []Source  `json:"sources"`
	CreatedAt time.Time `json:"created_at"`
}

var errConvNotFound = apperr.NotFound("Percakapan tidak ditemukan.")

func isUUID(s string) bool {
	return len(s) == 36 && strings.Count(s, "-") == 4
}

// CreateConversation starts an empty conversation owned by (store, user).
func (s *Service) CreateConversation(ctx context.Context, storeID, userID string) (Conversation, error) {
	var c Conversation
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ai_conversations (store_id, user_id, title) VALUES ($1, $2, 'Percakapan baru')
		RETURNING id, title, created_at, updated_at`, storeID, userID).Scan(&c.ID, &c.Title, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return Conversation{}, fmt.Errorf("create conversation: %w", err)
	}
	return c, nil
}

// ListConversations returns only the caller's own conversations in their store.
func (s *Service) ListConversations(ctx context.Context, storeID, userID string, limit, offset int) ([]Conversation, int, error) {
	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM ai_conversations WHERE store_id = $1 AND user_id = $2`, storeID, userID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count conversations: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, created_at, updated_at FROM ai_conversations
		WHERE store_id = $1 AND user_id = $2 ORDER BY updated_at DESC, id LIMIT $3 OFFSET $4`, storeID, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list conversations: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Conversation, error) {
		var c Conversation
		err := r.Scan(&c.ID, &c.Title, &c.CreatedAt, &c.UpdatedAt)
		return c, err
	})
	return list, total, err
}

func (s *Service) owned(ctx context.Context, q db.DBTX, storeID, userID, id string) (Conversation, error) {
	if !isUUID(id) {
		return Conversation{}, errConvNotFound
	}
	var c Conversation
	err := q.QueryRow(ctx, `SELECT id, title, created_at, updated_at FROM ai_conversations WHERE id = $1 AND store_id = $2 AND user_id = $3`,
		id, storeID, userID).Scan(&c.ID, &c.Title, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, errConvNotFound // other users' and other stores' conversations look absent
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("get conversation: %w", err)
	}
	return c, nil
}

// GetConversation returns the conversation with its visible (user/assistant) messages.
func (s *Service) GetConversation(ctx context.Context, storeID, userID, id string) (Conversation, []Message, error) {
	c, err := s.owned(ctx, s.pool, storeID, userID, id)
	if err != nil {
		return Conversation{}, nil, err
	}
	msgs, err := s.messages(ctx, storeID, id, 200)
	return c, msgs, err
}

func (s *Service) messages(ctx context.Context, storeID, convID string, limit int) ([]Message, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, role, content, tool_metadata, created_at FROM (
			SELECT * FROM ai_messages WHERE store_id = $1 AND conversation_id = $2 AND role <> 'tool'
			ORDER BY seq DESC LIMIT $3) m
		ORDER BY seq`, storeID, convID, limit)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Message, error) {
		var m Message
		var meta []byte
		if err := r.Scan(&m.ID, &m.Role, &m.Content, &meta, &m.CreatedAt); err != nil {
			return m, err
		}
		m.Sources = []Source{}
		if len(meta) > 0 {
			var md struct {
				Sources []Source `json:"sources"`
			}
			if json.Unmarshal(meta, &md) == nil && md.Sources != nil {
				m.Sources = md.Sources
			}
		}
		return m, nil
	})
}

// rateLimited keeps RATE_LIMITED + Retry-After but says which quota was hit.
func rateLimited(wait time.Duration, msg string) error {
	e := apperr.RateLimited(wait)
	e.Message = msg
	return e
}

func aiError(err error) error {
	switch {
	case errors.Is(err, ErrAITimeout):
		return apperr.New(http.StatusServiceUnavailable, "AI_TIMEOUT", "Asisten AI terlalu lama merespons. Coba lagi sebentar lagi.")
	case errors.Is(err, ErrAIRateLimited):
		return apperr.New(http.StatusServiceUnavailable, "AI_BUSY", "Layanan AI sedang sibuk. Coba lagi sebentar lagi.")
	case errors.Is(err, ErrAIMalformed):
		return apperr.New(http.StatusBadGateway, "AI_BAD_RESPONSE", "Asisten AI memberikan jawaban yang tidak dapat diproses. Coba ulangi pertanyaan.")
	default:
		return apperr.New(http.StatusServiceUnavailable, "AI_UNAVAILABLE", "Layanan AI sementara tidak tersedia. Fitur stok dan penjualan tetap berjalan.")
	}
}

type pendingTool struct {
	call   ToolCall
	result string
	err    bool
}

// Send runs one user turn: model ↔ tools loop, then persists the turn
// atomically. Nothing is stored when the turn fails (the client keeps the draft).
func (s *Service) Send(ctx context.Context, store domain.Store, userID, convID, requestID, content string) (Message, Message, error) {
	content = strings.TrimSpace(content)
	if n := utf8.RuneCountInString(content); n < 1 || n > 1000 {
		return Message{}, Message{}, apperr.Validation(apperr.FieldErrors{"content": "Pertanyaan wajib, maksimal 1000 karakter."})
	}
	conv, err := s.owned(ctx, s.pool, store.ID, userID, convID)
	if err != nil {
		return Message{}, Message{}, err
	}
	if !s.client.Configured() {
		return Message{}, Message{}, apperr.New(http.StatusServiceUnavailable, "AI_NOT_CONFIGURED", "Asisten AI belum dikonfigurasi di server ini.")
	}
	if ok, wait := s.perUser.Allow("user:" + userID); !ok {
		return Message{}, Message{}, rateLimited(wait, "Batas 20 pertanyaan per jam tercapai. Coba lagi nanti.")
	}
	if ok, wait := s.perStore.Allow("store:" + store.ID); !ok {
		return Message{}, Message{}, rateLimited(wait, "Batas harian pertanyaan AI untuk toko ini tercapai. Coba lagi besok.")
	}

	history, err := s.messages(ctx, store.ID, conv.ID, historyTurns)
	if err != nil {
		return Message{}, Message{}, err
	}
	msgs := make([]ChatMessage, 0, len(history)+8)
	for _, h := range history {
		msgs = append(msgs, ChatMessage{Role: h.Role, Content: h.Content})
	}
	msgs = append(msgs, ChatMessage{Role: "user", Content: content})

	loc, err := time.LoadLocation(store.Timezone)
	if err != nil {
		loc = time.UTC
	}
	now := s.now().In(loc)
	chatCtx := ChatContext{Today: now.Format("2006-01-02"), Now: now.Format(time.RFC3339), Timezone: store.Timezone, Currency: "IDR", Locale: "id-ID"}

	turnCtx, cancel := context.WithTimeout(ctx, s.turnTimeout)
	defer cancel()

	var tools []pendingTool
	var sources []Source
	var answer string
	for iter := 0; ; iter++ {
		resp, err := s.client.Chat(turnCtx, requestID, ChatRequest{Messages: msgs, Tools: Definitions(), Context: chatCtx})
		if err != nil {
			return Message{}, Message{}, aiError(err)
		}
		if resp.Type == "answer" {
			answer = strings.TrimSpace(resp.Content)
			break
		}
		if iter >= MaxToolIterations {
			return Message{}, Message{}, apperr.New(http.StatusBadGateway, "AI_LOOP_LIMIT", "Asisten AI membutuhkan terlalu banyak langkah. Coba pertanyaan yang lebih spesifik.")
		}
		msgs = append(msgs, ChatMessage{Role: "assistant", ToolCalls: resp.ToolCalls})
		for _, tc := range resp.ToolCalls {
			result, src, execErr := s.tools.Execute(turnCtx, store, tc.Name, tc.Arguments)
			var te *ToolError
			var payload []byte
			switch {
			case errors.As(execErr, &te):
				// Not executed. The model learns why, as data, and may recover.
				payload, _ = json.Marshal(map[string]string{"error": te.Message})
			case execErr != nil:
				return Message{}, Message{}, execErr
			default:
				payload, err = json.Marshal(result)
				if err != nil {
					return Message{}, Message{}, fmt.Errorf("marshal tool result: %w", err)
				}
				sources = append(sources, src)
			}
			tools = append(tools, pendingTool{call: tc, result: string(payload), err: te != nil})
			msgs = append(msgs, ChatMessage{Role: "tool", ToolCallID: tc.ID, Name: tc.Name, Content: string(payload)})
		}
	}

	// Persist the whole turn atomically.
	var userMsg, asstMsg Message
	err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO ai_messages (conversation_id, store_id, role, content) VALUES ($1, $2, 'user', $3)
			RETURNING id, role, content, created_at`, conv.ID, store.ID, content).Scan(&userMsg.ID, &userMsg.Role, &userMsg.Content, &userMsg.CreatedAt); err != nil {
			return fmt.Errorf("insert user message: %w", err)
		}
		userMsg.Sources = []Source{}
		for _, t := range tools {
			if !IsAllowed(t.call.Name) {
				continue // a refused, non-allowlisted name is never stored as a tool row
			}
			meta, _ := json.Marshal(map[string]any{"call_id": t.call.ID, "arguments": json.RawMessage(nonEmpty(t.call.Arguments)), "error": t.err})
			if _, err := tx.Exec(ctx, `INSERT INTO ai_messages (conversation_id, store_id, role, content, tool_name, tool_metadata) VALUES ($1, $2, 'tool', $3, $4, $5)`,
				conv.ID, store.ID, t.result, t.call.Name, meta); err != nil {
				return fmt.Errorf("insert tool message: %w", err)
			}
		}
		if sources == nil {
			sources = []Source{}
		}
		meta, _ := json.Marshal(map[string]any{"sources": sources})
		if err := tx.QueryRow(ctx, `INSERT INTO ai_messages (conversation_id, store_id, role, content, tool_metadata) VALUES ($1, $2, 'assistant', $3, $4)
			RETURNING id, role, content, created_at`, conv.ID, store.ID, answer, meta).Scan(&asstMsg.ID, &asstMsg.Role, &asstMsg.Content, &asstMsg.CreatedAt); err != nil {
			return fmt.Errorf("insert assistant message: %w", err)
		}
		asstMsg.Sources = sources
		title := conv.Title
		if title == "Percakapan baru" {
			title = truncate(content, 60)
		}
		_, err := tx.Exec(ctx, `UPDATE ai_conversations SET title = $3, updated_at = clock_timestamp() WHERE id = $1 AND store_id = $2`, conv.ID, store.ID, title)
		return err
	})
	if err != nil {
		return Message{}, Message{}, err
	}
	return userMsg, asstMsg, nil
}

func nonEmpty(raw json.RawMessage) []byte {
	if len(raw) == 0 || !json.Valid(raw) {
		return []byte(`{}`)
	}
	return raw
}

func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}
