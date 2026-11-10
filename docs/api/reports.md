# API — Dashboard & Reports (Sprint 5)

Prefix `/api/v1`. Owner **dan** staff (PRD §4.2). Semua ter-scope ke toko dari membership server-side.

| Method | Path | Keterangan |
|---|---|---|
| GET | `/dashboard/summary?from&to` | KPI periode + stok saat ini (FR-DASH-01) |
| GET | `/dashboard/sales-trend?from&to` | Penjualan bersih harian, hari kosong = 0 (FR-DASH-02) |
| GET | `/dashboard/top-products?from&to&limit` | Produk terlaris, `limit` 1–20 (default 5) (FR-DASH-03) |
| GET | `/reports/sales?from&to` | Ringkasan + 10 terlaris + metode bayar + harian (FR-REP-01/02) |
| GET | `/reports/sales/export?from&to` | CSV transaksi (FR-REP-03) |

## Periode

- `from`, `to`: `YYYY-MM-DD`, **inklusif**, ditafsirkan dalam **zona waktu toko** (BR-13). Server mengubahnya menjadi `[from 00:00, to+1 00:00)` UTC.
- Default bila keduanya kosong: **7 hari terakhir termasuk hari ini** (zona toko). Hanya `from` → sampai hari ini; hanya `to` → 7 hari berakhir di `to`.
- `to ≥ from`, maksimal **366 hari** (ADR-0008); selain itu 400 dengan `details.fields`.
- Setiap respons membawa `period: {from, to, timezone, days, generated_at}` sehingga cakupan & waktu data selalu jelas (dipakai juga oleh AI di Sprint 6, FR-AI-06).

## Definisi angka (sumber kebenaran tunggal)

Semua agregat hanya menghitung sale berstatus **`COMPLETED`**. Sale `VOIDED` **tidak pernah** masuk total (BR-10); jumlah & nilainya dilaporkan terpisah sebagai `voided_count` / `voided_net_total`.

| Field | Definisi |
|---|---|
| `gross_sales` (Penjualan kotor) | Σ `subtotal` = Σ `line_subtotal` item; `line_subtotal = round_half_up(harga_jual_snapshot × qty)` |
| `discount_total` (Diskon) | Σ `discount_amount` (diskon tingkat transaksi) |
| `net_sales` (Penjualan bersih) | `gross_sales − discount_total` = Σ `net_total` |
| `transaction_count` | jumlah nota lunas |
| `avg_transaction_value` | `net_sales ÷ transaction_count`, dibulatkan half-up ke rupiah; 0 bila tidak ada transaksi |
| `cogs` (HPP) | Σ `round_half_up(cost_price_snapshot × qty)` per item — harga modal **saat transaksi**, bukan harga modal sekarang |
| `gross_profit` (Laba kotor, estimasi) | `net_sales − cogs` (BR-11). **Belum** memperhitungkan biaya operasional dan pajak; bukan laporan akuntansi/pajak resmi |
| Produk terlaris `revenue` | Σ `line_subtotal` produk tersebut — **sebelum** diskon transaksi (diskon tidak dialokasikan per produk). Urut: revenue ↓, qty ↓, nama, id (deterministik) |
| `daily[].net_sales` | `net_sales` per hari kalender di zona toko |
| `low_stock_count` / `out_of_stock_count` | kondisi stok **saat ini** (bukan per periode); habis juga terhitung stok rendah (BR-12) |

Margin kotor di UI = `gross_profit ÷ net_sales` (tampilan saja, 1 desimal).

## Contoh golden fixture (diuji otomatis)

| Nota | Waktu (WIB) | Isi | Status |
|---|---|---|---|
| S1 | 08 Nov 10.00 | kopi 2 × 68.000 + beras 1,5 kg × 12.333 (= 18.499,5 → 18.500), diskon 5.000, CASH | lunas |
| S2 | 08 Nov 23.50 | teh 3 × 5.000, QRIS | lunas |
| S3 | 09 Nov 00.10 | kopi 1, CASH — **hari 9** menurut WIB | lunas |
| S4 | 09 Nov 12.00 | gula 2, TRANSFER | **void** |
| S5 | 10 Nov 09.00 | beras 0,333 kg (4.106,889 → 4.107) + teh 1, diskon 107, QRIS | lunas |

Periode 7–10 Nov: kotor **246.607**, diskon **5.107**, bersih **241.500**, 4 transaksi, rata-rata **60.375**, HPP **186.330**, laba kotor **55.170**, void 1 (65.000). Harian: 7 Nov 0 · 8 Nov 164.500 (2) · 9 Nov 68.000 (1) · 10 Nov 9.000 (1). Terlaris: kopi 204.000 → beras 22.607 → teh 20.000 (gula dikecualikan karena void).

Test integrasi juga mencocokkan angka API dengan query SQL independen langsung ke tabel `sales` untuk beberapa rentang.

## CSV export

`GET /reports/sales/export?from&to` → `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="tokopilot-penjualan-<from>_<to>.csv"`.

- Diawali **UTF-8 BOM** (byte `EF BB BF`) agar Excel membaca huruf dengan benar.
- Kolom: `Nomor nota, Waktu (WIB), Kasir, Status, Pembayaran, Jumlah baris, Subtotal, Diskon, Total bersih, Alasan void`. Uang dalam rupiah bulat tanpa pemisah ribuan; waktu dalam zona toko.
- Berisi **semua** transaksi periode termasuk void (kolom Status). Jumlah `Total bersih` baris *Lunas* = `net_sales` laporan.
- Aman dari **CSV/formula injection**: sel yang diawali `= + - @` atau karakter kontrol diberi prefiks `'` (mis. alasan void `=SUM(...)` → `'=SUM(...)`).
- Pemisah koma (RFC 4180). Excel dengan locale Indonesia mungkin memakai `;` sebagai pemisah daftar — gunakan *Data → From Text/CSV* bila kolom tidak terpisah otomatis.
