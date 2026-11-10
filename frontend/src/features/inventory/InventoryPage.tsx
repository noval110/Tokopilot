import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BookOpenText, ChevronLeft, ChevronRight, PackageCheck, PackagePlus, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useSearchParamsPatch } from '@/lib/useSearchParamsPatch'
import { useMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectField } from '@/components/ui/Select'
import { ApiError, fieldErrors } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatQuantity, timezoneLabel } from '@/lib/format'
import { catalogApi } from '@/services/catalog'
import { inventoryApi, inventoryKeys, MOVEMENT_LABELS, type MovementType } from '@/services/inventory'
import { PageHeader } from '@/features/settings/PageHeader'
import { StockBadge, StockGauge } from '@/features/products/StockStatus'
import { LedgerList } from './LedgerList'

const PER_PAGE = 25

function Tile({ label, value, tone, to }: { label: string; value: number | undefined; tone?: 'warn' | 'danger'; to: string }) {
  return (
    // dl > div > dt + dd stays valid for screen readers; the link stretches over the whole tile.
    <div className="group relative bg-white px-5 py-4 transition-colors focus-within:ring-2 focus-within:ring-daun-600 focus-within:ring-inset hover:bg-paper-50">
      <dt className="flex items-center justify-between text-[0.8125rem] text-text-muted">
        <Link to={to} className="after:absolute after:inset-0 focus:outline-none">{label}</Link>
        <ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </dt>
      <dd
        className={cn(
          'mt-1.5 font-display text-[2rem] leading-none font-bold',
          value === undefined ? 'text-text-subtle' : tone === 'danger' && value > 0 ? 'text-danger-600' : tone === 'warn' && value > 0 ? 'text-warn-600' : 'text-ink-900',
        )}
      >
        {value ?? <span className="inline-block h-7 w-10 animate-pulse rounded-xs bg-paper-200" aria-label="Memuat" />}
      </dd>
    </div>
  )
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const from = total === 0 ? 0 : (page - 1) * PER_PAGE + 1
  const to = Math.min(total, page * PER_PAGE)
  return (
    <nav aria-label="Halaman" className="flex items-center justify-between border-t border-paper-200 px-5 py-3">
      <p className="num text-[0.75rem] text-text-muted">{from}–{to} dari {total}</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /></Button>
        <Button variant="secondary" size="sm" disabled={to >= total} onClick={() => onPage(page + 1)} aria-label="Halaman berikutnya"><ChevronRight className="size-4" /></Button>
      </div>
    </nav>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-md bg-white ring-1 ring-paper-300">{children}</div>
}

function LowStockTab({ isOwner }: { isOwner: boolean }) {
  const low = useQuery({
    queryKey: ['products', 'list', { stock_status: 'low', sort: 'stock', per_page: 100 }],
    queryFn: () => catalogApi.products({ stock_status: 'low', sort: 'stock', per_page: 100 }),
  })
  if (low.isPending) return <div role="status" className="h-64 animate-pulse rounded-md bg-paper-100 ring-1 ring-paper-300"><span className="sr-only">Memuat…</span></div>
  if (low.isError) return <Alert tone="danger" title="Daftar stok rendah tidak dapat dimuat">Coba muat ulang halaman.</Alert>
  if (low.data.data.length === 0) {
    return (
      <EmptyState icon={<PackageCheck className="size-5" aria-hidden />} title="Semua stok aman">
        Tidak ada produk aktif yang berada di bawah atau sama dengan stok minimum.
      </EmptyState>
    )
  }
  return (
    <Panel>
      <ul className="divide-y divide-paper-200">
        {low.data.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <Link to={`/products/${p.id}`} className="font-semibold text-ink-900 underline-offset-4 hover:underline">{p.name}</Link>
              <div className="num text-[0.75rem] text-text-subtle">{p.sku ?? 'Tanpa SKU'} · min. {formatQuantity(p.min_stock, p.unit)}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="num text-sm font-semibold">{formatQuantity(p.current_stock, p.unit)}</span>
              <StockGauge current={p.current_stock} min={p.min_stock} status={p.stock_status} />
              <StockBadge status={p.stock_status} />
            </div>
            {isOwner && (
              <ButtonLink to={`/inventory/restock?product_id=${p.id}`} size="sm" variant="secondary">
                <PackagePlus className="size-4" aria-hidden /> Restock
              </ButtonLink>
            )}
          </li>
        ))}
      </ul>
      {low.data.meta.total > low.data.data.length && (
        <p className="border-t border-paper-200 px-5 py-3 text-[0.8125rem] text-text-muted">
          Menampilkan {low.data.data.length} dari {low.data.meta.total}. <Link to="/products?stock_status=low&sort=stock" className="font-semibold text-daun-800 underline">Lihat semua</Link>
        </p>
      )}
    </Panel>
  )
}

