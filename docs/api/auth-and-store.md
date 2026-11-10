# API — Auth, Store & Settings (Sprint 1)

Semua endpoint di bawah prefix `/api/v1`, JSON snake_case. Konvensi umum: [conventions.md](conventions.md).

## Cookie & CSRF

| Cookie | Isi | Flag |
|---|---|---|
| `tp_session` | token acak 256-bit (DB hanya menyimpan SHA-256-nya) | HttpOnly, SameSite=Lax, Path=/, Secure (kecuali dev/test), Max-Age = sisa masa absolut |
| `tp_csrf` | `HMAC(SESSION_SECRET, session_id)` | **bukan** HttpOnly (dibaca SPA), SameSite=Lax |

Setiap `POST`/`PATCH`/`DELETE` pada endpoint terautentikasi wajib header `X-CSRF-Token: <tp_csrf>` → tanpa itu **403 `CSRF_INVALID`**. Request mutasi dengan header `Origin` selain `FRONTEND_ORIGIN` → **403**.

Masa sesi: idle 7 hari (bergeser saat aktif), absolut 30 hari. Logout mencabut sesi di DB.

## Endpoint

| Method | Path | Akses | Body | Sukses |
|---|---|---|---|---|
| POST | `/auth/register` | Publik | `{name, email, password}` | 201 `Me` (membership `null`) + cookie |
| POST | `/auth/login` | Publik | `{email, password}` | 200 `Me` + cookie |
| POST | `/auth/logout` | Sesi + CSRF | — | 204, cookie dihapus |
| GET | `/me` | Sesi | — | 200 `Me` |
| POST | `/stores` | Sesi + CSRF, belum punya toko | `{name, address?, timezone?}` | 201 `Membership` (role OWNER) |
| GET | `/settings/store` | Owner | — | 200 `Store` |
| PATCH | `/settings/store` | Owner + CSRF | `{name?, address?, timezone?}` | 200 `Store` |
| GET | `/settings/team?page&per_page` | Owner | — | 200 `{data: Member[], meta}` |
| POST | `/settings/team` | Owner + CSRF | `{name, email, password}` | 201 `Member` (role STAFF) |

Field tak dikenal di body (mis. `store_id`, `role`) → **400**. `store_id` dan role selalu diambil dari membership server-side.

## Bentuk data

```json
// Me
{ "user": { "id": "uuid", "name": "Sari Wulandari", "email": "sari@warung.id" },
  "membership": { "role": "OWNER",
    "store": { "id": "uuid", "name": "Warung Bu Sari", "timezone": "Asia/Jakarta", "currency": "IDR", "address": null } } }

// Member
{ "user_id": "uuid", "name": "Andi Kasir", "email": "andi@warung.id", "role": "STAFF", "joined_at": "2026-11-10T02:00:00Z" }
```

## Validasi

| Field | Aturan |
|---|---|
| `name` (user/toko) | wajib, spasi dirapikan, 1–100 karakter |
| `email` | dinormalisasi (trim + lowercase), format alamat tunggal, domain bertitik, ≤ 254 |
| `password` | 8–128 karakter |
| `timezone` | `Asia/Jakarta` (default) · `Asia/Makassar` · `Asia/Jayapura` |
| `address` | opsional, ≤ 500; string kosong menghapus alamat |

## Error khusus

| Code | Status | Kapan |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | email tidak ada **atau** password salah (pesan identik, waktu respons disamakan) |
| `EMAIL_TAKEN` | 409 | registrasi/tambah staf dengan email terdaftar (case-insensitive); `details.fields.email` |
| `STORE_ALREADY_EXISTS` | 409 | user sudah punya membership (BR-02) |
| `STORE_REQUIRED` | 403 | endpoint tenant dipanggil sebelum onboarding |
| `FORBIDDEN` | 403 | staff memanggil endpoint owner |
| `CSRF_INVALID` | 403 | header CSRF hilang/salah |
| `RATE_LIMITED` | 429 | ≥ 5 login gagal / 15 menit per email+IP, atau ≥ 60 panggilan auth / 15 menit per IP; header `Retry-After` |

## Catatan MVP

- Tambah staf membuat akun langsung dengan password awal dari owner (tanpa undangan email — P1). Ganti password belum ada di P0.
- Rate limiter in-memory per proses (cukup untuk satu replica demo, ADR-0008).
