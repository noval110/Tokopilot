# TokoPilot

**Buku besar stok & penjualan untuk UMKM, dengan asisten AI yang hanya membaca data tokomu.**

> Status: **MVP siap rilis secara teknis (Sprint 7 — QA & Release selesai, 10 Nov 2026).** Semua modul P0 berjalan end-to-end dan lulus release gate lokal ([checklist](docs/operations/release-checklist.md)). **Belum di-deploy** — menunggu pilihan host, database terkelola, dan domain ([deployment](docs/operations/deployment.md)). Asisten AI memakai provider pengganti `scripted` sampai vendor LLM diputuskan (ADR-0006).

![Halaman awal TokoPilot dengan foto pedagang pasar](docs/screenshots/landing.png)

| Dasbor | Kasir |
|---|---|
| ![Dasbor 30 hari toko demo](docs/screenshots/dashboard.png) | ![Kasir dengan nota hidup](docs/screenshots/cashier.png) |
| **Asisten AI (baca-saja, dengan sumber data)** | **Laporan** |
| ![Asisten AI](docs/screenshots/assistant.png) | ![Laporan penjualan](docs/screenshots/reports.png) |

<sub>Semua screenshot dari toko demo **sintetis** (`api seed-demo`), bukan data pelanggan.</sub>

## Stack

| Bagian | Teknologi |
|---|---|
| Frontend | React 19 · TypeScript 6 · Vite 8 · Tailwind CSS 4 · React Router 8 · TanStack Query |
| Backend | Go 1.26 · Echo v5 · PostgreSQL 17 |
| AI service | Python 3.13 · FastAPI — tanpa akses database, by design |
| Lokal | Docker Compose |
| Target deploy | Vercel (frontend) · container (API & AI) · PostgreSQL terkelola |

## Mulai cepat

```powershell
Copy-Item .env.example .env
docker compose up -d postgres              # PostgreSQL di localhost:54329
./scripts/dev-stack.ps1                    # migrate + API :8080 + AI :8000 (scripted) + web :5173
```

**Akun demo lokal** (data sintetis 30 hari, owner + kasir) — pilih password sendiri:

```powershell
cd backend
$env:DATABASE_URL = 'postgresql://tokopilot:change-me-local-only@localhost:54329/tokopilot?sslmode=disable'
$env:DEMO_EMAIL = 'demo@tokopilot.app'; $env:DEMO_STAFF_EMAIL = 'kasir.demo@tokopilot.app'; $env:DEMO_PASSWORD = '<password-anda>'
go run ./cmd/api seed-demo
```

Panduan lengkap: [docs/local-development.md](docs/local-development.md).

## Perintah penting

| Perintah | Fungsi |
|---|---|
| `./scripts/check.ps1` / `./scripts/check.sh` | Semua lint, format, test (Go + integration Postgres, Python, frontend) dan build |
| `cd frontend; pnpm e2e` | Playwright: alur inti, peran, responsif 360/768/1440, aksesibilitas (stack harus jalan) |
| `go run ./cmd/api verify-ledger` | Rekonsiliasi ledger stok ↔ `current_stock` untuk semua toko (read-only) |
| `bash scripts/backup-restore-drill.sh` | Backup → restore → sidik jari identik → ledger lulus |
| `bash scripts/smoke-images.sh` | Uji image Docker rilis (mode produksi, non-root, tanpa kebocoran secret) |
| `node scripts/perf-smoke.mjs` | Latensi p95 terhadap target NFR (lokal) |

## Prinsip yang tidak ditawar

1. Backend adalah sumber kebenaran untuk auth, tenant, harga, stok, dan laporan.
2. Setiap perubahan stok adalah baris ledger yang tidak bisa diubah; void membuat pembalikan.
3. Checkout atomik dan idempotent — klik dua kali tetap satu nota.
4. AI hanya punya alat baca-saja yang dieksekusi dan diotorisasi Go API. Tidak ada SQL bebas, tidak ada mutasi.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [implementation-plan.md](docs/implementation-plan.md) | Audit, rencana per sprint, asumsi, risiko |
| [architecture/overview.md](docs/architecture/overview.md) | Diagram konteks, batas tanggung jawab, alur AI |
| [erd/initial-erd.md](docs/erd/initial-erd.md) | ERD awal dan constraint |
| [api/conventions.md](docs/api/conventions.md) | Konvensi REST, error, pagination, idempotency |
| [api/auth-and-store.md](docs/api/auth-and-store.md) | Kontrak auth, sesi/CSRF, toko, tim |
| [api/catalog.md](docs/api/catalog.md) | Kontrak produk, kategori, jaminan integritas stok |
| [api/inventory.md](docs/api/inventory.md) | Kontrak restock, penyesuaian, buku besar, jaminan konsistensi |
| [api/sales.md](docs/api/sales.md) | Kontrak checkout idempotent, nota, void, jaminan integritas |
| [api/reports.md](docs/api/reports.md) | Definisi angka dasbor/laporan, golden fixture, CSV |
| [api/assistant.md](docs/api/assistant.md) | Asisten AI: alur tool, jaminan keamanan, kode error, provider `scripted`, cara menambah vendor |
| [operations/release-checklist.md](docs/operations/release-checklist.md) | Release gate PRD §16.3/§18.3 dengan bukti per butir |
| [operations/deployment.md](docs/operations/deployment.md) | Keputusan deploy, env produksi, urutan rilis, Vercel, observabilitas |
| [operations/backup-restore.md](docs/operations/backup-restore.md) | Drill backup/restore dan hasil terakhir |
| [decisions/](docs/decisions/README.md) | ADR — termasuk keputusan yang menunggu konfirmasi |
| [design/ui-direction.md](docs/design/ui-direction.md) | Arah visual "Papan Warung": warna jalanan, huruf papan, animasi, foto |
| [coding-conventions.md](docs/coding-conventions.md) | Standar kode Go/Python/TS |
| [test-plan/](docs/test-plan/README.md) | Strategi dan test kritis |

## Struktur

```text
frontend/     aplikasi web
backend/      Go API (cmd/api, internal/*, migrations/)
ai-service/   orkestrasi LLM (FastAPI)
docs/         arsitektur, ERD, API, ADR, desain, test plan
scripts/      check.ps1 / check.sh
```
