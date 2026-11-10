# TokoPilot — Implementation Plan

Status: **Sprint 7 (QA & Release) selesai — 10 Nov 2026. MVP lulus release gate secara lokal; belum di-deploy.** Berikutnya: keputusan deploy (host container, database terkelola, domain) dan vendor LLM (ADR-0006) — lihat [operations/deployment.md](operations/deployment.md).

### Ringkasan Sprint 7

| Item | Bukti |
|---|---|
| Release gate | [operations/release-checklist.md](operations/release-checklist.md) — setiap butir PRD §16.3/§18.3 dengan bukti; satu-satunya yang tertunda: live demo (butuh keputusan deploy) |
| Security | matriks seluruh rute dari router (anonim 401 · tanpa CSRF 403 · staf 403 · toko lain 404 · referensi lintas toko di body 404 · tidak ada perubahan/bocor) + test yang gagal bila rute baru tidak diklasifikasi; log hygiene (password, token, cookie, email, query string); mutation test: void dipindah ke grup staf, rute tanpa klasifikasi, CSRF dicabut, query/cookie masuk log — semua tertangkap |
| Integritas | `api verify-ledger` (5 invarian) + test 6 jenis korupsi; lulus di DB dev, toko demo, dan hasil restore |
| E2E Playwright | core flow, peran, responsif 18 layar × 3 lebar, aksesibilitas axe — dipindah dari skrip CDP sementara ke repo (`pnpm e2e`) |
| Rilis | image produksi diuji (`smoke-images.sh` 15/15: menolak secret placeholder, non-root, tanpa driver DB di AI, alur penuh antar-container, log bersih); drill backup/restore (`backup-restore-drill.sh`: 13 tabel identik); `DB_MAX_CONNS`; build image di CI; `dev-stack.ps1`; `seed-demo` + screenshot README |
| Bug ditemukan & diperbaiki | (1) AI service produksi dengan token salah tetap start dan terlihat sehat → validasi saat start, pesan error tanpa nilai secret. (2) Asisten menjawab prediksi/“bulan depan”/toko lain dengan data hari ini dan mengabaikan tanggal eksplisit → ditolak jujur atau periode tepat (§13.7). (3) Kontras teks `subtle` 3,5–3,9:1 (gagal AA) → #666d7e (≥ 4,7:1). (4) `<dl>` berisi `<a>` di ringkasan inventaris (struktur tidak valid untuk pembaca layar). (5) Nama aksesibel tile kasir tidak memuat teks yang terlihat (WCAG 2.5.3). (6) Halaman nota tanpa `<h1>`. (7) Halaman restock melebar ke 419px pada layar 360px; pola grid yang sama diperbaiki di 7 tempat lain. (8) Label puncak grafik menabrak tombol “Lihat tabel” di mobile; label sumbu-x bertabrakan di 30 hari; angka utama dasbor terpecah dua baris. (9) Byte backspace mentah di regex (bukan `\b`) → `scripts/check_text.py` di check & CI |
| Test | Go 95 + 18 subtest · Python 83 · Frontend 106 · Playwright 6 (+1 screenshot opsional) · semua pemeriksaan `check.ps1` hijau |
| NFR (lokal) | p95 baca ≤ 15 ms, dasbor ≤ 12 ms, checkout 116 ms, AI scripted 22 ms; axe 0 pelanggaran serius — angka lokal, bukan load test produksi |

### Ringkasan Sprint 6

