package services

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/repositories"
)

type StoreService struct {
	pool *pgxpool.Pool
	hash func(string) (string, error)
}

func NewStoreService(pool *pgxpool.Pool, hash func(string) (string, error)) *StoreService {
	return &StoreService{pool: pool, hash: hash}
}

type CreateStoreInput struct {
	Name     string  `json:"name"`
	Address  *string `json:"address"`
	Timezone string  `json:"timezone"`
}

// Create makes the user's first store and their OWNER membership atomically (US-02).
func (s *StoreService) Create(ctx context.Context, userID string, in CreateStoreInput) (domain.Membership, error) {
	fe := apperr.FieldErrors{}
	name := validateName(fe, "name", in.Name, "Nama toko")
	address := validateAddress(fe, in.Address)
	tz := validateTimezone(fe, in.Timezone)
	if err := apperr.Validation(fe); err != nil {
		return domain.Membership{}, err
	}

	var store domain.Store
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		if store, err = repositories.CreateStore(ctx, tx, name, tz, address, userID); err != nil {
			return err
		}
		return repositories.AddMember(ctx, tx, store.ID, userID, domain.RoleOwner, userID)
	})
	if errors.Is(err, domain.ErrAlreadyMember) {
		return domain.Membership{}, apperr.Conflict("STORE_ALREADY_EXISTS", "Akun ini sudah terhubung dengan toko.")
	}
	if err != nil {
		return domain.Membership{}, err
	}
	return domain.Membership{Store: store, Role: domain.RoleOwner}, nil
}

// MembershipFor returns the verified membership, or domain.ErrNotFound.
func (s *StoreService) MembershipFor(ctx context.Context, userID string) (domain.Membership, error) {
	return repositories.GetMembership(ctx, s.pool, userID)
}

type UpdateStoreInput struct {
	Name     *string `json:"name"`
	Address  *string `json:"address"`
	Timezone *string `json:"timezone"`
}

// UpdateSettings patches the caller's own store. storeID comes from tenant
// context, never from the request.
func (s *StoreService) UpdateSettings(ctx context.Context, current domain.Store, in UpdateStoreInput) (domain.Store, error) {
	fe := apperr.FieldErrors{}
	name, tz, address := current.Name, current.Timezone, current.Address
	if in.Name != nil {
		name = validateName(fe, "name", *in.Name, "Nama toko")
	}
	if in.Timezone != nil {
		if *in.Timezone == "" {
			fe["timezone"] = "Zona waktu wajib dipilih."
		} else {
			tz = validateTimezone(fe, *in.Timezone)
		}
	}
	if in.Address != nil {
		address = validateAddress(fe, in.Address)
	}
	if err := apperr.Validation(fe); err != nil {
		return domain.Store{}, err
	}
	return repositories.UpdateStore(ctx, s.pool, current.ID, name, tz, address)
}

func (s *StoreService) ListMembers(ctx context.Context, storeID string, limit, offset int) ([]domain.Member, int, error) {
	return repositories.ListMembers(ctx, s.pool, storeID, limit, offset)
}

type AddStaffInput struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// AddStaff creates a STAFF account inside the owner's store (FR-STORE-04,
// minimal MVP flow without email invitations). The owner shares the initial
// password with the staff member out of band.
func (s *StoreService) AddStaff(ctx context.Context, ownerID, storeID string, in AddStaffInput) (domain.Member, error) {
	fe := apperr.FieldErrors{}
	name := validateName(fe, "name", in.Name, "Nama")
	email := validateEmail(fe, in.Email)
	validatePassword(fe, in.Password)
	if err := apperr.Validation(fe); err != nil {
		return domain.Member{}, err
	}
	hash, err := s.hash(in.Password)
	if err != nil {
		return domain.Member{}, err
	}

	var user domain.User
	err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		if user, err = repositories.CreateUser(ctx, tx, name, email, hash); err != nil {
			return err
		}
		return repositories.AddMember(ctx, tx, storeID, user.ID, domain.RoleStaff, ownerID)
	})
	if errors.Is(err, domain.ErrEmailTaken) {
		return domain.Member{}, emailTakenError()
	}
	if err != nil {
		return domain.Member{}, err
	}
	return domain.Member{UserID: user.ID, Name: user.Name, Email: user.Email, Role: domain.RoleStaff, JoinedAt: user.CreatedAt}, nil
}
