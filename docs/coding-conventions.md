# Coding Conventions

## Umum

- Satu sprint = beberapa perubahan kecil; tiap perubahan lulus format, lint, test, build.
- Komentar hanya untuk maksud yang tidak jelas atau **invariant keamanan/integritas**.
- Tidak ada secret di kode, test, fixture, log, atau screenshot. `.env` tidak di-commit.
- Fixture test sintetis dan deterministik (tanggal tetap, tanpa `now()` tersembunyi).

## Go (backend)

- `gofmt` + `go vet` wajib bersih. (golangci-lint ditambahkan bila tim setuju.)
- Layer: `handlers` (parse/validasi bentuk request, panggil service, map response) → `services` (aturan bisnis, transaksi) → `repositories` (SQL). Handler tidak menyentuh SQL; repository tidak berisi aturan bisnis.
- Setiap fungsi repository untuk data bisnis **menerima `storeID` sebagai parameter wajib** dan memakainya di `WHERE`. Tidak ada method "get by id" tanpa store.
- Error client memakai `httpx.AppError` (status, code, message Indonesia). Error lain dibungkus `fmt.Errorf("…: %w", err)` dan menjadi 500 generik.
- `context.Context` diteruskan ke semua I/O; panggilan eksternal punya timeout.
- Uang `int64` rupiah; quantity `decimal.Decimal` (ADR-0005). Dilarang `float64` untuk keduanya.
- Test: table-driven; integration test memakai Postgres sungguhan (Docker) dan berjalan dalam transaksi/DB terpisah.

## Python (AI service)

- `ruff check` + `ruff format` bersih; type hints di semua fungsi publik.
- Tidak ada dependency driver/ORM database (dijaga `tests/test_invariants.py`).
- Semua panggilan provider melalui interface adapter; timeout dan retry eksplisit.
- Output LLM selalu divalidasi dengan Pydantic sebelum diteruskan.

## TypeScript (frontend)

- `strict` + `noUncheckedIndexedAccess`; ESLint dengan `--max-warnings 0`.
- Struktur: `app/` (router, registry modul), `components/ui` (primitif desain), `features/<modul>/` (halaman + hook), `layouts/`, `lib/` (utilitas tanpa React).
- Data server lewat TanStack Query; tidak ada fetch langsung di komponen.
- Frontend **tidak menghitung angka otoritatif**. Total keranjang boleh ditampilkan sebagai pratinjau, tetapi angka final dari respons backend.
- Format angka hanya lewat `lib/format.ts` (`formatIDR`, `formatQuantity`).
- Hanya token warna dari `styles/index.css`; palet default Tailwind sengaja dimatikan.
- Setiap halaman data punya state loading, empty, error, success. Aksi destruktif wajib konfirmasi.
- Aksesibilitas: label pada setiap input, fokus terlihat, status = teks/ikon + warna.

## Git

- Branch `feat/<sprint>-<topik>`; commit kecil dengan pesan imperatif. Tidak ada commit ke `main` tanpa CI hijau.