| Item | Bukti |
|---|---|
| Migration `00005_ai.sql` | ai_conversations (privat per toko+user), ai_messages (CHECK peran user/assistant/tool, CHECK allowlist 5 nama tool, urutan `seq`, composite FK satu toko) |
| API | [api/assistant.md](api/assistant.md) — percakapan (buat, daftar, detail), kirim pesan; loop tool diorkestrasi Go (maks 4 iterasi), giliran gagal tidak disimpan |
| Tool read-only | stok rendah, stok produk (cari per kata), ringkasan penjualan, terlaris, ringkasan toko + pembanding periode — memakai service laporan yang sama dengan dasbor (satu sumber kebenaran) |
| Keamanan | allowlist di Go + AI service + CHECK DB; argumen strict (store_id selundupan ditolak); konteks ke AI tanpa store_id/email/nama; hasil tool dibungkus `<data>` dengan `<`/`>` di-escape; jawaban dirender sebagai teks; galat vendor tidak bocor; rate limit 20/jam/user & 200/hari/toko dengan pesan per kuota |
| Provider | `LLM_PROVIDER=scripted` — pengganti deterministik tanpa vendor/kunci, lewat jalur tool yang sama; vendor sungguhan tetap terbuka (ADR-0006) |
| Frontend | `/assistant`: riwayat percakapan, saran pertanyaan, chip sumber (tool · periode · data per … WIB), lencana baca-saja, draf dipertahankan + "Coba kirim lagi" saat AI mati, Enter kirim / Shift+Enter baris baru; panel chat setinggi viewport di desktop & composer sticky di mobile; semua modul PRD kini punya layar nyata (placeholder dihapus) |
| Bug ditemukan & diperbaiki | (1) Filter URL produk/transaksi/buku besar: `setSearchParams(prev => …)` memakai `prev` dari render terakhir sehingga klik filter tepat setelah pencarian ter-debounce **menghapus `q`** (test flaky 1 dari 3) → hook `useSearchParamsPatch` + test deterministik. (2) `scripts/check.ps1` gagal di Windows PowerShell 5.1 saat output di-redirect (stderr pnpm jadi error fatal). (3) Chip sumber pecah jadi kolom sempit di 390px; composer hilang dari layar pada percakapan panjang |
| Test | Go 96 (90 test + 6 subtest; 8 integration asisten: golden loop 241.500, no-leak, allowlist/argumen selundupan, tenant, loop limit, 7 mode gagal, privasi, rate limit) · Python 55 · Frontend 106 (stabil 6× berturut) · E2E browser 89 cek (7 suite: auth 12, produk 12, inventaris 10, penjualan 14, laporan 16, asisten 19, AI mati 6) · mutation test: bypass allowlist, decode strict dicabut, store_id bocor ke konteks, allowlist AI service, write-ahead ref hook — semua tertangkap |

### Ringkasan Sprint 5

| Item | Bukti |
|---|---|
| Migration | tidak ada (memakai index `sales (store_id, sold_at)` yang sudah ada) |
| API | [api/reports.md](api/reports.md) — dashboard summary, sales-trend, top-products, laporan penjualan, CSV export |
| Definisi | gross, diskon, net, HPP (snapshot), laba kotor estimasi, rata-rata half-up — terdokumentasi dan diuji |
| Frontend | `/dashboard` (sapaan zona toko, satu hero figure, KPI berdefinisi, grafik tren aksesibel, terlaris, stok perlu perhatian, checklist toko kosong), `/reports` (laporan laba-rugi sederhana, metode bayar, harian, 10 terlaris, unduh CSV); filter periode di URL |
| Dataviz | warna bar divalidasi (`validate_palette.js`: emerald-600/700 lulus semua cek pada surface putih); spesifikasi mark, tooltip hover+keyboard, tabel alternatif; render diperiksa — 3 masalah layout diperbaiki (tooltip menutupi judul, garis ledger bentrok, label sumbu-x bertabrakan di mobile) |
| Test | Go 81 (6 baru: golden fixture, cross-check SQL independen, default periode, validasi, tenant/staff, CSV); mutation test void-exclusion & bucket zona waktu tertangkap · Frontend 99 · E2E browser 64 cek (5 suite) |

### Ringkasan Sprint 4

