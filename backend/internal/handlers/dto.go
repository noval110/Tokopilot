package handlers

import (
	"time"

	"tokopilot/backend/internal/domain"
)

// Response DTOs. Never include password hashes or session tokens.

type userDTO struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type storeDTO struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Timezone string  `json:"timezone"`
	Currency string  `json:"currency"`
	Address  *string `json:"address"`
}

type membershipDTO struct {
	Role  domain.Role `json:"role"`
	Store storeDTO    `json:"store"`
}

type meDTO struct {
	User       userDTO        `json:"user"`
	Membership *membershipDTO `json:"membership"`
}

type memberDTO struct {
	UserID   string      `json:"user_id"`
	Name     string      `json:"name"`
	Email    string      `json:"email"`
	Role     domain.Role `json:"role"`
	JoinedAt time.Time   `json:"joined_at"`
}

func toUser(u domain.User) userDTO { return userDTO{ID: u.ID, Name: u.Name, Email: u.Email} }

func toStore(s domain.Store) storeDTO {
	return storeDTO{ID: s.ID, Name: s.Name, Timezone: s.Timezone, Currency: s.Currency, Address: s.Address}
}

func toMembership(m domain.Membership) *membershipDTO {
	return &membershipDTO{Role: m.Role, Store: toStore(m.Store)}
}

func toMember(m domain.Member) memberDTO {
	return memberDTO{UserID: m.UserID, Name: m.Name, Email: m.Email, Role: m.Role, JoinedAt: m.JoinedAt.UTC()}
}
