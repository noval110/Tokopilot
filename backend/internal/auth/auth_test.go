package auth

import (
	"strings"
	"testing"
)

// Cheap parameters keep unit tests fast; production uses DefaultParams.
var testParams = Params{Memory: 1024, Iterations: 1, Parallelism: 1, SaltLen: 16, KeyLen: 32}

func TestHashAndVerify(t *testing.T) {
	h, err := HashPassword("rahasia-toko-123", testParams)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=1024,t=1,p=1$") {
		t.Fatalf("unexpected PHC format: %s", h)
	}
	if strings.Contains(h, "rahasia") {
		t.Fatal("hash must not contain the password")
	}
	if _, err := VerifyPassword("rahasia-toko-123", h, testParams); err != nil {
		t.Fatalf("correct password rejected: %v", err)
	}
	if _, err := VerifyPassword("rahasia-toko-124", h, testParams); err != ErrMismatch {
		t.Fatalf("wrong password: err = %v, want ErrMismatch", err)
	}
}

func TestSaltMakesHashesUnique(t *testing.T) {
	a, _ := HashPassword("sama", testParams)
	b, _ := HashPassword("sama", testParams)
	if a == b {
		t.Fatal("two hashes of the same password must differ (salt)")
	}
}

func TestNeedsRehashWhenParamsIncrease(t *testing.T) {
	h, _ := HashPassword("pw-12345678", testParams)
	stronger := testParams
	stronger.Memory *= 2
	rehash, err := VerifyPassword("pw-12345678", h, stronger)
	if err != nil || !rehash {
		t.Fatalf("rehash=%v err=%v, want rehash=true", rehash, err)
	}
	rehash, _ = VerifyPassword("pw-12345678", h, testParams)
	if rehash {
		t.Fatal("same params must not require rehash")
	}
}

func TestVerifyRejectsMalformedHash(t *testing.T) {
	for _, bad := range []string{"", "plain", "$2a$10$bcrypthash", "$argon2id$v=19$m=x$salt$key", "$argon2i$v=19$m=1,t=1,p=1$c2FsdA$a2V5"} {
		if _, err := VerifyPassword("x", bad, testParams); err == nil {
			t.Errorf("malformed hash %q accepted", bad)
		}
	}
}

func TestSessionTokenAndHash(t *testing.T) {
	tok, hash, err := NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) < 40 || len(hash) != 32 {
		t.Fatalf("token len %d, hash len %d", len(tok), len(hash))
	}
	if string(HashToken(tok)) != string(hash) {
		t.Fatal("HashToken must be deterministic")
	}
	tok2, _, _ := NewSessionToken()
	if tok == tok2 {
		t.Fatal("tokens must be random")
	}
}

func TestCSRFBoundToSessionAndSecret(t *testing.T) {
	secret := []byte(strings.Repeat("s", 32))
	tok := CSRFToken(secret, "session-a")
	if !ValidCSRF(secret, "session-a", tok) {
		t.Fatal("valid token rejected")
	}
	if ValidCSRF(secret, "session-b", tok) {
		t.Fatal("token from another session accepted")
	}
	if ValidCSRF([]byte(strings.Repeat("x", 32)), "session-a", tok) {
		t.Fatal("token under another secret accepted")
	}
	if ValidCSRF(secret, "session-a", "") {
		t.Fatal("empty token accepted")
	}
}
