# ADR-0003 — Password hashing

**Status:** Accepted (10 Nov 2026) — `backend/internal/auth/password.go`

## Keputusan

**argon2id** via `golang.org/x/crypto/argon2` dengan parameter awal OWASP: memory 19 MiB, iterations 2, parallelism 1, salt 16 byte, key 32 byte. Disimpan dalam format PHC string (`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`) sehingga parameter bisa dinaikkan tanpa migrasi; hash lama di-rehash saat login berhasil.

- Panjang password 8–128 karakter; tanpa aturan komposisi yang memaksa (sesuai NIST 800-63B).
- Perbandingan constant-time.
- Password tidak pernah di-log (termasuk di error validasi).

## Alternatif

bcrypt (batas 72 byte, tidak memory-hard) — bisa diterima tetapi argon2id lebih modern dan direkomendasikan OWASP.
