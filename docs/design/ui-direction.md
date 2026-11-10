# UI Direction — "Papan Warung"

TokoPilot untuk pemilik warung dan toko kecil, jadi bahasa visualnya diambil dari **jalanan dagang Indonesia**: papan nama cat tangan, tenda terpal bergaris merah, rolling door yang dibuka pagi hari, LED running text, nota dan stempel LUNAS, label harga tulisan spidol, foto yang ditempel selotip. Ceria dan hidup, tetapi angkanya tetap rapi dan bisa dipercaya.

Riwayat: "Buku Besar Modern" (navy, kaku) → "Pasar Pagi" (pastel, ternyata masih generik) → **"Papan Warung"** (10 Nov 2026).

Referensi hidup: route dev `/design-system` dan `frontend/src/styles/index.css`.

## Yang dilarang (ciri "AI slop")

- Blob pastel, gradien radial lembut, glassmorphism / `backdrop-blur` sebagai dekorasi.
- Kartu tint pastel dengan ikon di dalam lingkaran; grid bento generik; chip pil di atas judul.
- "Tiga langkah" bernomor dengan garis putus-putus; band CTA bergradien dengan blob.
- Bayangan blur besar / glow. Kami memakai **bayangan cetak padat** berwarna tinta.
- Font geometris aman yang bisa dipakai produk apa pun.
- Testimoni atau angka karangan. Contoh angka hanya di mockup dan diberi keterangan "contoh tampilan".
- **Em dash (—) di teks yang dibaca pengguna.** Tulis kalimat biasa: titik, koma, atau titik dua. Rentang tanggal memakai "s.d." ("28 Okt s.d. 3 Nov 2026"); rentang rapat seperti "4–10 Nov" dan "1–20 dari 45" tetap boleh. Nilai kosong ditulis dengan kata ("Tanpa SKU", "Tanpa kategori", "Tanpa catatan"), bukan tanda strip. Dijaga otomatis oleh `scripts/check_text.py`.

## Warna (nama token berbahasa Indonesia)

| Token | Nilai | Peran |
|---|---|---|
| `paper-*` | #FFF8EC krem kertas | latar, dengan tekstur grain halus (`--grain`) |
| `ink-*` | #1D1712 tinta hangat | teks, garis tepi 2px, bayangan cetak |
| `daun-*` | #0F663E hijau daun pisang | aksi utama (putih 7,0:1), status positif |
| `kunyit-*` | #FFC629 kuning kunyit | papan nama, sorotan, kartu angka utama (tinta 11,3:1) |
| `cabe-*` | #D7261E merah cabai | tenda terpal, papan BUKA, stempel (putih 5,0:1). **Bukan warna error** |
| `terpal-*`, `jambu-*` | biru terpal, merah jambu | variasi papan & dekorasi |
| `warn-*`, `danger-*` | oranye, merah tua | hanya stok rendah dan error/hapus |
| `text-muted` / `text-subtle` | #5A4D40 / #6B5D4E | ≥ 5,0:1 di semua permukaan kertas |

Palet bawaan Tailwind dimatikan. Kontras diverifikasi otomatis oleh audit axe (`e2e/a11y.spec.ts`, 17 layar). Garis tepi input memakai tinta 55% (3,9:1, di atas batas WCAG 3:1 untuk komponen).

## Tipografi

| Peran | Font | Pemakaian |
|---|---|---|
| Papan | **Shrikhand** (`font-sign`) | `h1` semua halaman, judul seksi halaman awal, logo. Huruf tebal miring bergaya papan cat tangan |
| Teks & UI | **Schibsted Grotesk** (`font-display`/`font-sans`) | judul kartu, label, tombol, paragraf |
| Spidol | **Permanent Marker** (`.scribble`) | coretan, label harga, kicker — hemat |
| LED | **Doto** (`.led-text`) | papan running text |
| Angka | Schibsted, lining proporsional (`.num`) | rupiah & kuantitas. *Tabular* sengaja tidak dipakai: di font ini titik/koma ikut melebar ("Rp 14 . 555") |

