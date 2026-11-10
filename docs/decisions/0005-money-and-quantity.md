# ADR-0005 — Representasi uang dan quantity

**Status:** Accepted (10 Nov 2026) — diimplementasikan mulai Sprint 2

## Keputusan

| Hal | DB | Go | JSON | Frontend |
|---|---|---|---|---|
| Uang (IDR) | `BIGINT` rupiah, CHECK 0..10¹² | `int64` | number integer | `number` via `formatIDR`; input `RupiahField` hanya digit |
| Quantity | `NUMERIC(14,3)` | string tervalidasi (`domain.ParseQuantity`) | string `"2.500"` (input juga menerima angka JSON) | string via `formatQuantity`; input menerima koma Indonesia |

- **Presisi per produk:** kolom `products.unit_scale` (0–3). Contoh preset: pcs/botol/dus = 0, kg/liter = 3, meter = 2. Backend menolak kuantitas dengan desimal melebihi skala, dan CHECK DB `products_stock_scale` menjaga `current_stock`/`min_stock`. Menurunkan `unit_scale` ditolak bila stok saat ini memakai desimal.
- **Pembulatan rupiah (dipakai mulai Sprint 4):** `line_subtotal = round_half_up(unit_price × quantity)` ke rupiah terdekat, dihitung sekali di backend lalu disimpan. Contoh: 1,5 kg × Rp 12.333 = 18.499,5 → **Rp 18.500**.
- **Aritmetika kuantitas dilakukan di PostgreSQL NUMERIC** di dalam transaksi yang sama dengan row lock (`stock_after = current_stock + delta`), bukan di Go. Go hanya memvalidasi dan menormalkan string. Ini menghapus kebutuhan `shopspring/decimal` di Sprint 2–3; dievaluasi ulang di Sprint 4 bila perhitungan di Go diperlukan.
- **Stok awal = mutasi `INITIAL`.** Tabel `stock_movements` dibuat di Sprint 2 (lebih awal dari rencana) sehingga `current_stock = SUM(quantity_delta)` berlaku sejak produk pertama.
- Floating point hanya dipakai untuk visual (lebar bar gauge stok), tidak pernah untuk angka yang ditampilkan atau dikirim.
