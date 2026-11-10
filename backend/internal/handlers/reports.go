package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/middleware"
	"tokopilot/backend/internal/repositories"
	"tokopilot/backend/internal/services"
)

type Reports struct {
	Svc *services.ReportService
}

type periodDTO struct {
	From        string    `json:"from"`
	To          string    `json:"to"`
	Timezone    string    `json:"timezone"`
	Days        int       `json:"days"`
	GeneratedAt time.Time `json:"generated_at"`
}

func toPeriod(p services.Period) periodDTO {
	return periodDTO{From: p.From.Format("2006-01-02"), To: p.To.Format("2006-01-02"), Timezone: p.Timezone, Days: p.Days, GeneratedAt: p.GeneratedAt}
}

type summaryDTO2 struct {
	GrossSales       int64 `json:"gross_sales"`
	DiscountTotal    int64 `json:"discount_total"`
	NetSales         int64 `json:"net_sales"`
	TransactionCount int64 `json:"transaction_count"`
	AvgTransaction   int64 `json:"avg_transaction_value"`
	COGS             int64 `json:"cogs"`
	GrossProfit      int64 `json:"gross_profit"`
	VoidedCount      int64 `json:"voided_count"`
	VoidedNet        int64 `json:"voided_net_total"`
}

func toSummary(s services.Summary) summaryDTO2 {
	return summaryDTO2{
		GrossSales: s.GrossSales, DiscountTotal: s.DiscountTotal, NetSales: s.NetSales, TransactionCount: s.TransactionCount,
		AvgTransaction: s.AvgTransaction, COGS: s.COGS, GrossProfit: s.GrossProfit, VoidedCount: s.VoidedCount, VoidedNet: s.VoidedNet,
	}
}

type dailyDTO struct {
	Date             string `json:"date"`
	NetSales         int64  `json:"net_sales"`
	TransactionCount int64  `json:"transaction_count"`
}

func toDaily(ds []repositories.DailySales) []dailyDTO {
	out := make([]dailyDTO, 0, len(ds))
	for _, d := range ds {
		out = append(out, dailyDTO{Date: d.Day.Format("2006-01-02"), NetSales: d.NetSales, TransactionCount: d.TransactionCount})
	}
	return out
}

type topProductDTO struct {
	Rank         int     `json:"rank"`
	ProductID    *string `json:"product_id"`
	Name         string  `json:"product_name"`
	SKU          *string `json:"sku"`
	Unit         string  `json:"unit"`
	QuantitySold string  `json:"quantity_sold"`
	Revenue      int64   `json:"revenue"`
	Transactions int64   `json:"transaction_count"`
}

func toTop(ts []repositories.TopProduct) []topProductDTO {
	out := make([]topProductDTO, 0, len(ts))
	for i, t := range ts {
		out = append(out, topProductDTO{Rank: i + 1, ProductID: t.ProductID, Name: t.Name, SKU: t.SKU, Unit: t.Unit,
			QuantitySold: t.QuantitySold, Revenue: t.Revenue, Transactions: t.Transactions})
	}
	return out
}

type dashboardDTO struct {
	Period         periodDTO   `json:"period"`
	Sales          summaryDTO2 `json:"sales"`
	ActiveProducts int         `json:"active_products"`
	LowStock       int         `json:"low_stock_count"`
	OutOfStock     int         `json:"out_of_stock_count"`
}

// DashboardSummary: GET /api/v1/dashboard/summary?from&to
func (h *Reports) DashboardSummary(c *echo.Context) error {
	d, err := h.Svc.Dashboard(c.Request().Context(), middleware.TenantFrom(c).Store, c.QueryParam("from"), c.QueryParam("to"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, dashboardDTO{Period: toPeriod(d.Period), Sales: toSummary(d.Summary),
		ActiveProducts: d.ActiveProducts, LowStock: d.LowStock, OutOfStock: d.OutOfStock})
}

// SalesTrend: GET /api/v1/dashboard/sales-trend?from&to
func (h *Reports) SalesTrend(c *echo.Context) error {
	p, days, err := h.Svc.Trend(c.Request().Context(), middleware.TenantFrom(c).Store, c.QueryParam("from"), c.QueryParam("to"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"period": toPeriod(p), "data": toDaily(days)})
}

// TopProducts: GET /api/v1/dashboard/top-products?from&to&limit
func (h *Reports) TopProducts(c *echo.Context) error {
	p, top, err := h.Svc.TopProducts(c.Request().Context(), middleware.TenantFrom(c).Store, c.QueryParam("from"), c.QueryParam("to"), c.QueryParam("limit"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"period": toPeriod(p), "data": toTop(top)})
}

type paymentDTO struct {
	Method           string `json:"payment_method"`
	TransactionCount int64  `json:"transaction_count"`
	NetSales         int64  `json:"net_sales"`
}

// SalesReport: GET /api/v1/reports/sales?from&to
func (h *Reports) SalesReport(c *echo.Context) error {
	r, err := h.Svc.Sales(c.Request().Context(), middleware.TenantFrom(c).Store, c.QueryParam("from"), c.QueryParam("to"))
	if err != nil {
		return err
	}
	payments := make([]paymentDTO, 0, len(r.Payments))
	for _, p := range r.Payments {
		payments = append(payments, paymentDTO{Method: p.Method, TransactionCount: p.TransactionCount, NetSales: p.NetSales})
	}
	return c.JSON(http.StatusOK, map[string]any{
		"period": toPeriod(r.Period), "summary": toSummary(r.Summary), "top_products": toTop(r.TopProducts),
		"payment_methods": payments, "daily": toDaily(r.Daily),
	})
}

// ExportSales: GET /api/v1/reports/sales/export?from&to — CSV download.
func (h *Reports) ExportSales(c *echo.Context) error {
	store := middleware.TenantFrom(c).Store
	p, err := h.Svc.ResolvePeriod(c.QueryParam("from"), c.QueryParam("to"), store.Timezone)
	if err != nil {
		return err
	}
	res := c.Response()
	res.Header().Set(echo.HeaderContentType, "text/csv; charset=utf-8")
	res.Header().Set(echo.HeaderContentDisposition,
		fmt.Sprintf(`attachment; filename="tokopilot-penjualan-%s_%s.csv"`, p.From.Format("2006-01-02"), p.To.Format("2006-01-02")))
	res.WriteHeader(http.StatusOK)
	// Headers are already sent; a failure mid-stream can only be logged by the caller chain.
	return h.Svc.Export(c.Request().Context(), store, p, res)
}
