# API — Inventory (Sprint 3)

Prefix `/api/v1`. Semua ter-scope ke toko dari membership server-side.

## Endpoint

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| POST | `/inventory/restocks` | Owner + CSRF | Barang masuk (FR-INV-01) |
| POST | `/inventory/adjustments` | Owner + CSRF | Koreksi masuk/keluar dengan alasan (FR-INV-02) |
| GET | `/inventory/movements` | Owner + staff | Buku besar, terbaru di atas (FR-INV-06) |
| GET | `/inventory/summary` | Owner + staff | `{active_products, low_stock, out_of_stock}` (produk aktif; habis juga dihitung stok rendah — BR-12) |

## Body

```json
// POST /inventory/restocks
{ "product_id": "uuid", "quantity": "20", "note": "Kiriman Supplier Pak Budi" }

// POST /inventory/adjustments
{ "product_id": "uuid", "direction": "OUT", "quantity": "3", "reason_code": "DAMAGED", "note": "Kemasan bocor" }
```

- `quantity` > 0, string atau angka JSON, desimal ≤ `unit_scale` produk.
- `direction`: `IN` | `OUT`.
- `reason_code`: `DAMAGED` (Rusak) · `LOST` (Hilang) · `EXPIRED` (Kedaluwarsa) · `COUNT_CORRECTION` (Salah hitung) · `OTHER` (Lainnya — **`note` wajib**).
- `note` opsional (≤ 500), kecuali untuk `OTHER`.

Respons 201: `{ "product": Product, "movement": Movement }`.

## Movement

```json
{
  "id": "uuid",
  "product": { "id": "uuid", "name": "Kopi Arabica 250g", "sku": "KOP-250", "unit": "pcs", "unit_scale": 0 },
  "type": "ADJUSTMENT_OUT",          // INITIAL | RESTOCK | ADJUSTMENT_IN | ADJUSTMENT_OUT | SALE | SALE_VOID
  "quantity_delta": "-3.000",        // bertanda
  "stock_before": "24.000",
  "stock_after": "21.000",
  "reason_code": "DAMAGED",
  "note": "Kemasan bocor",
  "actor": { "id": "uuid", "name": "Sari Wulandari" },
  "reference_type": null, "reference_id": null,   // diisi SALE pada Sprint 4
  "created_at": "2026-11-10T02:49:00Z"
}
```

## GET /inventory/movements — query

| Param | Keterangan |
|---|---|
| `product_id` | UUID |
| `type` | salah satu tipe mutasi |
| `from`, `to` | `YYYY-MM-DD`, **inklusif, ditafsirkan dalam zona waktu toko** (BR-13). `to ≥ from`, rentang ≤ 366 hari |
| `page`, `per_page` | per_page ≤ 100 |

Urutan = urutan tulis ledger yang sebenarnya (`seq`), terbaru dulu.

## Error

| Code | Status | Kapan |
|---|---|---|
| `INSUFFICIENT_STOCK` | 409 | Koreksi keluar melebihi stok. `details: {product_id, product_name, available, requested}`. **Tidak ada perubahan yang tersimpan** |
| `PRODUCT_ARCHIVED` | 409 | Stok produk arsip dibekukan |
| `VALIDATION_ERROR` | 400 | `details.fields` untuk `product_id`, `quantity`, `direction`, `reason_code`, `note`, `from`, `to` |
| `NOT_FOUND` | 404 | Produk toko lain / tidak ada |

## Jaminan konsistensi

Setiap perubahan stok melewati satu jalur (`changeStock`) dalam **satu transaksi**:

1. `SELECT … FOR UPDATE` pada baris produk (aktif).
2. Validasi kuantitas sesuai `unit_scale`; untuk keluar, pastikan `quantity ≤ current_stock`.
3. `UPDATE products SET current_stock = current_stock + delta … RETURNING before, after` — dihitung PostgreSQL NUMERIC.
4. `INSERT stock_movements` dengan before/after yang sama.

Lapisan pertahanan terhadap stok negatif, dari dalam ke luar: `CHECK (current_stock >= 0)` di database → pemetaan pelanggaran CHECK ke 409 → row lock + pemeriksaan awal. Diuji dengan 20 permintaan keluar paralel pada stok 10: tepat 10 berhasil, 10 mendapat 409, stok akhir 0, ledger tetap berantai (`stock_before` = `stock_after` baris sebelumnya).