| Item | Bukti |
|---|---|
| Migration `00004_sales.sql` | sales (UNIQUE key per toko + hash payload, CHECK diskon/net/void), sale_items (snapshot, composite FK satu toko), store_sale_counters; trigger imutabilitas (hanya COMPLETED→VOIDED) |
| API | [api/sales.md](api/sales.md) — checkout idempotent, riwayat, detail, void owner |
| Keputusan | ADR-0007 Accepted: `TP-YYYYMMDD-NNNN` zona toko; metode Tunai/Transfer/QRIS/Lainnya |
| Frontend | `/sales/new` kasir (katalog + nota hidup, alur scanner SKU+Enter, pratinjau total identik server, kunci idempotensi per keranjang, keranjang tersimpan sessionStorage), `/sales` riwayat, `/sales/:id` nota + void + cetak |
| Test | Go 75 (14 baru) termasuk 10 checkout paralel stok terakhir, 10 submit ganda paralel, 8 void paralel — stabil ×10; mutation test (hash, advisory lock+fallback, jumlah void) tertangkap · Frontend 90 · E2E browser 48 cek (auth 12, produk 12, inventaris 10, penjualan 14) |

### Ringkasan Sprint 3

| Item | Bukti |
|---|---|
| Migration `00003_inventory.sql` | `reason_code` + CHECK alasan wajib (OTHER butuh catatan); kolom `seq` identity sebagai urutan ledger yang benar; `created_at` default `clock_timestamp()` |
| API | [api/inventory.md](api/inventory.md) — restock, penyesuaian, buku besar (filter tanggal zona toko), ringkasan |
| Inti | `changeStock`: satu jalur untuk semua mutasi stok (dipakai ulang Sprint 4 untuk sale/void) |
| Bug ditemukan & diperbaiki | Di bawah konkurensi, `now()` = waktu *mulai* transaksi → urutan ledger berdasarkan `created_at` tidak dapat dipercaya dan pencarian "mutasi terbaru" salah (500). Diganti `seq` + ambil mutasi berdasarkan ID |
| Frontend | `/inventory` (ringkasan nyata, tab perlu restock & buku besar), `/inventory/restock` & `/inventory/adjustments` (product picker combobox, pratinjau saldo eksak BigInt), riwayat stok di detail produk |
| Test | Go 61 test (11 baru) termasuk konkurensi 20 paralel ×10 putaran stabil; mutation test menunjukkan 3 lapis perlindungan · Frontend 71 · E2E browser 34 cek (auth 12, produk 12, inventaris 10) |

### Ringkasan Sprint 2

| Item | Bukti |
|---|---|
| Migration `00002_catalog.sql` | categories, products (composite FK satu toko, CHECK harga/stok/skala, SKU unik di produk aktif), **stock_movements** (append-only via trigger, CHECK aritmetika & arah delta) |
| API | [api/catalog.md](api/catalog.md) — list/cari/filter/sort/paginasi, CRUD + arsip produk dan kategori |
| Keputusan | ADR-0005 Accepted: `unit_scale` per produk, half-up rupiah, aritmetika kuantitas di PostgreSQL, stok awal = mutasi INITIAL |
| Frontend | `/products` (tabel desktop/kartu mobile, filter di URL, gauge stok), `/products/new` & `/products/:id` (form bersekat, pratinjau label rak, margin, kategori inline, konfirmasi arsip), dialog kelola kategori |
| Test | Go: 50 test (11 baru integration katalog); mutation test membuktikan test tenant & ledger gagal bila proteksi dicabut · Frontend: 61 test · E2E browser: 12 cek |

### Ringkasan Sprint 1

| Item | Bukti |
|---|---|
| Migration `00001_auth_and_store.sql` | users (citext unik, CHECK argon2id), stores (CHECK zona WIB/WITA/WIT, currency IDR), store_members (unik per user, index parsial satu owner), sessions (hash token) |
| API | lihat [api/auth-and-store.md](api/auth-and-store.md) |
| Keamanan | sesi DB + cookie httpOnly, CSRF HMAC terikat sesi, cek Origin, rate limit login, pesan login generik + dummy hash, JSON strict (field asing ditolak) |
| Frontend | `/login`, `/register`, `/onboarding/store` (pratinjau kop nota langsung), `/settings/store`, `/settings/team`, guard route, menu logout, navigasi sadar peran |
| Test | Go unit + 10 integration test PostgreSQL (tenant isolation, RBAC, revoke, expiry, CSRF, atomicity, constraint DB); mutation test membuktikan test RBAC & CSRF gagal bila proteksi dicabut; 47 test frontend; 12 cek E2E browser via Vite proxy |
Sumber kebenaran: `TokoPilot_PRD_v1.0` (10 Nov 2026). Dokumen ini memetakan PRD ke fase, modul, file, test, dependensi, asumsi, dan risiko.

