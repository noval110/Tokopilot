package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/auth"
	"tokopilot/backend/internal/config"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/services"
)

// seedClock lets the real services record a 30-day history. Every write still goes
// through the same validation, pricing, idempotency and stock-ledger code as the app.
type seedClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *seedClock) Now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *seedClock) Set(t time.Time)     { c.mu.Lock(); c.t = t; c.mu.Unlock() }
func ptr[T any](v T) *T                  { return &v }
func num(v int64) *json.Number           { n := json.Number(fmt.Sprint(v)); return &n }
func qty(v string) domain.DecimalInput   { return domain.DecimalInput(v) }
func qtyp(v string) *domain.DecimalInput { d := domain.DecimalInput(v); return &d }

type demoProduct struct {
	key, name, sku, unit, category string
	scale                          int
	cost, price                    int64
	initial, min                   string
	weight                         int      // relative popularity
	qtys                           []string // typical quantities per line
}

var demoCatalog = []demoProduct{
	{"kopi", "Kopi Arabica Gayo 250g", "KOP-250", "pcs", "Minuman", 0, 52000, 68000, "30", "8", 5, []string{"1", "1", "2"}},
	{"teh", "Teh Melati 25 kantong", "TEH-25", "pcs", "Minuman", 0, 7000, 9500, "50", "15", 8, []string{"1", "2", "3"}},
	{"susu", "Susu UHT Cokelat 1L", "SUS-1L", "pcs", "Minuman", 0, 16500, 19900, "36", "10", 6, []string{"1", "2"}},
	{"air", "Air Mineral 600ml", "AIR-600", "botol", "Minuman", 0, 2500, 4000, "120", "30", 10, []string{"1", "2", "6"}},
	{"beras", "Beras Pandan Wangi", "BRS-01", "kg", "Sembako", 3, 11000, 13500, "80", "15", 7, []string{"1", "2.5", "5"}},
	{"minyak", "Minyak Goreng 2L", "MYK-2L", "pcs", "Sembako", 0, 32000, 38500, "24", "6", 5, []string{"1", "1", "2"}},
	{"gula", "Gula Pasir 1kg", "GLP-1", "pcs", "Sembako", 0, 15000, 17500, "40", "10", 6, []string{"1", "2"}},
	{"telur", "Telur Ayam", "TLR-KG", "kg", "Sembako", 3, 26000, 30000, "20", "5", 6, []string{"0.5", "1", "1.25"}},
	{"aren", "Gula Aren Cair 500ml", "GLA-500", "botol", "Bumbu", 0, 20000, 32500, "10", "6", 2, []string{"1"}},
	{"kecap", "Kecap Manis 520ml", "KCP-520", "botol", "Bumbu", 0, 18000, 23000, "18", "6", 3, []string{"1"}},
	{"keripik", "Keripik Singkong Pedas", "KRP-01", "pcs", "Camilan", 0, 8000, 12000, "30", "10", 5, []string{"1", "2", "3"}},
	{"sabun", "Sabun Cuci Piring 780ml", "SBN-780", "pcs", "Kebersihan", 0, 13000, 16500, "20", "5", 3, []string{"1"}},
}

