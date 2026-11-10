import type { LucideIcon } from 'lucide-react'
import {
  ArchiveRestore,
  BarChart3,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  MessageSquareText,
  PackagePlus,
  ReceiptText,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  Users,
} from 'lucide-react'

export type Access = 'owner' | 'owner-staff'

export interface ModuleDef {
  id: string
  path: string
  title: string
  /** Short label used in navigation. */
  nav: string
  icon: LucideIcon
  sprint: number
  access: Access
  summary: string
  /** What will live on this screen, each tied to a PRD requirement ID. */
  scope: Array<{ id: string; text: string }>
  /** Invariants the screen must respect (PRD §9). */
  rules?: Array<{ id: string; text: string }>
  /** KPI labels shown as empty slots — never with invented values. */
  slots?: string[]
  inNav?: boolean
}

export const modules: ModuleDef[] = [
  {
    id: 'dashboard',
    path: '/dashboard',
    title: 'Dasbor',
    nav: 'Dasbor',
    icon: LayoutDashboard,
    sprint: 5,
    access: 'owner-staff',
    summary: 'Ringkasan kondisi toko untuk periode yang kamu pilih.',
    scope: [
      { id: 'FR-DASH-01', text: 'Total penjualan, jumlah transaksi, produk aktif, dan jumlah stok rendah' },
      { id: 'FR-DASH-02', text: 'Tren penjualan sesuai rentang tanggal' },
      { id: 'FR-DASH-03', text: 'Produk terlaris dan produk stok rendah' },
      { id: 'FR-DASH-04', text: 'Semua angka dari toko aktif dan filter periode yang sama' },
    ],
    rules: [
      { id: 'BR-10', text: 'Penjualan bersih = subtotal − diskon; transaksi void tidak dihitung' },
      { id: 'BR-13', text: 'Batas hari mengikuti zona waktu toko (default Asia/Jakarta)' },
    ],
    slots: ['Penjualan bersih', 'Transaksi', 'Produk aktif', 'Stok rendah'],
  },
  {
    id: 'products',
    path: '/products',
    title: 'Produk',
    nav: 'Produk',
    icon: Boxes,
    sprint: 2,
    access: 'owner-staff',
    summary: 'Katalog produk dengan SKU, kategori, harga, satuan, dan stok minimum.',
    scope: [
      { id: 'FR-PROD-01', text: 'Buat produk: nama, SKU unik per toko, kategori, satuan, harga modal & jual' },
      { id: 'FR-PROD-02', text: 'Ubah data produk (owner)' },
      { id: 'FR-PROD-03', text: 'Arsipkan produk yang punya histori, tidak pernah dihapus permanen' },
      { id: 'FR-PROD-04', text: 'Cari nama/SKU, filter kategori dan status stok' },
    ],
    rules: [
      { id: 'BR-08', text: 'Harga disimpan sebagai bilangan bulat rupiah' },
      { id: 'BR-17', text: 'Arsip tidak menghapus histori penjualan atau mutasi' },
    ],
  },
  {
    id: 'products-new',
    path: '/products/new',
    title: 'Tambah produk',
    nav: 'Tambah produk',
    icon: PackagePlus,
    sprint: 2,
    access: 'owner',
    summary: 'Formulir produk baru dengan validasi per kolom.',
    scope: [
      { id: 'FR-PROD-01', text: 'Formulir lengkap dengan helper text dan error per kolom' },
      { id: 'FR-PROD-05', text: 'Harga dan kuantitas tidak boleh negatif' },
    ],
    inNav: false,
  },
  {
    id: 'inventory',
    path: '/inventory',
    title: 'Inventaris',
    nav: 'Inventaris',
    icon: ClipboardList,
    sprint: 3,
    access: 'owner-staff',
    summary: 'Stok saat ini, peringatan stok rendah, dan buku besar mutasi.',
    scope: [
      { id: 'FR-INV-05', text: 'Tanda stok rendah saat stok ≤ minimum' },
      { id: 'FR-INV-06', text: 'Stok saat ini dan riwayat mutasi per produk' },
      { id: 'FR-INV-03', text: 'Setiap mutasi adalah baris permanen di buku besar' },
    ],
    rules: [
      { id: 'BR-04', text: 'Stok tidak pernah negatif' },
      { id: 'BR-05', text: 'Tidak ada perubahan stok tanpa catatan mutasi' },
    ],
  },
  {
    id: 'restock',
    path: '/inventory/restock',
    title: 'Restock',
    nav: 'Restock',
    icon: ArchiveRestore,
    sprint: 3,
    access: 'owner',
    summary: 'Catat barang masuk. Stok bertambah dan mutasi RESTOCK tercatat dalam satu transaksi.',
    scope: [{ id: 'FR-INV-01', text: 'Kuantitas positif dengan catatan opsional' }],
    inNav: false,
  },
  {
    id: 'adjustments',
    path: '/inventory/adjustments',
    title: 'Penyesuaian stok',
    nav: 'Penyesuaian',
    icon: SlidersHorizontal,
    sprint: 3,
    access: 'owner',
    summary: 'Koreksi stok masuk atau keluar, selalu dengan alasan.',
    scope: [{ id: 'FR-INV-02', text: 'Adjustment masuk/keluar beserta alasan' }],
    inNav: false,
  },
  {
    id: 'sales-new',
    path: '/sales/new',
    title: 'Transaksi baru',
    nav: 'Kasir',
    icon: ScanLine,
    sprint: 4,
    access: 'owner-staff',
    summary: 'Kasir: pilih produk, atur kuantitas, diskon nominal, dan catat metode pembayaran.',
    scope: [
      { id: 'FR-SALE-01', text: 'Satu atau lebih item per transaksi' },
      { id: 'FR-SALE-03', text: 'Diskon nominal tidak melebihi subtotal' },
      { id: 'FR-SALE-04', text: 'Metode pembayaran dicatat manual (tunai, transfer, QRIS)' },
      { id: 'FR-SALE-10', text: 'Klik ganda atau retry tetap menghasilkan satu nota' },
    ],
    rules: [
      { id: 'BR-07', text: 'Penjualan, item, stok, dan mutasi dalam satu transaksi database' },
      { id: 'BR-09', text: 'Nama dan harga dibekukan sebagai snapshot saat checkout' },
    ],
  },
  {
    id: 'sales',
    path: '/sales',
    title: 'Riwayat transaksi',
    nav: 'Transaksi',
    icon: ReceiptText,
    sprint: 4,
    access: 'owner-staff',
    summary: 'Telusuri nota, lihat detail item, dan void transaksi yang salah (owner).',
    scope: [
      { id: 'FR-SALE-08', text: 'Riwayat dan detail transaksi' },
      { id: 'FR-SALE-09', text: 'Void dengan alasan; stok dipulihkan lewat mutasi pembalikan' },
    ],
    rules: [{ id: 'BR-06', text: 'Void membuat pembalikan, tidak menghapus data' }],
  },
  {
    id: 'reports',
    path: '/reports',
    title: 'Laporan',
    nav: 'Laporan',
    icon: BarChart3,
    sprint: 5,
    access: 'owner-staff',
    summary: 'Penjualan kotor, diskon, penjualan bersih, dan produk terlaris per periode.',
    scope: [
      { id: 'FR-REP-01', text: 'Filter rentang tanggal' },
      { id: 'FR-REP-02', text: 'Gross sales, diskon, net sales, jumlah transaksi, produk terlaris' },
      { id: 'FR-REP-03', text: 'Ekspor CSV sesuai filter aktif' },
    ],
    rules: [{ id: 'BR-11', text: 'Laba kotor = net sales − HPP dari snapshot harga modal' }],
    slots: ['Penjualan kotor', 'Diskon', 'Penjualan bersih', 'Laba kotor (estimasi)'],
  },
  {
    id: 'assistant',
    path: '/assistant',
    title: 'Asisten AI',
    nav: 'Asisten AI',
    icon: MessageSquareText,
    sprint: 6,
    access: 'owner-staff',
    summary: 'Tanya tentang stok dan penjualan dalam Bahasa Indonesia. Hanya membaca, tidak pernah mengubah.',
    scope: [
      { id: 'FR-AI-02', text: 'Hanya alat baca-saja yang diizinkan server' },
      { id: 'FR-AI-05', text: 'Angka selalu bersumber dari hasil alat; jujur bila data tidak ada' },
      { id: 'FR-AI-06', text: 'Menyebut periode dan waktu data diambil' },
      { id: 'FR-AI-07', text: 'Riwayat percakapan per pengguna dan toko' },
    ],
    rules: [{ id: 'BR-14', text: 'Semua perubahan data hanya lewat UI/backend normal' }],
  },
  {
    id: 'settings-store',
    path: '/settings/store',
    title: 'Pengaturan toko',
    nav: 'Toko',
    icon: Settings2,
    sprint: 1,
    access: 'owner',
    summary: 'Nama toko, alamat, zona waktu, dan mata uang.',
    scope: [{ id: 'FR-SET-01', text: 'Ubah nama dan informasi dasar toko' }],
  },
  {
    id: 'settings-team',
    path: '/settings/team',
    title: 'Anggota toko',
    nav: 'Tim',
    icon: Users,
    sprint: 1,
    access: 'owner',
    summary: 'Daftar owner dan staff beserta perannya.',
    scope: [
      { id: 'FR-SET-02', text: 'Lihat anggota dan perannya' },
      { id: 'FR-STORE-04', text: 'Tambah staff dan tetapkan peran' },
    ],
  },
]

