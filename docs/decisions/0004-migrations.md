# ADR-0004 — Migration, akses database, versi PostgreSQL

**Status:** Accepted (10 Nov 2026) — pgx v5.12, goose v3.29; port lokal compose 54329

## Keputusan

- **PostgreSQL 17** (lokal via Docker; Neon untuk staging/demo).
- **Driver: `jackc/pgx/v5`** dengan `pgxpool`. Query SQL ditulis tangan di repository — eksplisit, mudah diaudit untuk `store_id` dan `FOR UPDATE`.
- **Migration: `pressly/goose` v3**, file SQL murni di `backend/migrations/`, di-embed ke binary dan dijalankan oleh perintah terpisah `api migrate up` sebagai langkah deploy (PRD §18.3) — bukan otomatis saat startup.
- UUID dibuat database dengan `gen_random_uuid()`.
- Email memakai ekstensi `citext` (unik case-insensitive).

## Alternatif

- `sqlc` (generate kode dari SQL): bagus, tetapi menambah tool build; bisa diadopsi nanti tanpa mengubah skema.
- `golang-migrate`: setara; goose dipilih karena dukungan Go-embedded dan file Up/Down dalam satu file.
- ORM (GORM, ent): ditolak — menyembunyikan locking dan scope tenant.
