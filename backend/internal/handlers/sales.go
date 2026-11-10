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

type Sales struct {
	Svc *services.SalesService
}

type saleItemDTO struct {
	LineNo       int     `json:"line_no"`
	ProductID    *string `json:"product_id"`
	ProductName  string  `json:"product_name"`
	SKU          *string `json:"sku"`
	Unit         string  `json:"unit"`
	UnitScale    int     `json:"unit_scale"`
	Quantity     string  `json:"quantity"`
	UnitPrice    int64   `json:"unit_price"`
	LineSubtotal int64   `json:"line_subtotal"`
}

type voidDTO struct {
	Reason string    `json:"reason"`
	By     actorDTO  `json:"by"`
	At     time.Time `json:"at"`
}

type saleDTO struct {
	ID             string            `json:"id"`
	SaleNumber     string            `json:"sale_number"`
	Status         domain.SaleStatus `json:"status"`
	Subtotal       int64             `json:"subtotal"`
	DiscountAmount int64             `json:"discount_amount"`
	NetTotal       int64             `json:"net_total"`
	PaymentMethod  string            `json:"payment_method"`
	Notes          *string           `json:"notes"`
	Cashier        actorDTO          `json:"cashier"`
	SoldAt         time.Time         `json:"sold_at"`
	ItemCount      int               `json:"item_count"`
	Void           *voidDTO          `json:"void"`
	Items          []saleItemDTO     `json:"items,omitempty"`
}

// toSale renders a sale. cost_price_snapshot is kept internal (used by reports).
func toSale(s domain.Sale) saleDTO {
	d := saleDTO{
		ID: s.ID, SaleNumber: s.SaleNumber, Status: s.Status, Subtotal: s.Subtotal, DiscountAmount: s.DiscountAmount,
		NetTotal: s.NetTotal, PaymentMethod: s.PaymentMethod, Notes: s.Notes,
		Cashier: actorDTO{ID: s.CashierID, Name: s.CashierName}, SoldAt: s.SoldAt.UTC(), ItemCount: s.ItemCount,
	}
	if s.Status == domain.SaleVoided && s.VoidReason != nil && s.VoidedByID != nil && s.VoidedAt != nil {
		name := ""
		if s.VoidedByName != nil {
			name = *s.VoidedByName
		}
		d.Void = &voidDTO{Reason: *s.VoidReason, By: actorDTO{ID: *s.VoidedByID, Name: name}, At: s.VoidedAt.UTC()}
	}
	for _, it := range s.Items {
		d.Items = append(d.Items, saleItemDTO{
			LineNo: it.LineNo, ProductID: it.ProductID, ProductName: it.ProductName, SKU: it.SKU, Unit: it.Unit,
			UnitScale: it.UnitScale, Quantity: it.Quantity, UnitPrice: it.UnitPrice, LineSubtotal: it.LineSubtotal,
		})
	}
	return d
}

// Checkout: POST /api/v1/sales (owner + staff). 201 for a new sale; 200 with
// Idempotent-Replayed: true when the same request was already recorded.
func (h *Sales) Checkout(c *echo.Context) error {
	var in services.CheckoutInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	sale, replayed, err := h.Svc.Checkout(c.Request().Context(), middleware.TenantFrom(c).Store, middleware.PrincipalFrom(c).User.ID, in)
	if err != nil {
		return err
	}
	status := http.StatusCreated
	if replayed {
		c.Response().Header().Set("Idempotent-Replayed", "true")
		status = http.StatusOK
	}
	return c.JSON(status, toSale(sale))
}

// Get: GET /api/v1/sales/:id
func (h *Sales) Get(c *echo.Context) error {
	sale, err := h.Svc.Get(c.Request().Context(), storeID(c), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, toSale(sale))
}

// Void: POST /api/v1/sales/:id/void (owner)
func (h *Sales) Void(c *echo.Context) error {
	var in services.VoidInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	sale, err := h.Svc.Void(c.Request().Context(), storeID(c), middleware.PrincipalFrom(c).User.ID, c.Param("id"), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, toSale(sale))
}

type saleList struct {
	Data []saleDTO      `json:"data"`
	Meta httpx.PageMeta `json:"meta"`
}

// List: GET /api/v1/sales
func (h *Sales) List(c *echo.Context) error {
	page, err := httpx.ParsePage(c)
	if err != nil {
		return err
	}
	list, total, err := h.Svc.List(c.Request().Context(), middleware.TenantFrom(c).Store, services.SaleQuery{
		Status: c.QueryParam("status"), PaymentMethod: c.QueryParam("payment_method"), Number: c.QueryParam("q"),
		From: c.QueryParam("from"), To: c.QueryParam("to"),
	}, page.PerPage, page.Offset())
	if err != nil {
		return err
	}
	out := saleList{Data: make([]saleDTO, 0, len(list)), Meta: httpx.PageMeta{Page: page.Page, PerPage: page.PerPage, Total: total}}
	for _, s := range list {
		out.Data = append(out.Data, toSale(s))
	}
	return c.JSON(http.StatusOK, out)
}
