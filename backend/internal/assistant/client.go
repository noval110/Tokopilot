package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// Wire types shared with the AI service (/internal/v1/chat).

type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type ChatMessage struct {
	Role       string     `json:"role"` // user | assistant | tool
	Content    string     `json:"content,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	Name       string     `json:"name,omitempty"`
}

// ChatContext is the minimum the model needs to resolve relative dates. No
// store_id, user identity, email or other personal data is ever sent (NFR-06).
type ChatContext struct {
	Today    string `json:"today"`
	Now      string `json:"now"`
	Timezone string `json:"timezone"`
	Currency string `json:"currency"`
	Locale   string `json:"locale"`
}

type ChatRequest struct {
	Messages []ChatMessage `json:"messages"`
	Tools    []ToolDef     `json:"tools"`
	Context  ChatContext   `json:"context"`
}

type ChatResponse struct {
	Type      string     `json:"type"` // "answer" | "tool_calls"
	Content   string     `json:"content"`
	ToolCalls []ToolCall `json:"tool_calls"`
}

var (
	ErrAIUnavailable = errors.New("ai service unavailable")
	ErrAITimeout     = errors.New("ai service timeout")
	ErrAIMalformed   = errors.New("ai service returned a malformed response")
	ErrAIRateLimited = errors.New("ai provider rate limited")
)

// Client talks to the internal AI service. It is the only network path to
// anything LLM-related; the service credential never leaves the backend.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func NewClient(baseURL, token string, timeout time.Duration) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), token: token, http: &http.Client{Timeout: timeout}}
}

// Configured reports whether the assistant can run at all.
func (c *Client) Configured() bool { return c != nil && c.baseURL != "" && c.token != "" }

func (c *Client) Chat(ctx context.Context, requestID string, req ChatRequest) (ChatResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("marshal chat request: %w", err)
	}
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/internal/v1/chat", bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, ErrAIUnavailable
	}
	hreq.Header.Set("Content-Type", "application/json")
	hreq.Header.Set("Authorization", "Bearer "+c.token)
	if requestID != "" {
		hreq.Header.Set("X-Request-Id", requestID)
	}
	res, err := c.http.Do(hreq)
	if err != nil {
		var ne net.Error
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()) {
			return ChatResponse{}, ErrAITimeout
		}
		return ChatResponse{}, ErrAIUnavailable
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return ChatResponse{}, ErrAIUnavailable
	}

	switch {
	case res.StatusCode == http.StatusOK:
	case res.StatusCode == http.StatusGatewayTimeout:
		return ChatResponse{}, ErrAITimeout
	case res.StatusCode == http.StatusTooManyRequests:
		return ChatResponse{}, ErrAIRateLimited
	case res.StatusCode == http.StatusBadGateway:
		return ChatResponse{}, ErrAIMalformed
	default:
		return ChatResponse{}, ErrAIUnavailable
	}

	var out ChatResponse
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&out); err != nil {
		return ChatResponse{}, ErrAIMalformed
	}
	switch out.Type {
	case "answer":
		if strings.TrimSpace(out.Content) == "" || len(out.Content) > 8000 || len(out.ToolCalls) > 0 {
			return ChatResponse{}, ErrAIMalformed
		}
	case "tool_calls":
		if len(out.ToolCalls) == 0 || len(out.ToolCalls) > 4 {
			return ChatResponse{}, ErrAIMalformed
		}
		for _, tc := range out.ToolCalls {
			if tc.ID == "" || tc.Name == "" || len(tc.ID) > 100 {
				return ChatResponse{}, ErrAIMalformed
			}
		}
	default:
		return ChatResponse{}, ErrAIMalformed
	}
	return out, nil
}