---

## 1. Hasil audit repository (10 Nov 2026)

| Item | Temuan |
|---|---|
| Isi workspace `c:\tokopilotAI` | **Kosong** — tidak ada file, tidak ada kode lama |
| Git | Bukan repo → `git init -b main` dijalankan; **belum ada commit** |
| Risiko menimpa pekerjaan | Tidak ada |
| Go | 1.26.4 |
| Node / pnpm | 24.16.0 / 11.5.0 |
| Python | 3.13.14 (venv + pip; `uv` tidak terpasang) |
| Docker | CLI 29.5.3 terpasang, **daemon tidak berjalan** saat audit |
| PostgreSQL lokal / `psql` | Tidak ada → dipakai via Docker Compose |

### Versi dependency yang dipilih (dicek ke registry resmi saat audit)

| Komponen | Versi | Catatan |
|---|---|---|
| Echo | **v5.4.4** | v5 adalah rilis stabil saat ini; API dibaca langsung dari `go doc`, bukan dari ingatan. v4 masih ada (v4.16.3) tapi tidak dipilih untuk proyek baru. |
| React / React DOM | 19.3.1 | |
| Vite | 8.3.7 | bundler Rolldown |
| TypeScript | **6.0.3** | TS 7.0.2 sudah rilis, tetapi `typescript-eslint@8.72` mensyaratkan `<6.1`. Naik ke 7 setelah typescript-eslint mendukung. |
| Tailwind CSS | 4.3.5 | konfigurasi CSS-first `@theme` |
| React Router | 8.5.1 | |
| TanStack Query | 5.107.1 | |
| Vitest / Testing Library | 5.1.0 / 16.3.3 | |
| ESLint | 10.14.0 | flat config |
| FastAPI / Uvicorn / pydantic-settings | 0.162.x / 0.54.x / 2.16.x | |
| PostgreSQL (compose) | 17 | Neon mendukung 17; lihat ADR-0004 |

---

## 2. Struktur monorepo

```text
tokopilot/                     (c:\tokopilotAI)
├── frontend/                  React + TS + Vite + Tailwind v4
│   └── src/{app,components,features,layouts,lib,styles,test}/
├── backend/                   Go + Echo v5
│   ├── cmd/api/
│   ├── internal/{config,handlers,httpx,server}/   (+ domain, repositories, services, ai_tools mulai Sprint 1+)
│   └── migrations/
├── ai-service/                Python + FastAPI (tanpa akses DB)
│   ├── app/{api,core}/        (+ llm, orchestrator, schemas di Sprint 6)
│   └── tests/
├── docs/{architecture,erd,api,test-plan,decisions,design}/
├── scripts/                   check.ps1 / check.sh
├── .github/workflows/ci.yml
├── docker-compose.yml
├── .env.example
└── README.md
```

Perbedaan dari PRD §11.4: `internal/httpx` ditambahkan untuk plumbing HTTP (error envelope, request ID) agar tidak tercampur dengan handler; `frontend/src/styles` menampung design tokens. Folder `services/` dan `types/` di frontend dibuat saat pertama dibutuhkan (Sprint 1), bukan sekarang.

---

## 3. Status Sprint 0

| Deliverable PRD §17 | Status | Bukti |
|---|---|---|
| Monorepo | Done | struktur di atas |
| Design tokens / UI direction | Done | `frontend/src/styles/index.css`, `docs/design/ui-direction.md`, route dev `/design-system` |
| Architecture note | Done | `docs/architecture/overview.md` |
| ERD awal | Done | `docs/erd/initial-erd.md` |
| API conventions | Done | `docs/api/conventions.md` |
| Coding conventions | Done | `docs/coding-conventions.md` |
| Rencana migration | Done | `backend/migrations/README.md`, ADR-0004 |
| Local dev plan | Done | `docs/local-development.md`, `docker-compose.yml` |
| Skeleton FE/BE/AI dapat dijalankan | Done (FE/BE/AI lokal) · Not run (Docker) | lihat §8 |
| Keputusan utama terdokumentasi | Done, sebagian **menunggu konfirmasi** | `docs/decisions/` |

