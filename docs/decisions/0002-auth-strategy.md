# ADR-0002 — Strategi autentikasi

**Status:** Accepted (10 Nov 2026) — diimplementasikan di Sprint 1

## Konteks

PRD §20.2 menunda pilihan antara access/refresh token dan secure cookie. PRD §12 melarang token sensitif di localStorage tanpa threat assessment. FR-AUTH-06 meminta logout benar-benar mencabut sesi. Target hosting: Vercel (frontend) + container (API) — domain berbeda.

## Opsi

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **A. Session opaque di DB + cookie httpOnly** (rekomendasi) | Logout/revoke instan; token tidak terbaca JS (tahan XSS exfiltration); sederhana | 1 query per request (murah, ter-index); butuh proteksi CSRF |
| B. JWT access (memori) + refresh cookie | Stateless untuk access token | Revoke tidak instan; lebih banyak bagian bergerak; refresh tetap butuh state |
| C. JWT di localStorage | Paling mudah | Rentan XSS exfiltration — ditolak oleh PRD |

## Rekomendasi: Opsi A

- Login membuat token acak 32 byte; DB menyimpan **SHA-256 hash**-nya di `sessions` (bocornya DB tidak membocorkan sesi aktif).
- Cookie `tp_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`; masa berlaku 7 hari, diperpanjang saat aktif (sliding), absolut 30 hari.
- CSRF: double-submit cookie `tp_csrf` (dapat dibaca JS) + header `X-CSRF-Token` pada POST/PATCH/DELETE; ditambah cek `Origin`.
- **Same-origin di produksi:** Vercel rewrite `/api/:path*` → `https://<api-host>/api/:path*`. Cookie menjadi first-party sehingga tidak terkena pemblokiran cookie pihak ketiga (Safari ITP, Chrome). Dev memakai proxy Vite yang setara (sudah dikonfigurasi).
- Rate limit login per IP + per email; pesan gagal generik (US-01).
- `JWT_SECRET` di `.env.example` diganti namanya menjadi `SESSION_SECRET` (dipakai untuk menandatangani token CSRF) bila opsi A disetujui.

## Implementasi (Sprint 1)

- `JWT_SECRET` diganti `SESSION_SECRET` (kunci HMAC token CSRF). Di development boleh kosong → dibuat acak per proses.
- CSRF token = `HMAC-SHA256(SESSION_SECRET, session_id)`; tidak disimpan di DB, terikat ke satu sesi.
- Sliding window hanya menulis ke DB bila `last_seen_at` lebih tua dari 5 menit.
- IP untuk rate limit diambil dari alamat TCP (`ExtractIPDirect`). Saat deploy di belakang proxy (Sprint 7), konfigurasikan rentang proxy tepercaya sebelum memakai `X-Forwarded-For`.
- Cookie `Secure` aktif untuk semua environment kecuali `development`/`test` (localhost via http).
