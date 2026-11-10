# API — Sales (Sprint 4)

Prefix `/api/v1`. Semua ter-scope ke toko dari membership server-side.

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| POST | `/sales` | Owner + staff, CSRF | Checkout (FR-SALE-01..07, FR-SALE-10) |
| GET | `/sales` | Owner + staff | Riwayat (FR-SALE-08) |
| GET | `/sales/{id}` | Owner + staff | Detail + item |
| POST | `/sales/{id}/void` | **Owner**, CSRF | Void dengan alasan (FR-SALE-09) |

## POST /sales

```json
{
  "idempotency_key": "6f1c2c1e-6d7b-4c1a-9a43-0d4b6b3f2a91",
  "items": [
    { "product_id": "uuid-kopi", "quantity": "2" },
    { "product_id": "uuid-beras", "quantity": "1.5" }
  ],
  "discount_amount": 5000,
  "payment_method": "QRIS",
  "notes": "Pelanggan tetap"
}
```

- **Tidak ada field harga.** Field asing (`unit_price`, `subtotal`, …) → 400. Harga & HPP dibaca dari baris produk yang dikunci.
- `idempotency_key`: 8–100 karakter `[A-Za-z0-9_-]`, dibuat klien **sekali per keranjang**.
- `items`: 1–100 baris, produk tidak boleh berulang; kuantitas > 0 dan ≤ `unit_scale` desimal produk.
- `discount_amount`: integer rupiah, `0 ≤ diskon ≤ subtotal`.
- `payment_method`: `CASH` (Tunai) · `TRANSFER` · `QRIS` · `OTHER` (Lainnya) — **hanya dicatat**, tidak diproses.

### Perhitungan (server)

```
line_subtotal = round_half_up(unit_price × quantity)   // big.Int, rupiah bulat (ADR-0005)
subtotal      = Σ line_subtotal
net_total     = subtotal − discount_amount             // CHECK di database
```

Contoh: 2 × 68.000 = 136.000; 1,5 kg × 12.333 = 18.499,5 → **18.500**; subtotal 154.500; diskon 5.000; net **149.500**.

### Respons

- **201** sale baru.
- **200** + header `Idempotent-Replayed: true` bila key + isi keranjang yang sama sudah tercatat (mengembalikan sale yang sama; stok tidak berkurang lagi).

```json
{
  "id": "uuid", "sale_number": "TP-20261110-0001", "status": "COMPLETED",
  "subtotal": 154500, "discount_amount": 5000, "net_total": 149500,
  "payment_method": "QRIS", "notes": "Pelanggan tetap",
  "cashier": { "id": "uuid", "name": "Sari Wulandari" },
  "sold_at": "2026-11-10T07:23:00Z", "item_count": 2, "void": null,
  "items": [
    { "line_no": 1, "product_id": "uuid", "product_name": "Kopi Arabica 250g", "sku": "KOP-250",
      "unit": "pcs", "unit_scale": 0, "quantity": "2.000", "unit_price": 68000, "line_subtotal": 136000 }
  ]
}
```

`items` berisi **snapshot** saat checkout: perubahan nama/harga/SKU/satuan produk setelahnya tidak mengubah nota. `cost_price_snapshot` disimpan untuk laporan laba, tidak dikirim di respons.

### Error

| Code | Status | Kapan |
|---|---|---|
| `INSUFFICIENT_STOCK` | 409 | Satu atau lebih item kurang stok. `details: {product_id, available, requested, items: [...]}` (semua item yang kurang). **Seluruh transaksi dibatalkan** — tidak ada sale, item, perubahan stok, mutasi, atau nomor nota yang terpakai |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Key sama dengan isi keranjang berbeda |
| `PRODUCT_ARCHIVED` | 409 | Produk diarsipkan; `details: {product_id, product_name}` |
| `NOT_FOUND` | 404 | Produk tidak ada / milik toko lain |
| `VALIDATION_ERROR` | 400 | `details.fields`: `idempotency_key`, `items`, `items.N.product_id`, `items.N.quantity`, `discount_amount`, `payment_method`, `notes` |

## POST /sales/{id}/void

`{ "reason": "Salah input jumlah" }` (3–500 karakter). Hanya sale `COMPLETED`.

- Stok setiap item dikembalikan dengan mutasi `SALE_VOID` (`reference_type = "SALE"`, `reference_id = id`) dalam transaksi yang sama — termasuk untuk produk yang kini diarsipkan.
- Sale tidak dihapus; status menjadi `VOIDED` dengan `void: {reason, by, at}`.
- Void kedua → **409 `ALREADY_VOIDED`** (diuji juga untuk 8 permintaan paralel: tepat satu berhasil, pembalikan stok satu kali).
- Laporan (Sprint 5) mengecualikan sale `VOIDED` (BR-10).

## GET /sales — query

| Param | Keterangan |
|---|---|
| `q` | potongan nomor nota (case-insensitive) |
| `status` | `COMPLETED` · `VOIDED` |
| `payment_method` | salah satu metode |
| `from`, `to` | `YYYY-MM-DD` inklusif, zona waktu toko, ≤ 366 hari |
| `page`, `per_page` | per_page ≤ 100 |

Urut `sold_at` terbaru dulu. Item tidak disertakan di list (`item_count` saja).

## Nomor nota (ADR-0007)

`TP-YYYYMMDD-NNNN`: tanggal hari bisnis di **zona waktu toko**, nomor urut per toko per hari dari `store_sale_counters` (di-increment di transaksi checkout — rollback tidak memakan nomor). Contoh batas hari: 23.50 WIB → `…-20261110-…`, 00.10 WIB → `…-20261111-0001`.

## Jaminan integritas

| Lapisan | Mekanisme |
|---|---|
| Duplikat (klik ganda/retry) | advisory lock per (toko, key) → cek key+hash → UNIQUE `(store_id, idempotency_key)` sebagai backstop |
| Overselling | `SELECT … FOR UPDATE` produk diurutkan `id` → cek stok semua item → `changeStock` per item → `CHECK (current_stock >= 0)` |
| Atomicity | sale, item, stok, mutasi, nomor nota dalam satu transaksi DB |
| Audit | trigger: sale tidak bisa dihapus; uang/nomor/metode tidak bisa diubah; hanya transisi `COMPLETED → VOIDED`; `sale_items` append-only |
| Konsistensi angka | CHECK `0 ≤ diskon ≤ subtotal`, `net_total = subtotal − diskon`, void lengkap ⇔ status VOIDED |
