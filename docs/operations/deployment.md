# Deployment — rencana dan runbook

> **Status: belum di-deploy.** Image, migration, dan konfigurasi sudah siap dan diuji lokal (lihat [release-checklist.md](release-checklist.md)). Deploy menunggu tiga keputusan pemilik produk (bagian 1).

## 1. Keputusan yang dibutuhkan sebelum deploy

| # | Keputusan | Opsi / rekomendasi | Mengapa penting |
|---|---|---|---|
| D1 | Host container untuk Go API + AI service | Layanan container apa pun yang mendukung image Docker, HTTPS, env secret, dan jaringan privat antar-service | AI service sebaiknya **tidak publik**; hanya Go API yang memanggilnya |
| D2 | PostgreSQL terkelola | Neon (sudah disebut di arsitektur) atau setara; PostgreSQL 17, region dekat pengguna (mis. Singapura) | Batas koneksi menentukan `DB_MAX_CONNS`; fitur PITR/branch dipakai untuk restore drill |
| D3 | Domain frontend + akun Vercel | mis. `app.<domain>`; API cukup di belakang rewrite Vercel | `FRONTEND_ORIGIN` harus https dan persis sama dengan domain ini |
| D4 | Vendor LLM (ADR-0006) | Tidak memblokir: rilis bisa dengan `LLM_PROVIDER=scripted` | Menentukan `LLM_API_KEY`, `LLM_MODEL`, dan biaya |

## 2. Topologi

```text
Browser ──https──▶ Vercel (frontend statis)
                    └─ rewrite /api/* ──https──▶ Go API container ──TLS──▶ PostgreSQL terkelola
                                                   └─ http privat + Bearer ──▶ AI service container (tanpa DB)
```

Cookie sesi tetap first-party karena browser hanya bicara dengan domain Vercel (ADR-0002).

## 3. Variabel lingkungan produksi

| Service | Variabel | Nilai |
|---|---|---|
| Go API | `APP_ENV` | `production` (validasi ketat: secret ≥ 32 karakter, origin https) |
| | `DATABASE_URL` | connection string terkelola dengan `sslmode=require` — **secret** |
| | `SESSION_SECRET` | 48+ karakter acak — **secret** |
| | `AI_SERVICE_TOKEN` | 48+ karakter acak, **sama** dengan AI service — **secret** |
| | `AI_SERVICE_URL` | URL privat AI service |
| | `FRONTEND_ORIGIN` | `https://app.<domain>` |
| | `DB_MAX_CONNS` | ≤ (limit koneksi DB ÷ jumlah replica API) − cadangan untuk migration |
| | `AI_REQUEST_TIMEOUT_SECONDS` | `30` |
| AI service | `APP_ENV`, `AI_SERVICE_TOKEN` | sama seperti di atas; service **menolak start** bila token kurang dari 32 karakter |
| | `LLM_PROVIDER` | `scripted` sampai ADR-0006 diputuskan |
| | `LLM_API_KEY`, `LLM_MODEL` | hanya bila vendor dipilih — **secret**, tidak pernah ke frontend |
| Frontend | — | tidak ada secret; API dipanggil same-origin `/api/v1` |

Membuat secret: `openssl rand -base64 48` (atau generator setara). Jangan pernah menaruhnya di repo, issue, atau chat.

## 4. Urutan deploy (setiap rilis)

1. **CI hijau** di commit yang dirilis (`.github/workflows/ci.yml`: Go + integration Postgres, Python, frontend, build image).
2. **Backup / snapshot** database (bagian 6).
3. **Migration sebagai langkah terpisah** (bukan saat replica start):
   `docker run --rm -e APP_ENV=production -e DATABASE_URL=… -e SESSION_SECRET=… -e AI_SERVICE_TOKEN=… -e FRONTEND_ORIGIN=… tokopilot-api migrate up`
4. **Deploy AI service**, tunggu `GET /healthz` = 200.
5. **Deploy Go API**, tunggu `GET /readyz` = 200 (memeriksa DB tanpa membocorkan detail).
6. **Verifikasi data**: `tokopilot-api verify-ledger` (read-only) harus `issues: []`.
7. **Deploy frontend** di Vercel dengan `vercel.json` (bagian 5).
8. **Smoke test**: login akun demo, buka dasbor, satu transaksi di toko uji, satu pertanyaan AI.

Rollback: image sebelumnya untuk API/AI/frontend. Migration bersifat roll-forward (ADR-0004); bila migration baru bermasalah, buat migration perbaikan — jangan `migrate down` di produksi.

## 5. Vercel

`frontend/vercel.json` dibuat saat host API (D1) sudah diketahui:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://<api-host>/api/:path*" },
    { "source": "/((?!assets/).*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
```

Build command `pnpm run build`, output `dist`, root `frontend/`.

## 6. Backup & restore

- Aktifkan backup otomatis / point-in-time recovery penyedia database.
- **Sebelum data nyata pertama**, dan setiap kuartal: jalankan drill — lihat [backup-restore.md](backup-restore.md).

## 7. Observabilitas minimum

| Sinyal | Sumber | Alert awal |
|---|---|---|
| Error rate 5xx | log JSON `http_request` (`status ≥ 500`) | > 1% selama 5 menit |
| Latensi | `duration_ms` di log akses | p95 > 700 ms (non-AI) / > 15 s (AI) |
| AI timeout / tidak tersedia | kode `AI_TIMEOUT`, `AI_UNAVAILABLE` di log | > 5 dalam 10 menit |
| DB pool | `readyz` gagal, error koneksi | `readyz` gagal 3× berturut |
| Integritas stok | `verify-ledger` terjadwal harian | issues > 0 |

Log tidak memuat password, token, cookie, email, atau query string (diuji: `TestLogsNeverContainSecretsOrPersonalData`, `scripts/smoke-images.sh`).

## 8. Rotasi credential internal

`AI_SERVICE_TOKEN`: set nilai baru di AI service dan Go API lalu restart keduanya berurutan (AI dulu). Jendela gagal singkat terlihat sebagai `AI_UNAVAILABLE`; fitur stok/penjualan tidak terdampak. `SESSION_SECRET`: rotasi membuat token CSRF lama tidak valid — pengguna perlu muat ulang halaman.