export interface NavGroup {
  label: string
  items: ModuleDef[]
}

const byId = (id: string): ModuleDef => {
  const m = modules.find((x) => x.id === id)
  if (!m) throw new Error(`Unknown module ${id}`)
  return m
}

/** Navigation groups exactly as PRD §6.1. */
export const navGroups: NavGroup[] = [
  { label: 'Ikhtisar', items: [byId('dashboard')] },
  { label: 'Katalog', items: [byId('products')] },
  { label: 'Operasional', items: [byId('inventory'), byId('sales-new'), byId('sales')] },
  { label: 'Wawasan', items: [byId('reports'), byId('assistant')] },
  { label: 'Administrasi', items: [byId('settings-store'), byId('settings-team')] },
]

/** Dynamic detail routes shown in the breadcrumb under their parent module. */
const detailRoutes: Array<{ pattern: RegExp; parent: string; title: string }> = [
  { pattern: /^\/products\/(?!new$)[^/]+$/, parent: 'products', title: 'Detail produk' },
  { pattern: /^\/sales\/(?!new$)[^/]+$/, parent: 'sales', title: 'Detail nota' },
]

export function findModule(pathname: string): { module: ModuleDef; group?: NavGroup } | undefined {
  const detail = detailRoutes.find((d) => d.pattern.test(pathname))
  if (detail) {
    const parent = byId(detail.parent)
    return {
      module: { ...parent, title: detail.title },
      group: navGroups.find((g) => g.items.some((i) => i.id === parent.id)),
    }
  }
  const module = modules.find((m) => m.path === pathname)
  if (!module) return undefined
  const group = navGroups.find((g) =>
    g.items.some((i) => i.id === module.id || pathname.startsWith(i.path + '/')),
  )
  return { module, group }
}
