import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, Lock, PackageX } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Stamp } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Loader'
import { ApiError } from '@/lib/api'
import { formatIDR, formatQuantity, formatStoreDate } from '@/lib/format'
import { catalogApi, catalogKeys, type Product } from '@/services/catalog'
import { ProductHistory } from '@/features/inventory/ProductHistory'
import { PriceTag } from './PriceTag'
import { ProductForm } from './ProductForm'
import { fromProduct, type ProductFormValues, toPayload } from './productModel'
import { StockBadge, StockGauge } from './StockStatus'

function CurrentStock({ p }: { p: Product }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-ink-800">Stok saat ini</p>
      <div className="flex h-11 items-center justify-between rounded-sm bg-paper-100 px-3 ring-1 ring-paper-300 ring-inset">
        <span className="num font-semibold text-ink-900">{formatQuantity(p.current_stock, p.unit)}</span>
        <span className="flex items-center gap-2">
          <StockGauge current={p.current_stock} min={p.min_stock} status={p.stock_status} />
          <StockBadge status={p.stock_status} />
        </span>
      </div>
      <p className="mt-1.5 flex items-start gap-1.5 text-[0.8125rem] text-text-muted">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Berubah hanya lewat restock, penyesuaian, atau penjualan. Setiap perubahan tercatat di buku besar.
      </p>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-3">
      <dt className="text-sm text-text-muted">{label}</dt>
      <span aria-hidden className="leader" />
      <dd className="text-right text-sm font-semibold text-ink-900">{children}</dd>
    </div>
  )
}

function ReadOnlyDetail({ p }: { p: Product }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <section className="rounded-md bg-white p-6 ring-1 ring-paper-300 sm:p-8">
        <dl className="divide-y divide-paper-200">
          <Row label="SKU"><span className="num">{p.sku ?? 'Tanpa SKU'}</span></Row>
          <Row label="Kategori">{p.category?.name ?? 'Tanpa kategori'}</Row>
          <Row label="Satuan">{p.unit}</Row>
          <Row label="Harga jual"><span className="num">{formatIDR(p.selling_price)}</span></Row>
          <Row label="Harga modal"><span className="num">{formatIDR(p.cost_price)}</span></Row>
          <Row label="Stok saat ini"><span className="num">{formatQuantity(p.current_stock, p.unit)}</span></Row>
          <Row label="Stok minimum"><span className="num">{formatQuantity(p.min_stock, p.unit)}</span></Row>
          <Row label="Diperbarui">{formatStoreDate(new Date(p.updated_at)).replace(/^\w+, /, '')}</Row>
        </dl>
      </section>
      <aside>
        <PriceTag name={p.name} price={p.selling_price} unit={p.unit} sku={p.sku ?? ''} category={p.category?.name} />
      </aside>
    </div>
  )
}

export function ProductDetailPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const isOwner = me?.membership?.role === 'OWNER'
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [saved, setSaved] = useState(Boolean((location.state as { created?: boolean } | null)?.created))

  const product = useQuery({ queryKey: catalogKeys.product(id), queryFn: () => catalogApi.product(id) })
  const categories = useQuery({ queryKey: catalogKeys.categories, queryFn: () => catalogApi.categories(), enabled: isOwner })

  const onUpdated = (p: Product) => {
    qc.setQueryData(catalogKeys.product(p.id), p)
    void qc.invalidateQueries({ queryKey: ['products', 'list'] })
    void qc.invalidateQueries({ queryKey: catalogKeys.categories })
  }
  const update = useMutation({
    mutationFn: (v: ProductFormValues) => catalogApi.updateProduct(id, toPayload(v)),
    onSuccess: (p) => { onUpdated(p); setSaved(true) },
  })
  const archive = useMutation({
    mutationFn: () => catalogApi.archiveProduct(id),
    onSuccess: (p) => { onUpdated(p); setConfirmArchive(false) },
  })

  if (product.isPending) {
    return (
      <div role="status" className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded-sm bg-paper-200" />
        <div className="h-96 animate-pulse rounded-md bg-paper-100 ring-1 ring-paper-300" />
        <span className="sr-only">Memuat produk…</span>
      </div>
    )
  }
  if (product.isError) {
    const notFound = product.error instanceof ApiError && product.error.status === 404
    return notFound ? (
      <EmptyState
        icon={<PackageX className="size-5" aria-hidden />}
        title="Produk tidak ditemukan"
        action={<ButtonLink to="/products" variant="secondary">Kembali ke produk</ButtonLink>}
      >
        Produk ini tidak ada di toko kamu.
      </EmptyState>
    ) : (
      <Alert tone="danger" title="Produk tidak dapat dimuat">Coba muat ulang halaman.</Alert>
    )
  }

  const p = product.data
  return (
    <div className="animate-rise">
      <Link to="/products" className="mb-5 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-ink-900">
        <ArrowLeft className="size-4" aria-hidden /> Semua produk
      </Link>
      <header className="flex flex-col gap-4 border-b border-paper-300 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow text-text-subtle">
            {p.category?.name ?? 'Tanpa kategori'}
            {p.sku && <span className="num ml-2 text-text-muted">· {p.sku}</span>}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <h1 className="text-[2rem] leading-[1.05] font-bold break-words sm:text-[2.5rem]">{p.name}</h1>
            {!p.is_active && <Stamp tone="ink" tilt={-5} className="text-sm">Arsip</Stamp>}
          </div>
          {p.is_active && <div className="mt-3"><StockBadge status={p.stock_status} /></div>}
        </div>
        {isOwner && p.is_active && (
          <Button variant="danger-ghost" onClick={() => setConfirmArchive(true)}>
            <Archive className="size-4" aria-hidden /> Arsipkan
          </Button>
        )}
      </header>

      <div className="mt-8 space-y-6">
        {saved && !update.isPending && <Alert tone="positive">Produk tersimpan.</Alert>}
        {!p.is_active && (
          <Alert tone="info" title="Produk diarsipkan">
            Tidak tersedia untuk transaksi baru. Riwayat penjualan dan mutasi stoknya tetap utuh.
          </Alert>
        )}

        {isOwner && p.is_active ? (
          <ProductForm
            key={p.updated_at}
            initial={fromProduct(p)}
            creating={false}
            submitLabel="Simpan perubahan"
            pending={update.isPending}
            error={update.error}
            onSubmit={(v) => { setSaved(false); update.mutate(v) }}
            currentStockNote={<CurrentStock p={p} />}
            categoryName={(cid) =>
              categories.data?.data.find((c) => c.id === cid)?.name ?? (p.category && cid === p.category.id ? p.category.name : undefined)
            }
          />
        ) : (
          <ReadOnlyDetail p={p} />
        )}
      </div>

      <ProductHistory productId={p.id} active={p.is_active} />

      <Dialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        tone="danger"
        title={`Arsipkan ${p.name}?`}
        description="Produk tidak bisa dipilih di kasir lagi. Riwayat penjualan dan mutasi stok tetap tersimpan, dan SKU-nya boleh dipakai produk baru."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmArchive(false)} data-autofocus>
              Batal
            </Button>
            <Button variant="danger" disabled={archive.isPending} onClick={() => archive.mutate()}>
              {archive.isPending ? <Spinner /> : <Archive className="size-4" aria-hidden />} Arsipkan produk
            </Button>
          </>
        }
      >
        {archive.error ? (
          <Alert tone="danger">{archive.error instanceof ApiError ? archive.error.message : 'Gagal mengarsipkan.'}</Alert>
        ) : null}
      </Dialog>
    </div>
  )
}