function LedgerTab({ timezone }: { timezone: string }) {
  const { params, patch: set } = useSearchParamsPatch()
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)
  const filters = {
    type: (params.get('type') ?? '') as MovementType | '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page,
    per_page: PER_PAGE,
  }
  const ledger = useQuery({ queryKey: inventoryKeys.movements(filters), queryFn: () => inventoryApi.movements(filters), placeholderData: keepPreviousData })
  const fe = fieldErrors(ledger.error)
  const filtered = Boolean(filters.type || filters.from || filters.to)

  const dateInput = 'h-11 w-full rounded-sm bg-white px-3 text-[0.9375rem] ring-1 ring-paper-300 ring-inset focus:ring-2 focus:ring-daun-600 focus:outline-none'
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem_11rem]">
        <SelectField label="Jenis mutasi" value={filters.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="">Semua jenis</option>
          {(Object.keys(MOVEMENT_LABELS) as MovementType[]).map((t) => <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>)}
        </SelectField>
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink-800">Dari tanggal</span>
            <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className={dateInput} aria-invalid={fe['from'] ? true : undefined} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink-800">Sampai tanggal</span>
            <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className={dateInput} aria-invalid={fe['to'] ? true : undefined} />
          </label>
        </div>
      </div>
      <p className="text-[0.75rem] text-text-subtle">Tanggal mengikuti zona toko ({timezoneLabel(timezone)}). Buku besar tidak dapat diedit atau dihapus.</p>

      {ledger.isPending && <div role="status" className="h-72 animate-pulse rounded-md bg-paper-100 ring-1 ring-paper-300"><span className="sr-only">Memuat buku besar…</span></div>}
      {ledger.isError && (
        <Alert tone="danger" title="Buku besar tidak dapat dimuat">
          {fe['from'] ?? fe['to'] ?? (ledger.error instanceof ApiError ? ledger.error.message : 'Coba muat ulang halaman.')}
        </Alert>
      )}
      {ledger.data && ledger.data.meta.total === 0 && (
        <EmptyState
          icon={<BookOpenText className="size-5" aria-hidden />}
          title={filtered ? 'Tidak ada mutasi pada filter ini' : 'Buku besar masih kosong'}
          action={filtered && <Button variant="secondary" onClick={() => set({ type: '', from: '', to: '' })}>Hapus filter</Button>}
        >
          {filtered ? 'Coba ubah jenis atau rentang tanggal.' : 'Mutasi muncul saat produk dibuat dengan stok awal, direstock, atau disesuaikan.'}
        </EmptyState>
      )}
      {ledger.data && ledger.data.meta.total > 0 && (
        <div className={cn('transition-opacity', ledger.isPlaceholderData && 'opacity-60')}>
          <Panel>
            <LedgerList movements={ledger.data.data} timezone={timezone} />
            <Pager page={page} total={ledger.data.meta.total} onPage={(p) => set({ page: String(p) }, false)} />
          </Panel>
        </div>
      )}
    </div>
  )
}

export function InventoryPage() {
  const { data: me } = useMe()
  const isOwner = me?.membership?.role === 'OWNER'
  const timezone = me?.membership?.store.timezone ?? 'Asia/Jakarta'
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'ledger' ? 'ledger' : 'low'
  const summary = useQuery({ queryKey: inventoryKeys.summary, queryFn: inventoryApi.summary })

  const tabs = [
    { id: 'low', label: 'Perlu restock', count: summary.data?.low_stock },
    { id: 'ledger', label: 'Buku besar' },
  ] as const

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Operasional"
        title="Inventaris"
        actions={
          isOwner && (
            <div className="flex gap-2">
              <ButtonLink to="/inventory/adjustments" variant="secondary"><SlidersHorizontal className="size-4" aria-hidden /> Penyesuaian</ButtonLink>
              <ButtonLink to="/inventory/restock"><PackagePlus className="size-4" aria-hidden /> Restock</ButtonLink>
            </div>
          )
        }
      >
        Stok saat ini, peringatan stok rendah, dan buku besar setiap perubahan.
      </PageHeader>

      <dl aria-label="Ringkasan stok" className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-md bg-paper-300 ring-1 ring-paper-300">
        <Tile label="Produk aktif" value={summary.data?.active_products} to="/products" />
        <Tile label="Stok rendah" value={summary.data?.low_stock} tone="warn" to="/products?stock_status=low&sort=stock" />
        <Tile label="Habis" value={summary.data?.out_of_stock} tone="danger" to="/products?stock_status=out" />
      </dl>
      {summary.isError && <Alert tone="danger" className="mt-3">Ringkasan stok tidak dapat dimuat.</Alert>}

      <div role="tablist" aria-label="Tampilan inventaris" className="mt-8 flex gap-6 border-b border-paper-300">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setParams(t.id === 'ledger' ? { tab: 'ledger' } : {}, { replace: true })}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold transition-colors',
              tab === t.id ? 'border-daun-600 text-ink-900' : 'border-transparent text-text-muted hover:text-ink-900',
            )}
          >
            {t.label}
            {'count' in t && t.count !== undefined && t.count > 0 && (
              <span className="num rounded-full bg-warn-50 px-2 py-0.5 text-[0.6875rem] text-warn-800 ring-1 ring-warn-200">{t.count}</span>
            )}
          </button>
        ))}
      </div>
      <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === 'low' ? <LowStockTab isOwner={isOwner} /> : <LedgerTab timezone={timezone} />}
      </section>
    </div>
  )
}
