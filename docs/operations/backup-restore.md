# Backup & restore drill

PRD §18.3: *"Backup dan uji restore sebelum menggunakan data nyata."* Backup yang belum pernah di-restore belum terbukti.

## Drill otomatis

```bash
docker build -t tokopilot-api:local backend     # butuh perintah verify-ledger
bash scripts/backup-restore-drill.sh            # default: DB compose lokal
SOURCE_URL='postgresql://…' bash scripts/backup-restore-drill.sh   # database lain yang dapat dijangkau Docker
```

Hanya butuh Docker (pg_dump/pg_restore dari image `postgres:17-alpine`). Langkahnya:

1. `pg_dump --format=custom` ke `backups/` (di-gitignore; dihapus setelah drill kecuali `KEEP_DUMP=1`).
2. Restore ke database sementara `tokopilot_restore_drill_<waktu>` di server yang sama.
3. **Sidik jari per tabel** — jumlah baris + md5 seluruh baris — harus identik antara sumber dan hasil restore.
4. `migrate status` (tidak ada migration tertunda) dan **`verify-ledger`** pada salinan hasil restore.
5. Database sementara di-drop (juga saat gagal).

Credential dibaca dari environment / `.env` dan tidak pernah dicetak.

## Hasil drill terakhir (lokal, 10 Nov 2026)

| Langkah | Hasil |
|---|---|
| Backup | 100 KB, 2 detik |
| Restore | 2 detik |
| Sidik jari | 13 tabel identik (users 55, stores 43, products 104, stock_movements 181, sales 45, ai_messages 51, …) |
| Migration | 5 applied, 0 pending |
| Ledger | rekonsiliasi lulus (104 produk, 181 mutasi, 45 penjualan) |
| Total | **PASS dalam 7 detik** |

## Produksi

- Andalkan backup otomatis / PITR penyedia database terkelola; drill di atas membuktikan dump logis juga dapat dipulihkan dan konsisten.
- Pada penyedia dengan fitur *branch* (mis. Neon): restore = buat branch dari titik waktu, jalankan `verify-ledger` + sidik jari terhadap branch, lalu arahkan `DATABASE_URL` bila dipilih.
- Jadwal: sebelum data nyata pertama, setelah migration besar, dan setiap kuartal. Catat hasilnya di tabel di atas.
- Dump berisi data pribadi pengguna: simpan terenkripsi, akses terbatas, retensi sesuai kebijakan (ADR-0008 — retensi perlu keputusan).
