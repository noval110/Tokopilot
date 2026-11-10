package repositories

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
)

const storeColumns = `s.id, s.name, s.timezone, s.currency, s.address, s.created_at, s.updated_at`

func scanStore(row pgx.Row, extra ...any) (domain.Store, error) {
	var s domain.Store
	dest := append([]any{&s.ID, &s.Name, &s.Timezone, &s.Currency, &s.Address, &s.CreatedAt, &s.UpdatedAt}, extra...)
	err := row.Scan(dest...)
	return s, err
}

func CreateStore(ctx context.Context, q db.DBTX, name, timezone string, address *string, createdBy string) (domain.Store, error) {
	s, err := scanStore(q.QueryRow(ctx, `
		INSERT INTO stores AS s (name, timezone, address, created_by) VALUES ($1, $2, $3, $4)
		RETURNING `+storeColumns,
		name, timezone, address, createdBy))
	if err != nil {
		return domain.Store{}, fmt.Errorf("insert store: %w", err)
	}
	return s, nil
}

func AddMember(ctx context.Context, q db.DBTX, storeID, userID string, role domain.Role, createdBy string) error {
	_, err := q.Exec(ctx, `
		INSERT INTO store_members (store_id, user_id, role, created_by) VALUES ($1, $2, $3, $4)`,
		storeID, userID, string(role), createdBy)
	if db.IsUniqueViolation(err, "store_members_user_key") || db.IsUniqueViolation(err, "store_members_store_user_key") {
		return domain.ErrAlreadyMember
	}
	if err != nil {
		return fmt.Errorf("insert store member: %w", err)
	}
	return nil
}

// GetMembership resolves the user's single store membership (BR-02).
func GetMembership(ctx context.Context, q db.DBTX, userID string) (domain.Membership, error) {
	var role string
	s, err := scanStore(q.QueryRow(ctx, `
		SELECT `+storeColumns+`, m.role
		FROM store_members m JOIN stores s ON s.id = m.store_id
		WHERE m.user_id = $1`, userID), &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Membership{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Membership{}, fmt.Errorf("select membership: %w", err)
	}
	return domain.Membership{Store: s, Role: domain.Role(role)}, nil
}

// UpdateStore applies the given (already validated) values to the caller's store.
func UpdateStore(ctx context.Context, q db.DBTX, storeID, name, timezone string, address *string) (domain.Store, error) {
	s, err := scanStore(q.QueryRow(ctx, `
		UPDATE stores AS s SET name = $2, timezone = $3, address = $4, updated_at = now()
		WHERE s.id = $1
		RETURNING `+storeColumns,
		storeID, name, timezone, address))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Store{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Store{}, fmt.Errorf("update store: %w", err)
	}
	return s, nil
}

func ListMembers(ctx context.Context, q db.DBTX, storeID string, limit, offset int) ([]domain.Member, int, error) {
	var total int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM store_members WHERE store_id = $1`, storeID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count members: %w", err)
	}
	rows, err := q.Query(ctx, `
		SELECT u.id, u.name, u.email, m.role, m.created_at
		FROM store_members m JOIN users u ON u.id = m.user_id
		WHERE m.store_id = $1
		ORDER BY (m.role = 'OWNER') DESC, m.created_at, u.id
		LIMIT $2 OFFSET $3`, storeID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list members: %w", err)
	}
	members, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Member, error) {
		var m domain.Member
		var role string
		err := r.Scan(&m.UserID, &m.Name, &m.Email, &role, &m.JoinedAt)
		m.Role = domain.Role(role)
		return m, err
	})
	if err != nil {
		return nil, 0, fmt.Errorf("scan members: %w", err)
	}
	return members, total, nil
}
