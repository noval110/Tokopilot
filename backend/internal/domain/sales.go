package domain

import (
	"errors"
	"math/big"
	"strings"
	"time"
)

type SaleStatus string

const (
	SaleCompleted SaleStatus = "COMPLETED"
	SaleVoided    SaleStatus = "VOIDED"
)

var PaymentMethods = []string{"CASH", "TRANSFER", "QRIS", "OTHER"}

type SaleItem struct {
	LineNo       int
	ProductID    *string
	ProductName  string
	SKU          *string
	Unit         string
	UnitScale    int
	Quantity     string // canonical NUMERIC text
	UnitPrice    int64
	CostPrice    int64
	LineSubtotal int64
}

type Sale struct {
	ID             string
	SaleNumber     string
	Status         SaleStatus
	Subtotal       int64
	DiscountAmount int64
	NetTotal       int64
	PaymentMethod  string
	Notes          *string
	CashierID      string
	CashierName    string
	SoldAt         time.Time
	VoidReason     *string
	VoidedByID     *string
	VoidedByName   *string
	VoidedAt       *time.Time
	ItemCount      int
	Items          []SaleItem
}

var (
	ErrLineTooLarge            = errors.New("line subtotal exceeds supported range")
	ErrDuplicateIdempotencyKey = errors.New("idempotency key already used")
	ErrAlreadyVoided           = errors.New("sale already voided")
)

// maxLine caps a single line at Rp 10^15 so sums stay far inside int64/BIGINT.
var maxLine = new(big.Int).Exp(big.NewInt(10), big.NewInt(15), nil)

// LineSubtotal computes round_half_up(unitPrice × quantity) in whole rupiah
// (ADR-0005) with exact integer arithmetic. quantity is canonical NUMERIC
// text with 3 decimals, e.g. 1.5 kg × Rp 12.333 = 18.499,5 → Rp 18.500.
func LineSubtotal(unitPrice int64, quantity string) (int64, error) {
	whole, frac, _ := strings.Cut(quantity, ".")
	milli, ok := new(big.Int).SetString(whole+(frac + "000")[:3], 10)
	if !ok || milli.Sign() < 0 {
		return 0, ErrQuantityFormat
	}
	v := new(big.Int).Mul(big.NewInt(unitPrice), milli) // rupiah × 1000
	v.Add(v, big.NewInt(500))                           // half-up (values are non-negative)
	v.Quo(v, big.NewInt(1000))
	if v.Cmp(maxLine) > 0 {
		return 0, ErrLineTooLarge
	}
	return v.Int64(), nil
}
