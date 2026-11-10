package handlers

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/httpx"
	"tokopilot/backend/internal/middleware"
	"tokopilot/backend/internal/services"
)

type Stores struct {
	Svc *services.StoreService
}

// Me: GET /api/v1/me — profile plus verified membership (null before onboarding).
func (h *Stores) Me(c *echo.Context) error {
	p := middleware.PrincipalFrom(c)
	resp := meDTO{User: toUser(p.User)}
	m, err := h.Svc.MembershipFor(c.Request().Context(), p.User.ID)
	switch {
	case err == nil:
		resp.Membership = toMembership(m)
	case !errors.Is(err, domain.ErrNotFound):
		return err
	}
	return c.JSON(http.StatusOK, resp)
}

// Create: POST /api/v1/stores — first store; caller becomes OWNER.
func (h *Stores) Create(c *echo.Context) error {
	var in services.CreateStoreInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	m, err := h.Svc.Create(c.Request().Context(), middleware.PrincipalFrom(c).User.ID, in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, toMembership(m))
}

// GetSettings: GET /api/v1/settings/store (owner)
func (h *Stores) GetSettings(c *echo.Context) error {
	return c.JSON(http.StatusOK, toStore(middleware.TenantFrom(c).Store))
}

// UpdateSettings: PATCH /api/v1/settings/store (owner)
func (h *Stores) UpdateSettings(c *echo.Context) error {
	var in services.UpdateStoreInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	s, err := h.Svc.UpdateSettings(c.Request().Context(), middleware.TenantFrom(c).Store, in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, toStore(s))
}

type memberList struct {
	Data []memberDTO    `json:"data"`
	Meta httpx.PageMeta `json:"meta"`
}

// ListTeam: GET /api/v1/settings/team (owner)
func (h *Stores) ListTeam(c *echo.Context) error {
	page, err := httpx.ParsePage(c)
	if err != nil {
		return err
	}
	members, total, err := h.Svc.ListMembers(c.Request().Context(), middleware.TenantFrom(c).Store.ID, page.PerPage, page.Offset())
	if err != nil {
		return err
	}
	out := memberList{Data: make([]memberDTO, 0, len(members)), Meta: httpx.PageMeta{Page: page.Page, PerPage: page.PerPage, Total: total}}
	for _, m := range members {
		out.Data = append(out.Data, toMember(m))
	}
	return c.JSON(http.StatusOK, out)
}

// AddStaff: POST /api/v1/settings/team (owner)
func (h *Stores) AddStaff(c *echo.Context) error {
	var in services.AddStaffInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	m, err := h.Svc.AddStaff(c.Request().Context(), middleware.PrincipalFrom(c).User.ID, middleware.TenantFrom(c).Store.ID, in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, toMember(m))
}
