# Local Development

## Prasyarat

| Tool | Versi teruji |
|---|---|
| Go | 1.26.4 |
| Node.js / pnpm | 24.16 / 11.5 |
| Python | 3.13 |
| Docker Desktop | 29.x (untuk PostgreSQL) |

## Setup sekali

```powershell
Copy-Item .env.example .env            # lalu isi nilai lokal

# Frontend
cd frontend; pnpm install; cd ..

# AI service
cd ai-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
cd ..

# Backend
cd backend; go mod download; cd ..
```

## Cara cepat: satu perintah

```powershell
docker compose up -d postgres
./scripts/dev-stack.ps1            # Ctrl+C untuk berhenti, atau ./scripts/dev-stack.ps1 -Stop
```

Menjalankan migration, lalu API (:8080), AI service (:8000, `LLM_PROVIDER=scripted`) dan Vite (:5173). `AI_SERVICE_TOKEN` acak dibuat per run dan dibagikan ke kedua proses; log di `.dev/logs/`.

Data contoh: `go run ./cmd/api seed-demo` dengan `DEMO_EMAIL`, `DEMO_PASSWORD` (dan opsional `DEMO_STAFF_EMAIL`) — 12 produk, ±280 transaksi 30 hari, 2 void, restock, satu produk habis. Semua lewat service yang sama dengan aplikasi; menolak jalan dua kali dan menolak di produksi tanpa `DEMO_SEED_ALLOW_PRODUCTION=1`. Catatan: tanggal transaksi tersebar 30 hari, tetapi buku besar mencatat **waktu perekaman** (semua baris tertanggal saat seed dijalankan) — ledger memang tidak boleh di-backdate.

E2E: dengan stack berjalan, `cd frontend; pnpm e2e` (memakai Chrome terpasang). Screenshot README: `DEMO_EMAIL=… DEMO_PASSWORD=… pnpm e2e screenshots`.

## Menjalankan manual (tiga terminal)

PostgreSQL compose dipublikasikan di **`localhost:54329`** (bukan 5432) agar tidak bentrok dengan PostgreSQL lain yang sudah terpasang di mesin.

```powershell
# 1. Database (Docker Desktop harus berjalan)
docker compose up -d postgres

# 2. Go API → http://localhost:8080
cd backend
$env:DATABASE_URL = 'postgresql://tokopilot:change-me-local-only@localhost:54329/tokopilot?sslmode=disable'
go run ./cmd/api migrate up      # sekali, dan setiap ada migration baru
go run ./cmd/api

# 3. AI service → http://localhost:8000
#    Go API dan AI service harus memakai AI_SERVICE_TOKEN yang SAMA (env proses masing-masing).
#    Untuk mencoba asisten tanpa vendor: LLM_PROVIDER=scripted (lihat docs/api/assistant.md).
cd ai-service; $env:LLM_PROVIDER = 'scripted'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# 4. Frontend → http://localhost:5173  (proxy /api → :8080)
cd frontend; pnpm dev
```

Atau semua service backend dalam container: `docker compose up --build`.

Halaman berguna saat dev:
- `http://localhost:5173/` — landing
- `http://localhost:5173/dashboard` — kerangka aplikasi
- `http://localhost:5173/design-system` — referensi token & komponen (hanya dev)
- `http://localhost:8080/healthz`, `/readyz`

## Migration

```powershell
go run ./cmd/api migrate up       # terapkan yang belum
go run ./cmd/api migrate status   # lihat status
go run ./cmd/api migrate down     # mundur satu (lokal/test saja)
```

## Integration test (PostgreSQL sungguhan)

Test membuat database sementara `tp_test_<acak>`, menjalankan semua migration, lalu menghapusnya. Butuh koneksi admin:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://tokopilot:change-me-local-only@localhost:54329/postgres?sslmode=disable'
cd backend; go test ./...
```

Tanpa `TEST_DATABASE_URL`, integration test di-skip (unit test tetap jalan). `scripts/check.*` mengisinya otomatis bila port 54329 terbuka.

## Pemeriksaan sebelum commit

```powershell
./scripts/check.ps1      # Windows
./scripts/check.sh       # macOS/Linux/Git Bash
```

Menjalankan: gofmt, go vet, go test · ruff check/format, pytest · eslint, tsc, vitest, vite build.

## Environment variables

Lihat `.env.example`. Variabel dibaca oleh proses masing-masing; Go API **tidak** membaca file `.env` sendiri — gunakan shell, IDE run config, atau `docker compose` (`env_file`). Nilai placeholder (`replace-with-…`) ditolak saat `APP_ENV=staging|production`.
