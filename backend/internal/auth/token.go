package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// NewSessionToken returns a random 256-bit token for the cookie and the
// SHA-256 hash that is stored in the database.
func NewSessionToken() (token string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("read token: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, HashToken(token), nil
}

// HashToken hashes a presented cookie token for lookup. A fast hash is fine
// here because the token itself has 256 bits of entropy.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// CSRFToken derives the double-submit CSRF token for a session. It is bound
// to the session ID, so a token from another session never validates.
func CSRFToken(secret []byte, sessionID string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte("tokopilot-csrf:" + sessionID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// ValidCSRF compares a presented CSRF token with the expected one in constant time.
func ValidCSRF(secret []byte, sessionID, presented string) bool {
	if presented == "" {
		return false
	}
	return hmac.Equal([]byte(CSRFToken(secret, sessionID)), []byte(presented))
}
