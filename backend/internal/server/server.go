// Package server wires middleware and routes into an Echo instance.
package server

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"
	echomw "github.com/labstack/echo/v5/middleware"

	"tokopilot/backend/internal/assistant"
	"tokopilot/backend/internal/auth"
	"tokopilot/backend/internal/config"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/handlers"
	"tokopilot/backend/internal/httpx"
	mw "tokopilot/backend/internal/middleware"
	"tokopilot/backend/internal/ratelimit"
	"tokopilot/backend/internal/services"
)

// Deps are collaborators injected into the router. When Pool is nil only the
// health endpoints are mounted (used by plumbing tests).
type Deps struct {
	Config          config.Config
	Logger          *slog.Logger
	ReadinessChecks []handlers.ReadinessCheck
	Pool            *pgxpool.Pool
	Now             func() time.Time
	PasswordParams  auth.Params
}

// New returns a fully configured Echo instance.
func New(d Deps) (*echo.Echo, error) {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.PasswordParams == (auth.Params{}) {
		d.PasswordParams = auth.DefaultParams
	}

	e := echo.New()
	e.Logger = d.Logger
	e.HTTPErrorHandler = httpx.ErrorHandler(d.Logger)
	// Use the TCP peer address. X-Forwarded-For is NOT trusted until the
	// deployment's proxy ranges are configured (Sprint 7), so it cannot be
	// spoofed to dodge rate limits.
	e.IPExtractor = echo.ExtractIPDirect()

	// Order matters: request ID first so every later log line and error
	// envelope carries it; Recover inside AccessLog so panics are logged as 500.
	e.Use(httpx.RequestID())
	e.Use(httpx.AccessLog(d.Logger))
	e.Use(echomw.Recover())
	e.Use(httpx.SecurityHeaders())
	e.Use(echomw.BodyLimit(d.Config.RequestBodyLimit))
	e.Use(echomw.CORSWithConfig(echomw.CORSConfig{
		AllowOrigins:     []string{d.Config.FrontendOrigin},
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowHeaders:     []string{echo.HeaderContentType, echo.HeaderXRequestID, "Idempotency-Key", mw.CSRFHeader},
		ExposeHeaders:    []string{echo.HeaderXRequestID, "Idempotent-Replayed"},
		AllowCredentials: true,
		MaxAge:           600,
	}))
	e.Use(mw.OriginCheck(d.Config.FrontendOrigin))

	health := handlers.NewHealth(d.ReadinessChecks...)
	e.GET("/healthz", health.Live)
	e.GET("/readyz", health.Ready)

	v1 := e.Group("/api/v1")
	v1.GET("/health", health.Live)

	if d.Pool != nil {
		if err := mountBusinessRoutes(v1, d); err != nil {
			return nil, err
		}
	}

	e.RouteNotFound("/*", func(c *echo.Context) error {
		return httpx.NewError(http.StatusNotFound, httpx.CodeNotFound, "Endpoint tidak ditemukan.")
	})

	return e, nil
}

func mountBusinessRoutes(v1 *echo.Group, d Deps) error {
	authSvc, err := services.NewAuthService(d.Pool, d.PasswordParams, d.Now)
	if err != nil {
		return err
	}
	storeSvc := services.NewStoreService(d.Pool, authSvc.HashPassword)

	authH := &handlers.Auth{
		Svc:           authSvc,
		Stores:        storeSvc,
		CSRFSecret:    d.Config.SessionSecret(),
		SecureCookie:  d.Config.SecureCookies(),
		LoginFailures: ratelimit.New(5, 15*time.Minute, d.Now),
		AuthRequests:  ratelimit.New(60, 15*time.Minute, d.Now),
	}
	storeH := &handlers.Stores{Svc: storeSvc}
	catalogH := &handlers.Catalog{Svc: services.NewCatalogService(d.Pool, d.Now)}
	inventoryH := &handlers.Inventory{Svc: services.NewInventoryService(d.Pool)}
	salesH := &handlers.Sales{Svc: services.NewSalesService(d.Pool, d.Now)}
	reportSvc := services.NewReportService(d.Pool, d.Now)
	reportsH := &handlers.Reports{Svc: reportSvc}
	aiClient := assistant.NewClient(d.Config.AIServiceURL, d.Config.AIServiceToken(), d.Config.AIRequestTimeout)
	assistantH := &handlers.Assistant{Svc: assistant.NewService(d.Pool, aiClient, assistant.NewTools(d.Pool, reportSvc, d.Now), d.Now,
		d.Config.AIRequestTimeout+15*time.Second)}

	// Public
	v1.POST("/auth/register", authH.Register)
	v1.POST("/auth/login", authH.Login)

	// Authenticated (no store required)
	authed := v1.Group("", mw.Session(authSvc), mw.CSRF(d.Config.SessionSecret()))
	authed.POST("/auth/logout", authH.Logout)
	authed.GET("/me", storeH.Me)
	authed.POST("/stores", storeH.Create)

	// Tenant-scoped: store_id and role come only from verified membership.
	tenant := authed.Group("", mw.Tenant(storeSvc))
	// Catalog: everyone in the store can read (PRD §4.2).
	tenant.GET("/products", catalogH.ListProducts)
	tenant.GET("/products/:id", catalogH.GetProduct)
	tenant.GET("/categories", catalogH.ListCategories)
	tenant.GET("/inventory/movements", inventoryH.ListMovements)
	tenant.GET("/inventory/summary", inventoryH.Summary)
	// Sales: owner and staff both record and view transactions (PRD §4.2).
	tenant.POST("/sales", salesH.Checkout)
	tenant.GET("/sales", salesH.List)
	tenant.GET("/sales/:id", salesH.Get)
	// Dashboard & reports: owner and staff (PRD §4.2).
	tenant.GET("/dashboard/summary", reportsH.DashboardSummary)
	tenant.GET("/dashboard/sales-trend", reportsH.SalesTrend)
	tenant.GET("/dashboard/top-products", reportsH.TopProducts)
	tenant.GET("/reports/sales", reportsH.SalesReport)
	tenant.GET("/reports/sales/export", reportsH.ExportSales)
	// AI assistant: owner and staff; each conversation is private to its user.
	tenant.POST("/assistant/conversations", assistantH.CreateConversation)
	tenant.GET("/assistant/conversations", assistantH.ListConversations)
	tenant.GET("/assistant/conversations/:id", assistantH.GetConversation)
	tenant.POST("/assistant/conversations/:id/messages", assistantH.SendMessage)

	owner := tenant.Group("", mw.RequireRole(domain.RoleOwner))
	// Catalog writes: owner only (staff are read-only on the MVP).
	owner.POST("/products", catalogH.CreateProduct)
	owner.PATCH("/products/:id", catalogH.UpdateProduct)
	owner.POST("/products/:id/archive", catalogH.ArchiveProduct)
	owner.POST("/categories", catalogH.CreateCategory)
	owner.PATCH("/categories/:id", catalogH.RenameCategory)
	owner.POST("/categories/:id/archive", catalogH.ArchiveCategory)
	// Inventory writes: owner only on the MVP (PRD §4.2).
	owner.POST("/inventory/restocks", inventoryH.Restock)
	owner.POST("/inventory/adjustments", inventoryH.Adjust)
	owner.POST("/sales/:id/void", salesH.Void)

	owner.GET("/settings/store", storeH.GetSettings)
	owner.PATCH("/settings/store", storeH.UpdateSettings)
	owner.GET("/settings/team", storeH.ListTeam)
	owner.POST("/settings/team", storeH.AddStaff)

	return nil
}
