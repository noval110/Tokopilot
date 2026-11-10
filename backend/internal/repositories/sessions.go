package repositories

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
)

func CreateSession(ctx context.Context, q db.DBTX, userID string, tokenHash []byte, expiresAt, absoluteExpiresAt time.Time) (domain.Session, error) {
	s := domain.Session{UserID: userID}
	err := q.QueryRow(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at)
		VALUES ($1, $2, $3, $4)
		RETURNING id, expires_at, absolute_expires_at, last_seen_at`,
		userID, tokenHash, expiresAt, absoluteExpiresAt,
	).Scan(&s.ID, &s.ExpiresAt, &s.AbsoluteExpiresAt, &s.LastSeenAt)
	if err != nil {
		return domain.Session{}, fmt.Errorf("insert session: %w", err)
	}
	return s, nil
}

// GetActiveSession returns a non-revoked, non-expired session and its user.
func GetActiveSession(ctx context.Context, q db.DBTX, tokenHash []byte, now time.Time) (domain.Session, domain.User, error) {
	var s domain.Session
	var u domain.User
	err := q.QueryRow(ctx, `
		SELECT s.id, s.user_id, s.expires_at, s.absolute_expires_at, s.last_seen_at,
		       u.id, u.name, u.email, u.created_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1
		  AND s.revoked_at IS NULL
		  AND s.expires_at > $2
		  AND s.absolute_expires_at > $2`, tokenHash, now,
	).Scan(&s.ID, &s.UserID, &s.ExpiresAt, &s.AbsoluteExpiresAt, &s.LastSeenAt,
		&u.ID, &u.Name, &u.Email, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Session{}, domain.User{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Session{}, domain.User{}, fmt.Errorf("select session: %w", err)
	}
	return s, u, nil
}

// TouchSession slides the idle expiry forward, never past the absolute limit.
func TouchSession(ctx context.Context, q db.DBTX, sessionID string, expiresAt, now time.Time) error {
	_, err := q.Exec(ctx, `
		UPDATE sessions SET expires_at = LEAST($2, absolute_expires_at), last_seen_at = $3
		WHERE id = $1 AND revoked_at IS NULL`, sessionID, expiresAt, now)
	if err != nil {
		return fmt.Errorf("touch session: %w", err)
	}
	return nil
}

func RevokeSession(ctx context.Context, q db.DBTX, sessionID string, now time.Time) error {
	if _, err := q.Exec(ctx, `UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, sessionID, now); err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}
