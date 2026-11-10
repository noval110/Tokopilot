# API Conventions

## Dasar

- Prefix: `/api/v1`. Health di luar prefix: `/healthz`, `/readyz` (plus `/api/v1/health` untuk cek via proxy frontend).
- JSON **snake_case** untuk request dan response.
- Uang: **integer rupiah** (`"discount_amount": 5000`). Tidak pernah float.
- Quantity: **string desimal** maks 3 digit pecahan (`"quantity": "2.500"`) agar tidak melewati floating point di JavaScript.
- Waktu: RFC 3339 UTC di API (`"sold_at": "2026-11-10T02:12:00Z"`); tanggal filter laporan `YYYY-MM-DD` ditafsirkan dalam timezone toko.
- ID: UUID.

## Autentikasi (ADR-0002, detail di [auth-and-store.md](auth-and-store.md))

Cookie `tp_session` (httpOnly, Secure, SameSite=Lax, Path=/). Request mutasi wajib menyertakan header `X-CSRF-Token` yang cocok dengan cookie `tp_csrf` (double-submit). Frontend memanggil API secara same-origin.

## Tenant scope

`store_id` **tidak pernah** diterima dari path/body/query. Server mengambilnya dari membership user yang login. Resource milik toko lain → **404** (bukan 403) agar keberadaannya tidak bocor.

## Status code

| Code | Kapan |
|---|---|
| 200 / 201 | Sukses / resource dibuat |
| 400 `VALIDATION_ERROR` | Input tidak valid; `details.fields` berisi error per kolom |
| 401 `UNAUTHENTICATED` | Tidak ada sesi / sesi kedaluwarsa |
| 403 `FORBIDDEN` | Role tidak cukup (mis. staff mengedit produk) |
| 404 `NOT_FOUND` | Tidak ada, atau milik toko lain |
| 409 `CONFLICT` / `INSUFFICIENT_STOCK` / `DUPLICATE_SKU` / `ALREADY_VOIDED` / `IDEMPOTENCY_KEY_REUSED` | Konflik state |
| 413 `PAYLOAD_TOO_LARGE` | Body > 1 MiB |
| 429 `RATE_LIMITED` | Login/AI rate limit; header `Retry-After` |
| 500 `INTERNAL_ERROR` | Pesan generik; detail hanya di log |
| 503 `SERVICE_UNAVAILABLE` / `AI_UNAVAILABLE` | Dependency down |

## Error envelope (sudah diimplementasikan Sprint 0)

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Stok produk tidak mencukupi.",
    "details": { "product_id": "…", "available": "1.000", "requested": "2.000" },
    "request_id": "req_6f1c…"
  }
}
```

`message` berbahasa Indonesia dan aman ditampilkan. Stack trace, error SQL, dan error provider tidak pernah dikirim.

## Validasi per kolom

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Periksa kembali isian formulir.",
  "details": { "fields": { "selling_price": "Harga jual tidak boleh negatif." } }, "request_id": "…" } }
```

## Pagination (BR-16)

`?page=1&per_page=20`, default 20, maksimum 100 (di atas itu → 400). Response:

```json
{ "data": [], "meta": { "page": 1, "per_page": 20, "total": 0 } }
```

Ledger mutasi yang bisa sangat panjang boleh memakai cursor (`?cursor=…`) — diputuskan di Sprint 3.

## Idempotency

`POST /sales` wajib `idempotency_key` (UUID dari client, dibuat sekali per checkout). Key sama + payload sama → 200 dengan sale yang sudah ada. Key sama + payload beda → 409 `IDEMPOTENCY_KEY_REUSED`.

## Tracing

Setiap response membawa `X-Request-Id`. Client boleh mengirim `X-Request-Id` sendiri (8–64 karakter `[A-Za-z0-9_-]`); selain itu server membuat yang baru.

## Header keamanan (sudah aktif)

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cache-Control: no-store` untuk `/api/*`. CORS hanya untuk `FRONTEND_ORIGIN`.
