# API — Catalog (Sprint 2)

Prefix `/api/v1`. Semua endpoint ter-scope ke toko dari membership server-side; ID milik toko lain (atau UUID tidak valid) → **404**.

## Endpoint

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| GET | `/products` | Owner + staff | List/cari/filter, paginasi |
| GET | `/products/{id}` | Owner + staff | Detail |
| POST | `/products` | Owner + CSRF | Buat; `initial_stock` dicatat sebagai mutasi `INITIAL` |
| PATCH | `/products/{id}` | Owner + CSRF | Ubah sebagian; **tidak** bisa mengubah stok |
| POST | `/products/{id}/archive` | Owner + CSRF | Arsipkan (tidak pernah hard delete) |
| GET | `/categories?include_archived=true` | Owner + staff | Dengan `product_count` (produk aktif) |
| POST | `/categories` | Owner + CSRF | `{name}` |
| PATCH | `/categories/{id}` | Owner + CSRF | `{name}` |
| POST | `/categories/{id}/archive` | Owner + CSRF | 204; produk lama tetap menyimpan kategorinya |

## GET /products — query

| Param | Nilai | Default |
|---|---|---|
| `q` | cari di nama (case-insensitive) atau SKU; `%` dan `_` diperlakukan literal; ≤ 100 karakter | — |
| `category_id` | UUID | — |
| `stock_status` | `low` (stok ≤ minimum, termasuk habis — BR-12) · `out` (stok = 0) · `ok` (stok > minimum) | semua |
| `status` | `active` · `archived` · `all` | `active` |
| `sort` | `name` · `-updated_at` · `stock` (stok terendah dulu) | `name` |
| `page`, `per_page` | per_page 1–100 (BR-16) | 1, 20 |

Nilai di luar daftar → 400 `VALIDATION_ERROR` dengan `details.fields`.

## Body create / PATCH

```json
{
  "name": "Beras Pandan Wangi",
  "sku": "brs-01",            // opsional; disimpan UPPERCASE; "" menghapus (PATCH)
  "category_id": "uuid",      // opsional; "" menghapus (PATCH); harus kategori aktif toko ini
  "unit": "kg",
  "unit_scale": 3,            // 0–3 digit desimal untuk kuantitas produk ini (ADR-0005)
  "cost_price": 12333,        // integer rupiah 0..1.000.000.000.000
  "selling_price": 15000,
  "min_stock": "2.5",         // string atau angka JSON; maks. unit_scale desimal
  "initial_stock": "12.125"   // HANYA saat create
}
```

Field asing (mis. `current_stock`, `store_id`, atau `initial_stock` saat PATCH) → **400**.

## Response produk

```json
{
  "id": "uuid", "name": "Beras Pandan Wangi", "sku": "BRS-01",
  "category": { "id": "uuid", "name": "Sembako" },
  "unit": "kg", "unit_scale": 3,
  "cost_price": 12333, "selling_price": 15000,
  "current_stock": "12.125", "min_stock": "2.500",
  "stock_status": "OK",          // OK | LOW | OUT — diturunkan, tidak disimpan
  "is_active": true, "archived_at": null,
  "created_at": "2026-11-10T02:00:00Z", "updated_at": "2026-11-10T02:00:00Z"
}
```

Kuantitas selalu string NUMERIC dengan 3 desimal. Uang selalu integer.

## Error khusus

| Code | Status | Kapan |
|---|---|---|
| `DUPLICATE_SKU` | 409 | SKU sama (tanpa beda huruf besar/kecil) dengan produk **aktif** lain di toko yang sama; `details.fields.sku` |
| `DUPLICATE_CATEGORY` | 409 | Nama kategori aktif sudah ada (case-insensitive) |
| `PRODUCT_ARCHIVED` | 409 | PATCH pada produk arsip |
| `ALREADY_ARCHIVED` | 409 | Arsip dua kali |
| `VALIDATION_ERROR` | 400 | termasuk `unit_scale` yang tidak bisa diturunkan karena stok saat ini memakai desimal |

## Jaminan integritas (dicek database)

- Produk hanya bisa menunjuk kategori **toko yang sama** (composite FK `(category_id, store_id)`).
- `current_stock`, `min_stock` ≥ 0 dan tidak pernah punya desimal melebihi `unit_scale`.
- `stock_movements` append-only (trigger menolak UPDATE/DELETE/TRUNCATE), `stock_after = stock_before + quantity_delta`, tanda delta sesuai tipe, produk satu toko dengan mutasinya.
- Rekonsiliasi: `current_stock = SUM(quantity_delta)` untuk setiap produk (diuji di integration test).
