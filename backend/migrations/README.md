# Migrations

| Versi | File | Isi |
|---|---|---|
| 1 | `00001_auth_and_store.sql` | users, stores, store_members, sessions (Sprint 1) |
| 2 | `00002_catalog.sql` | categories, products, stock_movements append-only (Sprint 2) |
| 3 | `00003_inventory.sql` | reason_code + CHECK alasan, `seq` urutan ledger, created_at = clock_timestamp() (Sprint 3) |
| 4 | `00004_sales.sql` | sales, sale_items (snapshot), store_sale_counters, trigger imutabilitas (Sprint 4) |
| 5 | `00005_ai.sql` | ai_conversations (privat per toko+user), ai_messages (CHECK peran & allowlist nama tool, urutan `seq`, composite FK satu toko) (Sprint 6) |

File di folder ini di-embed ke binary (`embed.go`) dan dijalankan dengan `api migrate up|status|down`.

## Konvensi (ADR-0004, Accepted)

- Tool: [`pressly/goose`](https://github.com/pressly/goose) v3, file SQL murni, dijalankan sebagai **langkah deploy terpisah** (bukan otomatis saat startup replica).
- Nama file: `NNNNN_deskripsi_singkat.sql` berurutan, mis. `00001_auth_and_store.sql`.
- Setiap file punya `-- +goose Up` dan `-- +goose Down`. Down hanya untuk lokal/test; di production kita roll-forward.
- Migration **tidak pernah** mengubah file yang sudah ter-merge. Perubahan = file baru.
- Semua constraint bisnis (CHECK, UNIQUE, FK) ditulis di migration, bukan hanya di kode Go.
- Integration test menjalankan seluruh migration dari nol ke database test sekali per run.