## Bentuk

- `.sign`: warna datar + garis tinta 2px + bayangan padat 6px. `.sign-sm` versi kecil.
- Sudut 4–22px, **tidak ada bentuk pil**. Papan boleh miring sedikit (`.tilted` + `--tilt`, setengahnya di layar < 768px).
- Tombol solid = papan: bayangan 3px, naik saat hover, **masuk ke bayangannya saat diklik** (`.press`).
- `.awning` (tenda bergerigi), `.tape` (selotip), `.painted` (bayangan cat pada huruf), `.stamp` (stempel garis ganda), `.led-board`.

## Hero halaman awal

Foto lapak pasar sungguhan (renceng jajanan tergantung, keranjang sayur) menjadi **latar penuh** hero, dengan tekstur halftone seperti poster pasar cetak. Judul tidak ditaruh langsung di atas foto: ia ada di **papan kunyit yang tergantung dari tenda terpal** dengan dua tali, sehingga kontras teks selalu terjamin tanpa menggelapkan foto. Di sisi kanan, elemen dekoratif `aria-hidden` mengisi lapak: neon "Buka", tiga label harga karton yang berayun dengan periode berbeda, nota yang tercetak lalu dicap, dan secarik catatan spidol. Di ponsel, foto tetap terlihat sebagai "jendela" di atas papan.

## Gerak

| Animasi | Di mana | Arti |
|---|---|---|
| Rolling door terangkat | halaman awal, sekali per sesi | "toko buka" |
| Tenda turun, judul naik | halaman awal, login | pembukaan |
| Nota tercetak baris demi baris → stempel dibanting | hero, bon pendaftaran | transaksi selesai |
| Label harga & papan BUKA berayun | hero, dasbor, CTA | hidup, tidak statis |
| Coretan spidol tergambar sendiri | judul | sentuhan tangan |
| Digit odometer menggulung | angka KPI dasbor | seperti roda timbangan |
| Batang grafik tumbuh | grafik harian | data masuk |
| LED running text | halaman awal | papan depan toko |
| Ken Burns (zoom pelan) pada foto latar | hero halaman awal | suasana pasar yang hidup |
| Neon berkedip | papan "Buka" di hero | lampu toko menyala |
| Parallax kursor (`.depth-1/2/3`, `usePointerParallax`) | elemen hero | label, nota, dan papan bergerak dengan kedalaman berbeda; hanya untuk pointer halus |

Aturan: stempel **tidak pernah menutupi angka** (selalu ada ruang kosong di nota); animasi di dalam seksi menunggu sampai seksi terlihat; semua animasi dekoratif `aria-hidden`; pembaca layar langsung mendapat nilai final; semuanya mati untuk `prefers-reduced-motion`. `e2e/motion.spec.ts` memastikan tidak ada konten yang tersangkut tersembunyi dan rolling door selalu hilang dalam 3 detik.

## Foto

Empat foto Unsplash (lisensi Unsplash, gratis dipakai), WebP di `frontend/src/assets/photos/`, kredit di footer halaman awal:

| File | Fotografer | Lokasi | Dipakai |
|---|---|---|---|
| `hero-lapak-lebar.webp` (1800×1100, 322 KB) / `hero-lapak-tegak.webp` (900×1100, 229 KB, ponsel) | Anggit Rizkianto | Indonesia | latar hero |
| `pedagang-pasar-lampung.webp` | Devi Puspita Amartha Yahya | Pasar Gudang Lelang, Lampung | papan Kasir, halaman login |
| `pasar-gading-surakarta.webp` | Prabu Panji | Pasar Gading, Surakarta | papan Kulakan |
| `pemilik-lapak-bali.webp` | Polina Kuzovkova | Bali | papan Juragan & karyawan |

Foto di dalam papan ditampilkan sebagai cetakan berbingkai putih yang ditempel selotip.

Tidak ada keterangan karangan tentang orang di foto.
