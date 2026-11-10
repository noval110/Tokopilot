# Release checklist — MVP (Sprint 7, 10 Nov 2026)

Setiap butir dipetakan ke bukti yang bisa dijalankan ulang. ✅ = terverifikasi lokal · ⏳ = menunggu keputusan/akses (bukan bug) · ❌ = belum.

## PRD §16.3 Release gate

| Butir | Status | Bukti |
|---|---|---|
| Semua P0 flow selesai | ✅ | Semua modul PRD punya layar nyata (`MVP completeness` test); E2E `core-flow.spec.ts`: daftar → toko → produk → restock → kasir → dasbor/laporan → AI, angka dicocokkan ke API |
| Tidak ada bug blocker/critical yang diketahui | ✅ | Bug yang ditemukan Sprint 7 sudah diperbaiki dan diberi test (lihat implementation-plan, Ringkasan Sprint 7) |
| Tenant isolation & role tests lulus | ✅ | `TestSecurityMatrix` (tiap rute: anonim 401, tanpa CSRF 403, staf 403 di rute owner, toko lain 404 di setiap `:id`, referensi produk toko lain di body 404, tidak ada data berubah/bocor); `TestEveryRouteIsClassified` gagal bila ada rute baru tanpa klasifikasi; test per modul Sprint 1–6; E2E `roles.spec.ts` |
| Rekonsiliasi ledger ↔ current_stock | ✅ | `api verify-ledger` (5 invarian); `TestLedgerReconciliationAfterRealOperations` + 6 jenis korupsi terdeteksi; DB dev, toko demo, dan salinan hasil restore semuanya lulus |
| AI tanpa tool mutasi & lulus golden numerical | ✅ (provider `scripted`) | allowlist di Go + AI service + CHECK DB; golden 241.500 (`TestAssistantToolLoopUsesVerifiedStoreData`); evaluasi §13.7 `test_eval_golden.py` (periode eksplisit, prediksi, toko lain, tanggal tak valid). Golden set ulang wajib saat vendor dipilih (ADR-0006) |
| Env terdokumentasi; `.env` tidak ter-commit | ✅ | `.env.example` lengkap; `.env`, `backups/`, `.dev/`, output Playwright di-gitignore; secret scan bersih |
| README, kredensial demo, screenshot, live demo | ⏳ | README + `docs/screenshots/` (dari toko demo sintetis) + `api seed-demo` ✅ — **live demo belum** karena belum deploy (deployment.md §1) |

## PRD §18.3 Deployment checklist

| Butir | Status | Bukti / catatan |
|---|---|---|
| Frontend, API, AI, DB terpisah | ⏳ siap | Dua image (`backend/Dockerfile` distroless nonroot 24 MB, `ai-service/Dockerfile` uid 10001), build di CI; provisioning menunggu D1–D3 |
| CORS hanya domain frontend | ✅ | `FRONTEND_ORIGIN` wajib https di produksi (smoke test menolak http); `TestCORSOnlyAllowsConfiguredOrigin` |
| TLS + rotasi credential internal | ⏳ | TLS dari host; prosedur rotasi `AI_SERVICE_TOKEN` di deployment.md §8 |
| Migration sebagai langkah terkontrol | ✅ | `api migrate up` terpisah dari start replica (ADR-0004); image menjalankan `migrate status` di smoke test |
| Health/readiness tanpa bocor konfigurasi | ✅ | `/healthz`, `/readyz`; `TestReadinessReportsFailingDependencyWithoutDetails`; smoke test container |
| DB pool sesuai limit | ✅ | `DB_MAX_CONNS` (1–100, default 10) — baru di Sprint 7 |
| Log/metrics/alert | ⏳ | Log JSON terstruktur tanpa secret/PII (diuji); daftar alert awal di deployment.md §7, dipasang saat host dipilih |
| Backup & uji restore | ✅ lokal | `scripts/backup-restore-drill.sh`: dump → restore → sidik jari 13 tabel identik → migration & ledger lulus (backup-restore.md) |

## PRD §16.1 Testing wajib

| Area | Bukti |
|---|---|
| Frontend component | 106 test Vitest (form, tabel, kontrol berbasis peran, loading/error/empty) |
| Backend unit + integration | 95 test Go + 18 subtest, PostgreSQL asli: CRUD, tenant, checkout atomik, rollback stok kurang, void, idempotency, konkurensi |
| AI service | 83 test pytest: schema, parser tool-call, error provider, timeout, loop limit, JSON rusak, prompt injection, evaluasi §13.7, validasi konfigurasi saat start |
| E2E | Playwright: core flow, peran, responsif 18 layar × 3 lebar, aksesibilitas axe WCAG 2.1 AA |
| Security | matriks rute (IDOR, eskalasi peran, CSRF), rate limit, log hygiene, CORS, kedaluwarsa sesi, secret scan, karakter tak terlihat |

## NFR yang diukur

| NFR | Target | Hasil (lokal, `scripts/perf-smoke.mjs`, konkurensi 10) |
|---|---|---|
| NFR-08 API non-AI p95 | < 700 ms | baca ≤ 15 ms, checkout 116 ms |
| NFR-09 dasbor p95 | < 1,5 s | ≤ 12 ms (toko demo 30 hari, 279 transaksi) |
| NFR-10 AI p95 | < 15 s | 22 ms dengan provider `scripted` — **belum mewakili LLM sungguhan** |
| NFR-14 aksesibilitas | WCAG AA | 0 pelanggaran serius/kritis axe di 3 halaman publik + 14 layar aplikasi |

Angka performa adalah pengukuran lokal, bukan load test produksi; ulangi terhadap lingkungan staging setelah deploy.