// seedDemo: `api seed-demo` — one synthetic demo store (PRD §20.3: never real customer data).
// Credentials come from DEMO_EMAIL / DEMO_PASSWORD (and optional DEMO_STAFF_EMAIL); they are never printed.
func seedDemo(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, logger *slog.Logger) error {
	email, password := os.Getenv("DEMO_EMAIL"), os.Getenv("DEMO_PASSWORD")
	if email == "" || password == "" {
		return errors.New("set DEMO_EMAIL and DEMO_PASSWORD (the demo owner login)")
	}
	if cfg.IsProduction() && os.Getenv("DEMO_SEED_ALLOW_PRODUCTION") != "1" {
		return errors.New("refusing to seed demo data in staging/production without DEMO_SEED_ALLOW_PRODUCTION=1")
	}

	tz, _ := time.LoadLocation("Asia/Jakarta")
	end := time.Now().In(tz)
	day0 := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, tz).AddDate(0, 0, -29)
	clock := &seedClock{t: day0.Add(7 * time.Hour)}
	rng := rand.New(rand.NewPCG(20261110, 7)) // deterministic shape, any day

	authSvc, err := services.NewAuthService(pool, auth.DefaultParams, clock.Now)
	if err != nil {
		return err
	}
	user, _, err := authSvc.Register(ctx, services.RegisterInput{Name: "Sari Wulandari (Demo)", Email: email, Password: password})
	var ae *apperr.Error
	if errors.As(err, &ae) && ae.Code == "EMAIL_TAKEN" {
		return errors.New("demo account already exists; nothing changed (the ledger is append-only, use a fresh database to reseed)")
	}
	if err != nil {
		return fmt.Errorf("register demo owner: %w", err)
	}
	storeSvc := services.NewStoreService(pool, authSvc.HashPassword)
	m, err := storeSvc.Create(ctx, user.ID, services.CreateStoreInput{
		Name: "Warung Bu Sari (Demo)", Address: ptr("Jl. Melati No. 3, Bandung (data contoh)"), Timezone: "Asia/Jakarta",
	})
	if err != nil {
		return fmt.Errorf("create demo store: %w", err)
	}
	store := m.Store
	staffID := user.ID
	if staffEmail := os.Getenv("DEMO_STAFF_EMAIL"); staffEmail != "" {
		mem, err := storeSvc.AddStaff(ctx, user.ID, store.ID, services.AddStaffInput{Name: "Andi (Kasir Demo)", Email: staffEmail, Password: password})
		if err != nil {
			return fmt.Errorf("add demo staff: %w", err)
		}
		staffID = mem.UserID
	}

	catalog := services.NewCatalogService(pool, clock.Now)
	inventory := services.NewInventoryService(pool)
	sales := services.NewSalesService(pool, clock.Now)

	categories := map[string]string{}
	for _, p := range demoCatalog {
		if _, ok := categories[p.category]; !ok {
			c, err := catalog.CreateCategory(ctx, store.ID, user.ID, services.CategoryInput{Name: p.category})
			if err != nil {
				return fmt.Errorf("category %s: %w", p.category, err)
			}
			categories[p.category] = c.ID
		}
	}
	ids := map[string]string{}
	totalWeight := 0
	for _, p := range demoCatalog {
		in := services.CreateProductInput{
			ProductInput: services.ProductInput{
				Name: ptr(p.name), SKU: ptr(p.sku), CategoryID: ptr(categories[p.category]), Unit: ptr(p.unit),
				CostPrice: num(p.cost), SellingPrice: num(p.price), MinStock: qtyp(p.min),
			},
			InitialStock: qtyp(p.initial),
		}
		if p.scale > 0 {
			in.UnitScale = ptr(p.scale)
		}
		prod, err := catalog.CreateProduct(ctx, store.ID, user.ID, in)
		if err != nil {
			return fmt.Errorf("product %s: %w", p.sku, err)
		}
		ids[p.key] = prod.ID
		totalWeight += p.weight
	}
	pick := func() demoProduct {
		r := rng.IntN(totalWeight)
		for _, p := range demoCatalog {
			if r -= p.weight; r < 0 {
				return p
			}
		}
		return demoCatalog[0]
	}
	methods := []string{"CASH", "CASH", "CASH", "QRIS", "QRIS", "TRANSFER"}

	var saleCount, restocks int
	var saleIDs []string
	for d := 0; d < 30; d++ {
		date := day0.AddDate(0, 0, d)
		n := 5 + rng.IntN(6) // 5–10 receipts a day
		if wd := date.Weekday(); wd == time.Saturday || wd == time.Sunday {
			n += 4
		}
		for i := 0; i < n; i++ {
			at := date.Add(time.Duration(7*60+rng.IntN(14*60)) * time.Minute) // 07:00–21:00
			if at.After(end) {
				continue
			}
			lines := map[string]services.CheckoutItem{}
			var estimate float64 // rough subtotal, only to keep discounts realistic
			for l := 0; l < 1+rng.IntN(3); l++ {
				p := pick()
				q := p.qtys[rng.IntN(len(p.qtys))]
				if _, dup := lines[p.key]; !dup {
					var f float64
					_, _ = fmt.Sscan(q, &f)
					estimate += f * float64(p.price)
				}
				lines[p.key] = services.CheckoutItem{ProductID: ids[p.key], Quantity: qty(q)}
			}
			items := make([]services.CheckoutItem, 0, len(lines))
			for _, it := range lines {
				items = append(items, it)
			}
			var discount int64
			if rng.IntN(8) == 0 && estimate >= 50000 { // small round discounts on bigger baskets only
				discount = 1000 * int64(1+rng.IntN(5))
			}
			in := services.CheckoutInput{
				IdempotencyKey: fmt.Sprintf("demo-%s-%02d", date.Format("20060102"), i),
				Items:          items, DiscountAmount: num(discount), PaymentMethod: methods[rng.IntN(len(methods))],
			}
			actor := user.ID
			if rng.IntN(3) > 0 {
				actor = staffID
			}
			for attempt := 0; attempt < 2; attempt++ {
				clock.Set(at)
				sale, _, err := sales.Checkout(ctx, store, actor, in)
				if err == nil {
					saleCount++
					saleIDs = append(saleIDs, sale.ID)
					break
				}
				// Shelf ran out: the owner restocks (a real RESTOCK movement), then the sale goes through.
				if errors.As(err, &ae) && ae.Code == "INSUFFICIENT_STOCK" && attempt == 0 {
					for _, it := range items {
						if _, err := inventory.Restock(ctx, store.ID, user.ID, services.RestockInput{ProductID: it.ProductID, Quantity: qty("30"), Note: ptr("Kiriman supplier (data contoh)")}); err != nil {
							return fmt.Errorf("restock: %w", err)
						}
						restocks++
					}
					continue
				}
				if errors.As(err, &ae) {
					return fmt.Errorf("demo sale %s: %s %v", in.IdempotencyKey, ae.Code, ae.Details)
				}
				return fmt.Errorf("demo sale %s: %w", in.IdempotencyKey, err)
			}
		}
	}

	// Two corrections, as in a real week: voids reverse stock through the ledger.
	for _, idx := range []int{len(saleIDs) / 3, len(saleIDs) * 2 / 3} {
		if _, err := sales.Void(ctx, store.ID, user.ID, saleIDs[idx], services.VoidInput{Reason: "Salah input jumlah (data contoh)"}); err != nil {
			return fmt.Errorf("void: %w", err)
		}
	}
	// One product ends sold out so the dashboard shows every stock state.
	if p, err := catalog.GetProduct(ctx, store.ID, ids["kecap"]); err == nil && !domain.IsZeroQuantity(p.CurrentStock) {
		if _, err := inventory.Adjust(ctx, store.ID, user.ID, services.AdjustmentInput{
			ProductID: ids["kecap"], Direction: "OUT", Quantity: qty(p.CurrentStock), ReasonCode: "DAMAGED", Note: ptr("Botol pecah saat bongkar muat (data contoh)"),
		}); err != nil {
			return fmt.Errorf("adjust: %w", err)
		}
	}

	logger.Info("demo store seeded", slog.String("store_id", store.ID), slog.Int("products", len(demoCatalog)),
		slog.Int("sales", saleCount), slog.Int("voids", 2), slog.Int("restocks", restocks))
	return nil
}
