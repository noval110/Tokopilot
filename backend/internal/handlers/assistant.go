package handlers

import (
	"net/http"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/assistant"
	"tokopilot/backend/internal/httpx"
	"tokopilot/backend/internal/middleware"
)

type Assistant struct {
	Svc *assistant.Service
}

// CreateConversation: POST /api/v1/assistant/conversations
func (h *Assistant) CreateConversation(c *echo.Context) error {
	conv, err := h.Svc.CreateConversation(c.Request().Context(), storeID(c), middleware.PrincipalFrom(c).User.ID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, conv)
}

// ListConversations: GET /api/v1/assistant/conversations (own conversations only)
func (h *Assistant) ListConversations(c *echo.Context) error {
	page, err := httpx.ParsePage(c)
	if err != nil {
		return err
	}
	list, total, err := h.Svc.ListConversations(c.Request().Context(), storeID(c), middleware.PrincipalFrom(c).User.ID, page.PerPage, page.Offset())
	if err != nil {
		return err
	}
	if list == nil {
		list = []assistant.Conversation{}
	}
	return c.JSON(http.StatusOK, map[string]any{"data": list, "meta": httpx.PageMeta{Page: page.Page, PerPage: page.PerPage, Total: total}})
}

// GetConversation: GET /api/v1/assistant/conversations/:id
func (h *Assistant) GetConversation(c *echo.Context) error {
	conv, msgs, err := h.Svc.GetConversation(c.Request().Context(), storeID(c), middleware.PrincipalFrom(c).User.ID, c.Param("id"))
	if err != nil {
		return err
	}
	if msgs == nil {
		msgs = []assistant.Message{}
	}
	return c.JSON(http.StatusOK, map[string]any{"conversation": conv, "messages": msgs})
}

type sendInput struct {
	Content string `json:"content"`
}

// SendMessage: POST /api/v1/assistant/conversations/:id/messages
func (h *Assistant) SendMessage(c *echo.Context) error {
	var in sendInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	userMsg, asst, err := h.Svc.Send(c.Request().Context(), middleware.TenantFrom(c).Store, middleware.PrincipalFrom(c).User.ID,
		c.Param("id"), httpx.RequestIDFrom(c), in.Content)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, map[string]any{"messages": []assistant.Message{userMsg, asst}})
}