Yang sengaja **tidak** dikerjakan di Sprint 0: tabel database, auth, CRUD, logika bisnis apa pun.

---

## 4. Rencana per sprint

Urutan mengikuti PRD §17.1 dan tidak boleh dilompati. Setiap sprint selesai hanya jika exit criteria lulus dengan bukti command.

### Sprint 1 — Auth & Store
**Requirement:** FR-AUTH-01..06, FR-STORE-01..04, FR-SET-01..02, FR-OPS-01, US-01, US-02, NFR-02/03/05.

| Lapisan | File yang direncanakan |
|---|---|
| Migration | `backend/migrations/00001_auth_and_store.sql` — `users`, `stores`, `store_members`, `sessions` |
| Go domain/service | `internal/domain/{user,store}.go`, `internal/services/auth.go`, `internal/services/store.go`, `internal/auth/password.go` (argon2id) |
| Go repository | `internal/repositories/{users,stores,sessions}.go` (pgx v5) |
| Go middleware | `internal/middleware/{session,tenant,rbac,ratelimit}.go` — tenant context dari membership server-side |
| Go handler | `internal/handlers/{auth,me,stores,settings}.go` |
| Frontend | `features/auth/{LoginPage,RegisterPage}`, `features/onboarding/StoreSetupPage`, `features/settings/*`, `app/RequireSession.tsx`, `services/auth.ts` |
| Test | unit: hashing, validasi email, RBAC matrix · integration (Postgres test): register/login/logout, store+owner membership satu transaksi, user tanpa toko ditolak, **user A tidak bisa akses toko B**, login rate limit · FE: form validation, guard redirect |

**Exit:** register → login → onboarding → dashboard berjalan; tenant isolation test lulus; pesan login gagal generik.

### Sprint 2 — Products
**Requirement:** FR-PROD-01..05, BR-08, BR-16, BR-17, US-03.
Migration `00002_catalog.sql` (`categories`, `products` + CHECK harga ≥ 0, stok ≥ 0, partial unique SKU per toko). Service produk, repository dengan filter `store_id` wajib, endpoint list (search/filter/pagination), create/patch/archive (owner). Halaman list/form/detail. Test: SKU duplikat 409, harga negatif 400, staff tidak bisa create (403), product_id toko lain → 404, archive tidak menghapus.
Stok awal dibuat lewat movement `INITIAL` (bukan set langsung) agar ledger sejak hari pertama — lihat ADR-0005.

### Sprint 3 — Inventory
**Requirement:** FR-INV-01..06, BR-03..05, BR-12, US-04.
Migration `00003_stock_movements.sql` (ledger immutable: tanpa UPDATE/DELETE — dicegah dengan trigger + privilege). Service inventory: restock & adjustment dalam satu transaksi dengan `SELECT … FOR UPDATE`. Test: quantity ≤ 0 ditolak, adjustment keluar melebihi stok ditolak, update stok + insert movement atomik, **reconciliation**: `current_stock == SUM(quantity_delta)` untuk setiap produk fixture.

### Sprint 4 — Sales
**Requirement:** FR-SALE-01..10, BR-06/07/09/10, US-05, US-06.
Migration `00004_sales.sql` (`sales`, `sale_items`, `store_sale_counters`, unique `(store_id, idempotency_key)`). Checkout mengikuti PRD §10.2 persis: lock produk terurut `product_id`, harga dari DB, snapshot, diskon ≤ subtotal, movement per item, satu commit. Void owner-only dengan reversal. Test kritis: stok kurang → rollback total, idempotency key sama → sale yang sama (bukan duplikat), **checkout konkuren** pada stok terakhir (hanya satu sukses), void dua kali → 409, edit produk tidak mengubah histori.

### Sprint 5 — Dashboard & Reports
**Requirement:** FR-DASH-01..04, FR-REP-01..03, BR-10/11/13, US-07.
Query agregat dengan batas hari di timezone toko. Fixture dengan angka yang diketahui → test membandingkan API vs SQL sumber. Definisi gross/discount/net/gross profit ditulis di `docs/api/reports.md`. CSV export memakai filter yang sama. Chart memakai library ringan (diputuskan di sprint ini; kandidat: Recharts atau visx).

