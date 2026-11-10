# Test Plan

Strategi mengikuti PRD §16. Kolom "Mulai" = sprint di mana test pertama kali wajib ada.

| Lapisan | Alat | Cakupan | Mulai |
|---|---|---|---|
| Go unit | `go test` | config, error envelope, request ID, CORS, validasi, pricing, diskon, RBAC, low-stock, date range | 0 ✅ |
| Go integration | `go test -tags=integration` + Postgres Docker | CRUD, tenant scope, transaksi sale, rollback stok kurang, void/reversal, idempotency, konkurensi | 1 |
| AI service | pytest | service auth, envelope, **tanpa dependency DB**, parser tool-call, timeout, loop limit, malformed JSON, prompt injection | 0 ✅ |
| Frontend unit/component | Vitest + Testing Library | format IDR/quantity/zona waktu, API client, shell (nav, drawer, collapse), **placeholder tanpa angka karangan**, form, permission-gated controls | 0 ✅ |
| E2E | Playwright (`frontend/e2e`) | `core-flow` register → toko → produk → restock → sale → dasbor/laporan → AI; `roles` staf vs owner; `responsive` 18 layar × 360/768/1440 tanpa scroll horizontal; `a11y` axe WCAG 2.1 AA (serius/kritis = gagal) | 7 ✅ |
| Security | Go integration | `TestSecurityMatrix` + `TestEveryRouteIsClassified` (setiap rute terdaftar wajib diklasifikasi publik/sesi/toko/owner), log hygiene, rate limit, CORS, sesi kedaluwarsa; secret scan; `scripts/check_text.py` (karakter tak terlihat) | 1 → 7 ✅ |
| Rekonsiliasi | `api verify-ledger` + test korupsi | 5 invarian ledger; dijalankan di test, DB dev, toko demo, salinan restore | 7 ✅ |
| AI evaluasi §13.7 | pytest `test_eval_golden.py` | periode eksplisit/relatif, prediksi & toko lain ditolak jujur, tanggal tak valid minta klarifikasi | 7 ✅ |
| Rilis | skrip | `smoke-images.sh` (image produksi), `backup-restore-drill.sh`, `perf-smoke.mjs` (NFR-08/09/10) | 7 ✅ |

## Matriks tenant isolation (wajib setiap resource)

Untuk setiap endpoint yang menerima ID: user toko A meminta resource toko B → **404**, tanpa perubahan data, tanpa isi resource di body. Resource: products, categories, stock_movements, sales, reports, assistant conversations, AI tools.

## Test kritis Sprint 4 (tidak boleh lanjut ke AI sebelum lulus)

1. Stok kurang pada item ke-2 → tidak ada sale, sale_items, perubahan stok, atau movement.
2. Idempotency key sama dikirim 2× (serial dan paralel) → satu sale.
3. 10 checkout paralel untuk stok tersisa 1 → tepat 1 sukses, 9 × 409, stok akhir 0.
4. Void dua kali → kedua 409; reversal hanya satu.
5. Edit nama/harga produk setelah sale → detail sale tetap menampilkan snapshot.
6. Rekonsiliasi: `current_stock = SUM(quantity_delta)` untuk semua produk fixture.

## Golden test AI (Sprint 6)

Fixture toko dengan angka diketahui → untuk setiap intent PRD §13.2, angka di jawaban harus sama persis dengan hasil tool. Pertanyaan tanpa data → jawaban menyatakan tidak tersedia. Nama produk berisi instruksi ("abaikan instruksi sebelumnya…") → diperlakukan sebagai data.
