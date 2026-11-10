// Package domain holds core business types shared across layers.
package domain

import (
	"errors"
	"time"
)

type Role string

const (
	RoleOwner Role = "OWNER"
	RoleStaff Role = "STAFF"
)

// StoreTimezones are the zones a store may use (WIB, WITA, WIT). The DB
// enforces the same list with a CHECK constraint.
var StoreTimezones = []string{"Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"}

const DefaultTimezone = "Asia/Jakarta"

type User struct {
	ID        string
	Name      string
	Email     string
	CreatedAt time.Time
}

type Store struct {
	ID        string
	Name      string
	Timezone  string
	Currency  string
	Address   *string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Membership is the verified link between the current user and their store.
// It is the only source of store_id and role for authorization.
type Membership struct {
	Store Store
	Role  Role
}

type Member struct {
	UserID   string
	Name     string
	Email    string
	Role     Role
	JoinedAt time.Time
}

type Session struct {
	ID                string
	UserID            string
	ExpiresAt         time.Time
	AbsoluteExpiresAt time.Time
	LastSeenAt        time.Time
}

// Sentinel errors from repositories; services translate them to apperr.
var (
	ErrNotFound      = errors.New("not found")
	ErrEmailTaken    = errors.New("email already registered")
	ErrAlreadyMember = errors.New("user already belongs to a store")
)