### Sprint 6 — AI Assistant
**Requirement:** FR-AI-01..09, BR-14/15, US-08, PRD §13.
Go: `internal/ai_tools/` registry 5 tool read-only, validasi schema argumen, batas 4 iterasi, rate limit, penyimpanan `ai_conversations`/`ai_messages`. FastAPI: adapter provider (+ adapter `fake` deterministik untuk test), prompt sistem §13.6, parser tool-call, timeout & retry terbatas. Test: golden numerical, tool selection, malformed JSON, prompt injection di nama produk, tenant isolation, provider down. **Blocker:** vendor/model LLM (ADR-0006).

### Sprint 7 — QA & Release
E2E (Playwright — akan ditambahkan di sprint ini), security review (IDOR, role escalation, secret scan), responsive 360/768/1440, Docker image, deploy Vercel + container + Neon, backup/restore drill, README/screenshots/demo account.

---

## 5. Asumsi (diambil secara konservatif, mohon koreksi bila salah)

1. JSON memakai **snake_case** (sesuai contoh PRD).
2. Quantity dikirim sebagai **string desimal** (`"2.000"`), harga sebagai **integer rupiah**.
3. Staff: read-only produk/stok, boleh membuat transaksi (baseline PRD §4.2).
4. Tidak ada pajak/PPN, tidak ada diskon per item, tidak ada multi-store di MVP.
5. Route aplikasi di Sprint 0 bisa dibuka tanpa login (skeleton); Sprint 1 menambahkan guard.
6. Demo publik hanya memakai dataset sintetis.
7. Font di-bundle lewat npm (`@fontsource`) — tidak memanggil Google Fonts saat runtime (privasi & offline).

## 6. Keputusan yang perlu konfirmasi

| ADR | Topik | Rekomendasi | Memblokir |
|---|---|---|---|
| 0002 | Strategi auth | Session opaque di DB + cookie httpOnly, same-origin via Vercel rewrite | Sprint 1 |
| 0003 | Password hashing | argon2id | Sprint 1 |
| 0004 | Migration & akses DB | goose + pgx v5, PostgreSQL 17 | Sprint 1 |
| 0005 | Representasi uang/qty | BIGINT rupiah, NUMERIC(14,3), `shopspring/decimal` di Go, presisi per unit | Sprint 2 |
| 0006 | Vendor/model LLM | **Belum diputuskan** — butuh evaluasi | Sprint 6 |
| 0007 | Format nomor transaksi | `TP-YYYYMMDD-NNNN` per toko per hari (timezone toko) | Sprint 4 |
| 0008 | Batas: pagination, rentang laporan, rate limit | 20/100 per halaman, 366 hari, 20 pesan AI/jam/user | Sprint 2–6 |

## 7. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Docker daemon tidak berjalan di mesin dev | Integration test Postgres tidak bisa jalan | Nyalakan Docker Desktop sebelum Sprint 1; alternatif: branch Neon khusus test (perlu persetujuan) |
| Echo v5 relatif baru | Contoh komunitas lebih sedikit | API diverifikasi via `go doc`; handler dijaga tipis |
| Cookie lintas domain (Vercel ↔ container) | Login gagal di Safari/ITP | Rewrite `/api/*` di Vercel → cookie first-party (ADR-0002) |
| Starlette mendepresiasi `httpx` untuk TestClient | Warning di pytest | Tetap `httpx` untuk saat ini; evaluasi migrasi di Sprint 6 |
| TS 7 belum didukung typescript-eslint | Tertahan di TS 6.0 | Pantau; upgrade terpisah |
| Scope creep dari desain | MVP molor | Design system sudah final untuk MVP; komponen baru hanya bila dibutuhkan fitur P0 |

## 8. Bukti verifikasi Sprint 0

Lihat ringkasan sesi; command dapat diulang dengan `scripts/check.ps1` (Windows) atau `scripts/check.sh`.
