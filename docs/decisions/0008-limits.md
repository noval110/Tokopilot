# ADR-0008 — Pagination, rentang laporan, rate limit

**Status:** Proposed — angka awal untuk demo, diukur ulang saat load test (PRD §20.2)

| Batas | Nilai awal | Alasan |
|---|---|---|
| `per_page` | default 20, maks 100 | BR-16 |
| Rentang laporan / tool AI | maks 366 hari | cukup untuk perbandingan tahunan, query tetap ringan |
| Login | 5 percobaan gagal / 15 menit per email+IP | brute force (NFR-05) |
| Pesan AI | 20 / jam / user, 200 / hari / toko | kendali biaya (PRD §19) |
| Tool call per giliran AI | maks 4 | PRD §13.4 |
| Timeout AI end-to-end | 30 detik (`AI_REQUEST_TIMEOUT_SECONDS`) | NFR-10 |
| Body request | 1 MiB | sudah aktif di Sprint 0 |
| Retensi percakapan AI | **perlu keputusan** sebelum rilis publik | NFR-06 |

Rate limit MVP disimpan in-memory per instance (cukup untuk satu replica demo); pindah ke Postgres/Redis bila di-scale horizontal.
