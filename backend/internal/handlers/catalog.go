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

type Catalog struct {
	Svc *services.CatalogService
}

type categoryRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type categoryDTO struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	ProductCount *int       `json:"product_count,omitempty"`
	ArchivedAt   *time.Time `json:"archived_at"`
}

// productDTO: money as integer rupiah, quantities as NUMERIC strings (ADR-0005).
type productDTO struct {
	ID           string             `json:"id"`
	Name         string             `json:"name"`
	SKU          *string            `json:"sku"`
	Category     *categoryRef       `json:"category"`
	Unit         string             `json:"unit"`
	UnitScale    int                `json:"unit_scale"`
	CostPrice    int64              `json:"cost_price"`
	SellingPrice int64              `json:"selling_price"`
	CurrentStock string             `json:"current_stock"`
	MinStock     string             `json:"min_stock"`
	StockStatus  domain.StockStatus `json:"stock_status"`
	IsActive     bool               `json:"is_active"`
	ArchivedAt   *time.Time         `json:"archived_at"`
	CreatedAt    time.Time          `json:"created_at"`
	UpdatedAt    time.Time          `json:"updated_at"`
}

func toProduct(p domain.Product) productDTO {
	d := productDTO{
		ID: p.ID, Name: p.Name, SKU: p.SKU, Unit: p.Unit, UnitScale: p.UnitScale,
		CostPrice: p.CostPrice, SellingPrice: p.SellingPrice, CurrentStock: p.CurrentStock, MinStock: p.MinStock,
		StockStatus: p.StockStatus, IsActive: p.IsActive, ArchivedAt: p.ArchivedAt,
		CreatedAt: p.CreatedAt.UTC(), UpdatedAt: p.UpdatedAt.UTC(),
	}
	if p.CategoryID != nil && p.CategoryName != nil {
		d.Category = &categoryRef{ID: *p.CategoryID, Name: *p.CategoryName}
	}
	return d
}

func toCategory(c domain.Category) categoryDTO {
	return categoryDTO{ID: c.ID, Name: c.Name, ArchivedAt: c.ArchivedAt}
}

type productList struct {
	Data []productDTO   `json:"data"`
	Meta httpx.PageMeta `json:"meta"`
}

func storeID(c *echo.Context) string { return middleware.TenantFrom(c).Store.ID }

// ListProducts: GET /api/v1/products
func (h *Catalog) ListProducts(c *echo.Context) error {
	page, err := httpx.ParsePage(c)
	if err != nil {
		return err
	}
	products, total, err := h.Svc.ListProducts(c.Request().Context(), storeID(c), services.ProductQuery{
		Q: c.QueryParam("q"), CategoryID: c.QueryParam("category_id"), StockStatus: c.QueryParam("stock_status"),
		Status: c.QueryParam("status"), Sort: c.QueryParam("sort"),
	}, page.PerPage, page.Offset())
	if err != nil {
		return err
	}
	out := productList{Data: make([]productDTO, 0, len(products)), Meta: httpx.PageMeta{Page: page.Page, PerPage: page.PerPage, Total: total}}
	for _, p := range products {
		out.Data = append(out.Data, toProduct(p))
	}
	return c.JSON(http.StatusOK, out)
}

// GetProduct: GET /api/v1/products/:id
func (h *Catalog) GetProduct(c *echo.Context) error {
	p, err := h.Svc.GetProduct(c.Request().Context(), storeID(c), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, toProduct(p))
}

// CreateProduct: POST /api/v1/products (owner)
func (h *Catalog) CreateProduct(c *echo.Context) error {
	var in services.CreateProductInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	p, err := h.Svc.CreateProduct(c.Request().Context(), storeID(c), middleware.PrincipalFrom(c).User.ID, in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, toProduct(p))
}

// UpdateProduct: PATCH /api/v1/products/:id (owner)
func (h *Catalog) UpdateProduct(c *echo.Context) error {
	var in services.ProductInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	p, err := h.Svc.UpdateProduct(c.Request().Context(), storeID(c), c.Param("id"), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, toProduct(p))
}

// ArchiveProduct: POST /api/v1/products/:id/archive (owner)
func (h *Catalog) ArchiveProduct(c *echo.Context) error {
	p, err := h.Svc.ArchiveProduct(c.Request().Context(), storeID(c), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, toProduct(p))
}

type categoryList struct {
	Data []categoryDTO `json:"data"`
}

// ListCategories: GET /api/v1/categories?include_archived=true
func (h *Catalog) ListCategories(c *echo.Context) error {
	cats, err := h.Svc.ListCategories(c.Request().Context(), storeID(c), c.QueryParam("include_archived") == "true")
	if err != nil {
		return err
	}
	out := categoryList{Data: make([]categoryDTO, 0, len(cats))}
	for _, cat := range cats {
		d := toCategory(cat.Category)
		n := cat.ProductCount
		d.ProductCount = &n
		out.Data = append(out.Data, d)
	}
	return c.JSON(http.StatusOK, out)
}

// CreateCategory: POST /api/v1/categories (owner)
func (h *Catalog) CreateCategory(c *echo.Context) error {
	var in services.CategoryInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	cat, err := h.Svc.CreateCategory(c.Request().Context(), storeID(c), middleware.PrincipalFrom(c).User.ID, in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, toCategory(cat))
}

// RenameCategory: PATCH /api/v1/categories/:id (owner)
func (h *Catalog) RenameCategory(c *echo.Context) error {
	var in services.CategoryInput
	if err := httpx.DecodeJSON(c, &in); err != nil {
		return err
	}
	cat, err := h.Svc.RenameCategory(c.Request().Context(), storeID(c), c.Param("id"), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, toCategory(cat))
}

// ArchiveCategory: POST /api/v1/categories/:id/archive (owner)
func (h *Catalog) ArchiveCategory(c *echo.Context) error {
	if err := h.Svc.ArchiveCategory(c.Request().Context(), storeID(c), c.Param("id")); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
