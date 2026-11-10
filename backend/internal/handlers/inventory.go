package handlers

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/httpx"
	"tokopilot/backend/internal/middleware"
	"tokopilot/backend/internal/services"
)

type Inventory struct {
	Svc *services.InventoryService
}

type movementProductDTO struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	SKU       *string `json:"sku"`
	Unit      string  `json:"unit"`
	UnitScale int     `json:"unit_scale"`
}

type actorDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type movementDTO struct {
	ID            string              `json:"id"`
	Product       movementProductDTO  `json:"product"`
	Type          domain.MovementType `json:"type"`
	QuantityDelta string              `json:"quantity_delta"`
	StockBefore   string              `json:"stock_before"`
	StockAfter    string              `json:"stock_after"`
	ReasonCode    *domain.ReasonCode  `json:"reason_code"`
	Note          *string             `json:"note"`
	Actor         actorDTO            `json:"actor"`
	ReferenceType *string             `json:"reference_type"`
	ReferenceID   *string             `json:"reference_id"`
	CreatedAt     time.Time           `json:"created_at"`
}

func toMovement(m domain.StockMovement) movementDTO {
	return movementDTO{
		ID:            m.ID,
		Product:       movementProductDTO{ID: m.ProductID, Name: m.ProductName, SKU: m.ProductSKU, Unit: m.ProductUnit, UnitScale: m.UnitScale},
		Type:          m.Type,
		QuantityDelta: m.QuantityDelta, StockBefore: m.StockBefore, StockAfter: m.StockAfter,
		ReasonCode: m.ReasonCode, Note: m.Note,
		Actor:         actorDTO{ID: m.ActorID, Name: m.ActorName},
		ReferenceType: m.ReferenceType, ReferenceID: m.ReferenceID,
		CreatedAt: m.CreatedAt.UTC(),
	}
}

type stockChangeResponse struct {
	Product  productDTO  `json:"product"`
	Movement movementDTO `json:"movement"`
}

func toStockChange(r services.StockChangeResult) stockChangeResponse {
	return stockChangeResponse{Product: toProduct(r.Product), Movement: toMovement(r.Movement)}
}

// Restock: POST /api/v1/inventory/restocks (owner)
func (h *Inventory) Restock(c *echo.Context) error {
	var in services.RestockInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	res, err := h.Svc.Restock(c.Request().Context(), storeID(c), middleware.PrincipalFrom(c).User.ID, in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, toStockChange(res))
}

// Adjust: POST /api/v1/inventory/adjustments (owner)
func (h *Inventory) Adjust(c *echo.Context) error {
	var in services.AdjustmentInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	res, err := h.Svc.Adjust(c.Request().Context(), storeID(c), middleware.PrincipalFrom(c).User.ID, in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, toStockChange(res))
}

type movementList struct {
	Data []movementDTO  `json:"data"`
	Meta httpx.PageMeta `json:"meta"`
}

// ListMovements: GET /api/v1/inventory/movements
func (h *Inventory) ListMovements(c *echo.Context) error {
	page, err := httpx.ParsePage(c)
	if err != nil {
		return err
	}
	list, total, err := h.Svc.ListMovements(c.Request().Context(), middleware.TenantFrom(c).Store, services.MovementQuery{
		ProductID: c.QueryParam("product_id"), Type: c.QueryParam("type"), From: c.QueryParam("from"), To: c.QueryParam("to"),
	}, page.PerPage, page.Offset())
	if err != nil {
		return err
	}
	out := movementList{Data: make([]movementDTO, 0, len(list)), Meta: httpx.PageMeta{Page: page.Page, PerPage: page.PerPage, Total: total}}
	for _, m := range list {
		out.Data = append(out.Data, toMovement(m))
	}
	return c.JSON(http.StatusOK, out)
}

type summaryDTO struct {
	ActiveProducts int `json:"active_products"`
	LowStock       int `json:"low_stock"`
	OutOfStock     int `json:"out_of_stock"`
}

// Summary: GET /api/v1/inventory/summary
func (h *Inventory) Summary(c *echo.Context) error {
	s, err := h.Svc.Summary(c.Request().Context(), storeID(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, summaryDTO{ActiveProducts: s.ActiveProducts, LowStock: s.LowStock, OutOfStock: s.OutOfStock})
}
