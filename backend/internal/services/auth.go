package services

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tokopilot/backend/internal/apperr"
	"tokopilot/backend/internal/auth"
	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
	"tokopilot/backend/internal/repositories"
)

// Session lifetimes (ADR-0002): sliding idle window inside an absolute cap.
const (
	SessionIdleTTL     = 7 * 24 * time.Hour
	SessionAbsoluteTTL = 30 * 24 * time.Hour
	// Avoid a write on every request: only slide when last_seen is older than this.
	sessionTouchEvery = 5 * time.Minute
)

var errInvalidCredentials = apperr.New(http.StatusUnauthorized, "INVALID_CREDENTIALS", "Email atau password salah.")

// IssuedSession is returned on login/register; Token goes only into the cookie.
type IssuedSession struct {
	Session domain.Session
	Token   string
}

// Principal is the authenticated caller for one request.
type Principal struct {
	SessionID string
	User      domain.User
}

type AuthService struct {
	pool      *pgxpool.Pool
	params    auth.Params
	now       func() time.Time
	dummyHash string
}

func NewAuthService(pool *pgxpool.Pool, params auth.Params, now func() time.Time) (*AuthService, error) {
	// Verifying against a dummy hash for unknown emails keeps login timing
	// similar whether or not the account exists (US-01: no enumeration).
	dummy, err := auth.HashPassword("tokopilot-dummy-password", params)
	if err != nil {
		return nil, err
	}
	return &AuthService{pool: pool, params: params, now: now, dummyHash: dummy}, nil
}

type RegisterInput struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Register creates the account and its first session in one transaction.
func (s *AuthService) Register(ctx context.Context, in RegisterInput) (domain.User, IssuedSession, error) {
	fe := apperr.FieldErrors{}
	name := validateName(fe, "name", in.Name, "Nama")
	email := validateEmail(fe, in.Email)
	validatePassword(fe, in.Password)
	if err := apperr.Validation(fe); err != nil {
		return domain.User{}, IssuedSession{}, err
	}

	hash, err := auth.HashPassword(in.Password, s.params)
	if err != nil {
		return domain.User{}, IssuedSession{}, err
	}

	var user domain.User
	var issued IssuedSession
	err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		if user, err = repositories.CreateUser(ctx, tx, name, email, hash); err != nil {
			return err
		}
		issued, err = s.issue(ctx, tx, user.ID)
		return err
	})
	if errors.Is(err, domain.ErrEmailTaken) {
		return domain.User{}, IssuedSession{}, emailTakenError()
	}
	return user, issued, err
}

func emailTakenError() error {
	return &apperr.Error{
		Status: http.StatusConflict, Code: "EMAIL_TAKEN", Message: "Email sudah terdaftar.",
		Details: map[string]any{"fields": map[string]string{"email": "Email sudah terdaftar. Silakan masuk."}},
	}
}

type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *AuthService) Login(ctx context.Context, in LoginInput) (domain.User, IssuedSession, error) {
	email := NormalizeEmail(in.Email)
	if email == "" || in.Password == "" || len(in.Password) > maxPasswordLen*4 {
		return domain.User{}, IssuedSession{}, errInvalidCredentials
	}

	user, hash, err := repositories.GetUserCredentials(ctx, s.pool, email)
	if errors.Is(err, domain.ErrNotFound) {
		_, _ = auth.VerifyPassword(in.Password, s.dummyHash, s.params)
		return domain.User{}, IssuedSession{}, errInvalidCredentials
	}
	if err != nil {
		return domain.User{}, IssuedSession{}, err
	}

	rehash, err := auth.VerifyPassword(in.Password, hash, s.params)
	if err != nil {
		return domain.User{}, IssuedSession{}, errInvalidCredentials
	}
	if rehash {
		if newHash, herr := auth.HashPassword(in.Password, s.params); herr == nil {
			// Best effort: a failed upgrade must not block a valid login.
			_ = repositories.UpdatePasswordHash(ctx, s.pool, user.ID, newHash)
		}
	}

	issued, err := s.issue(ctx, s.pool, user.ID)
	return user, issued, err
}

func (s *AuthService) issue(ctx context.Context, q db.DBTX, userID string) (IssuedSession, error) {
	token, hash, err := auth.NewSessionToken()
	if err != nil {
		return IssuedSession{}, err
	}
	now := s.now()
	sess, err := repositories.CreateSession(ctx, q, userID, hash, now.Add(SessionIdleTTL), now.Add(SessionAbsoluteTTL))
	if err != nil {
		return IssuedSession{}, err
	}
	return IssuedSession{Session: sess, Token: token}, nil
}

// Authenticate resolves a cookie token to a principal and slides its expiry.
func (s *AuthService) Authenticate(ctx context.Context, token string) (Principal, error) {
	if token == "" || len(token) > 128 {
		return Principal{}, apperr.Unauthenticated()
	}
	now := s.now()
	sess, user, err := repositories.GetActiveSession(ctx, s.pool, auth.HashToken(token), now)
	if errors.Is(err, domain.ErrNotFound) {
		return Principal{}, apperr.Unauthenticated()
	}
	if err != nil {
		return Principal{}, err
	}
	if now.Sub(sess.LastSeenAt) > sessionTouchEvery {
		if err := repositories.TouchSession(ctx, s.pool, sess.ID, now.Add(SessionIdleTTL), now); err != nil {
			return Principal{}, fmt.Errorf("slide session: %w", err)
		}
	}
	return Principal{SessionID: sess.ID, User: user}, nil
}

// Logout revokes the session server-side (FR-AUTH-06).
func (s *AuthService) Logout(ctx context.Context, sessionID string) error {
	return repositories.RevokeSession(ctx, s.pool, sessionID, s.now())
}

// HashPassword exposes the configured hasher to other services (staff creation).
func (s *AuthService) HashPassword(pw string) (string, error) { return auth.HashPassword(pw, s.params) }
