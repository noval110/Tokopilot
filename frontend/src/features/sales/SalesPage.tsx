import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, ReceiptText, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Stamp } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectField } from '@/components/ui/Select'
import { ApiError, fieldErrors } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatIDR, formatStoreDateTime } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import { useSearchParamsPatch } from '@/lib/useSearchParamsPatch'
import { PAYMENT_LABELS, type PaymentMethod, salesApi, salesKeys, type SaleStatus } from '@/services/sales'
import { PageHeader } from '@/features/settings/PageHeader'

const PER_PAGE = 25

export function SaleStatusStamp({ status, size = 'sm', className }: { status: SaleStatus; size?: 'sm' | 'lg'; className?: string }) {
  const sizing = size === 'lg' ? 'text-base' : 'text-[0.625rem]'
  return status === 'VOIDED' ? (
    <Stamp tone="danger" tilt={size === 'lg' ? -6 : 3} className={cn(sizing, className)}>Void</Stamp>
  ) : (
    <Stamp tone="positive" tilt={size === 'lg' ? -6 : -3} className={cn(sizing, className)}>Lunas</Stamp>
  )
}

export function SalesPage() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const tz = me?.membership?.store.timezone ?? 'Asia/Jakarta'
  const { params, patch: set, reset } = useSearchParamsPatch()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const debounced = useDebounced(search.trim(), 300)
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)
  const filters = {
    q: params.get('q') ?? '',
    status: (params.get('status') ?? '') as SaleStatus | '',
    payment_method: (params.get('payment_method') ?? '') as PaymentMethod | '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page,
    per_page: PER_PAGE,
  }

  useEffect(() => {
    if (debounced !== (params.get('q') ?? '')) set({ q: debounced })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react only to the debounced text
  }, [debounced])

  const sales = useQuery({ queryKey: salesKeys.list(filters), queryFn: () => salesApi.list(filters), placeholderData: keepPreviousData })
  const fe = fieldErrors(sales.error)
  const filtered = Boolean(filters.q || filters.status || filters.payment_method || filters.from || filters.to)
  const total = sales.data?.meta.total ?? 0
  const from = total === 0 ? 0 : (page - 1) * PER_PAGE + 1
  const to = Math.min(total, page * PER_PAGE)
  const dateInput = 'h-11 w-full rounded-sm bg-white px-3 text-[0.9375rem] ring-1 ring-paper-300 ring-inset focus:ring-2 focus:ring-daun-600 focus:outline-none'

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Operasional" title="Riwayat transaksi" actions={<ButtonLink to="/sales/new"><Plus className="size-4" aria-hidden /> Transaksi baru</ButtonLink>}>
        Setiap nota tersimpan permanen. Pembatalan tercatat sebagai void, bukan dihapus.
      </PageHeader>

      <div className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_10rem]">
        <div>
          <label htmlFor="sale-search" className="mb-1.5 block text-sm font-semibold text-ink-800">Nomor nota</label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
            <input id="sale-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="mis. 20261110-0042" maxLength={40}
              className="h-11 w-full rounded-sm bg-white pr-3 pl-9 text-[0.9375rem] ring-1 ring-paper-300 ring-inset placeholder:text-text-subtle focus:ring-2 focus:ring-daun-600 focus:outline-none" />
          </div>
        </div>
        <SelectField label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Semua</option>
          <option value="COMPLETED">Lunas</option>
          <option value="VOIDED">Void</option>
        </SelectField>
        <SelectField label="Pembayaran" value={filters.payment_method} onChange={(e) => set({ payment_method: e.target.value })}>
          <option value="">Semua</option>
          {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
        </SelectField>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-800">Dari tanggal</span>
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className={dateInput} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-800">Sampai tanggal</span>
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className={dateInput} />
        </label>
      </div>

      <section aria-label="Daftar transaksi" className="mt-5">
        {sales.isPending && <div role="status" className="h-72 animate-pulse rounded-md bg-paper-100 ring-1 ring-paper-300"><span className="sr-only">Memuat transaksi…</span></div>}
        {sales.isError && (
          <Alert tone="danger" title="Transaksi tidak dapat dimuat">
            {fe['from'] ?? fe['to'] ?? (sales.error instanceof ApiError ? sales.error.message : 'Coba muat ulang halaman.')}
          </Alert>
        )}
        {sales.data && total === 0 && (
          <EmptyState
            icon={<ReceiptText className="size-5" aria-hidden />}
            title={filtered ? 'Tidak ada transaksi pada filter ini' : 'Belum ada transaksi'}
            action={filtered
              ? <Button variant="secondary" onClick={() => { setSearch(''); reset() }}>Hapus filter</Button>
              : <ButtonLink to="/sales/new"><Plus className="size-4" aria-hidden /> Catat transaksi pertama</ButtonLink>}
          >
            {filtered ? 'Coba ubah nomor, status, atau rentang tanggal.' : 'Nota akan muncul di sini setelah transaksi disimpan.'}
          </EmptyState>
        )}
        {sales.data && total > 0 && (
          <div className={cn('overflow-hidden rounded-md bg-white ring-1 ring-paper-300 transition-opacity', sales.isPlaceholderData && 'opacity-60')}>
            <table className="hidden w-full text-left text-sm md:table">
              <caption className="sr-only">Riwayat transaksi, terbaru di atas</caption>
              <thead className="border-b border-paper-300 bg-paper-50">
                <tr className="eyebrow text-text-subtle">
                  <th scope="col" className="px-5 py-3 font-semibold">Nota</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Kasir</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Pembayaran</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Total</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-200">
                {sales.data.data.map((s) => (
                  <tr key={s.id} onClick={() => navigate(`/sales/${s.id}`)} className="cursor-pointer hover:bg-paper-50">
                    <td className="px-5 py-3.5">
                      <Link to={`/sales/${s.id}`} onClick={(e) => e.stopPropagation()} className="num font-semibold text-ink-900 underline-offset-4 hover:underline">{s.sale_number}</Link>
                      <div className="num mt-0.5 text-[0.75rem] text-text-subtle">{formatStoreDateTime(new Date(s.sold_at), tz)} · {s.item_count} baris</div>
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">{s.cashier.name}</td>
                    <td className="px-5 py-3.5 text-text-muted">{PAYMENT_LABELS[s.payment_method]}</td>
                    <td className={cn('num px-5 py-3.5 text-right font-semibold', s.status === 'VOIDED' ? 'text-text-subtle line-through' : 'text-ink-900')}>{formatIDR(s.net_total)}</td>
                    <td className="px-5 py-3.5 text-right"><SaleStatusStamp status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-paper-200 md:hidden">
              {sales.data.data.map((s) => (
                <li key={s.id}>
                  <Link to={`/sales/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0">
                      <div className="num truncate font-semibold text-ink-900">{s.sale_number}</div>
                      <div className="num text-[0.75rem] text-text-subtle">{formatStoreDateTime(new Date(s.sold_at), tz)} · {PAYMENT_LABELS[s.payment_method]}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className={cn('num font-semibold', s.status === 'VOIDED' && 'text-text-subtle line-through')}>{formatIDR(s.net_total)}</span>
                      <SaleStatusStamp status={s.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <nav aria-label="Halaman transaksi" className="flex items-center justify-between border-t border-paper-200 px-5 py-3">
              <p className="num text-[0.75rem] text-text-muted">{from}–{to} dari {total}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, false)} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /></Button>
                <Button variant="secondary" size="sm" disabled={to >= total} onClick={() => set({ page: String(page + 1) }, false)} aria-label="Halaman berikutnya"><ChevronRight className="size-4" /></Button>
              </div>
            </nav>
          </div>
        )}
      </section>
    </div>
  )
}
