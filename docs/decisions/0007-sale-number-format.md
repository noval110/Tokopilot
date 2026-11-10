# ADR-0007 — Format nomor transaksi

**Status:** Accepted (10 Nov 2026) — diimplementasikan Sprint 4

`TP-YYYYMMDD-NNNN`, contoh `TP-20261110-0042`.

- Tanggal = hari bisnis dalam **zona waktu toko** (dihitung dari jam aplikasi saat checkout).
- Nomor urut per toko per hari dari `store_sale_counters (store_id, day, last_number)` menggunakan `INSERT … ON CONFLICT DO UPDATE … RETURNING` di dalam transaksi checkout (row lock mencegah nomor ganda).
- Unik `(store_id, sale_number)`; CHECK pola `^TP-[0-9]{8}-[0-9]{4,}$` — lebih dari 9999 transaksi/hari melebar ke 5 digit tanpa mengubah format.
- Transaksi yang di-rollback (mis. stok kurang) **tidak** memakai nomor; nomor transaksi yang di-void tetap terpakai.

## Metode pembayaran (diputuskan bersamaan)

`CASH` (Tunai), `TRANSFER`, `QRIS`, `OTHER` (Lainnya) — dicatat manual, tidak diproses (FR-SALE-04).
