// Package repositories contains SQL access. Every query on business data is
// scoped by a store_id passed in by the caller from verified membership.
package repositories

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
)

func CreateUser(ctx context.Context, q db.DBTX, name, email, passwordHash string) (domain.User, error) {
	var u domain.User
	err := q.QueryRow(ctx, `
		INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
		RETURNING id, name, email, created_at`,
		name, email, passwordHash,
	).Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt)
	if db.IsUniqueViolation(err, "users_email_key") {
		return domain.User{}, domain.ErrEmailTaken
	}
	if err != nil {
		return domain.User{}, fmt.Errorf("insert user: %w", err)
	}
	return u, nil
}

// GetUserCredentials returns the user and their password hash for login.
func GetUserCredentials(ctx context.Context, q db.DBTX, email string) (domain.User, string, error) {
	var u domain.User
	var hash string
	err := q.QueryRow(ctx, `
		SELECT id, name, email, created_at, password_hash FROM users WHERE email = $1`, email,
	).Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, "", domain.ErrNotFound
	}
	if err != nil {
		return domain.User{}, "", fmt.Errorf("select user credentials: %w", err)
	}
	return u, hash, nil
}

func UpdatePasswordHash(ctx context.Context, q db.DBTX, userID, hash string) error {
	if _, err := q.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, userID, hash); err != nil {
		return fmt.Errorf("update password hash: %w", err)
	}
	return nil
}
