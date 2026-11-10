package domain

import (
	"errors"
	"time"
)

type Category struct {
	ID         string
	Name       string
	ArchivedAt *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// StockStatus is derived, never stored. LOW follows BR-12 (current <= min);
// OUT is the stricter case current == 0 and is also counted as low stock.
type StockStatus string

const (
	StockOK  StockStatus = "OK"
	StockLow StockStatus = "LOW"
	StockOut StockStatus = "OUT"
)

type Product struct {
	ID           string
	Name         string
	SKU          *string
	CategoryID   *string
	CategoryName *string
	Unit         string
	UnitScale    int
	CostPrice    int64
	SellingPrice int64
	// Quantities are NUMERIC(14,3) rendered by PostgreSQL as text ("12.500")
	// so they never pass through floating point.
	CurrentStock string
	MinStock     string
	StockStatus  StockStatus
	IsActive     bool
	ArchivedAt   *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type MovementType string

const (
	MovementInitial       MovementType = "INITIAL"
	MovementRestock       MovementType = "RESTOCK"
	MovementAdjustmentIn  MovementType = "ADJUSTMENT_IN"
	MovementAdjustmentOut MovementType = "ADJUSTMENT_OUT"
	MovementSale          MovementType = "SALE"
	MovementSaleVoid      MovementType = "SALE_VOID"
)

// ReasonCode explains a manual adjustment (Sprint 3).
type ReasonCode string

const (
	ReasonDamaged         ReasonCode = "DAMAGED"
	ReasonLost            ReasonCode = "LOST"
	ReasonExpired         ReasonCode = "EXPIRED"
	ReasonCountCorrection ReasonCode = "COUNT_CORRECTION"
	ReasonOther           ReasonCode = "OTHER"
)

var ReasonCodes = []ReasonCode{ReasonDamaged, ReasonLost, ReasonExpired, ReasonCountCorrection, ReasonOther}

// StockMovement is one ledger row joined with product and actor for display.
type StockMovement struct {
	ID            string
	ProductID     string
	ProductName   string
	ProductSKU    *string
	ProductUnit   string
	UnitScale     int
	Type          MovementType
	QuantityDelta string
	StockBefore   string
	StockAfter    string
	ReasonCode    *ReasonCode
	Note          *string
	ActorID       string
	ActorName     string
	ReferenceType *string
	ReferenceID   *string
	CreatedAt     time.Time
}

var (
	ErrInsufficientStock = errors.New("insufficient stock")
	ErrStockOverflow     = errors.New("stock exceeds NUMERIC(14,3)")
	ErrDuplicateSKU      = errors.New("sku already used by an active product")
	ErrDuplicateCategory = errors.New("category name already used")
	ErrScaleConflict     = errors.New("stored quantities exceed the requested unit scale")
)
