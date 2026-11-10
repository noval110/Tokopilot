import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, CheckCircle2, Plus, Printer, ReceiptText } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Loader'
import { Receipt, ReceiptRow } from '@/components/ui/Receipt'
import { ApiError, fieldErrors } from '@/lib/api'
import { formatIDR, formatQuantity, formatStoreDateTime } from '@/lib/format'
import { PAYMENT_LABELS, salesApi, salesKeys } from '@/services/sales'
import { SaleStatusStamp } from './SalesPage'

function VoidDialog({ open, onClose, saleId, saleNumber }: { open: boolean; onClose: () => void; saleId: string; saleNumber: string }) {
  const qc = useQueryClient()
  const id = useId()
  const [reason, setReason] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)
  const voidSale = useMutation({
    mutationFn: () => salesApi.void(saleId, reason),
    onSuccess: (sale) => {
      qc.setQueryData(salesKeys.detail(saleId), sale)
      void qc.invalidateQueries({ queryKey: ['sales', 'list'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      onClose()
    },
  })
  const err = localErr ?? fieldErrors(voidSale.error)['reason'] ?? (voidSale.error instanceof ApiError ? voidSale.error.message : voidSale.error ? 'Gagal membatalkan.' : null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) return setLocalErr('Alasan pembatalan wajib (minimal 3 karakter).')
    setLocalErr(null)
    voidSale.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      tone="danger"
      title={`Void nota ${saleNumber}?`}
      description="Nota tetap tersimpan dengan cap VOID. Stok setiap item dikembalikan lewat mutasi pembalikan, dan transaksi ini tidak dihitung di laporan."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus>Batal</Button>
          <Button variant="danger" type="submit" form={`${id}-form`} disabled={voidSale.isPending}>
            {voidSale.isPending ? <Spinner /> : <Ban className="size-4" aria-hidden />} Void transaksi
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit}>
        <label htmlFor={`${id}-reason`} className="mb-1.5 block text-sm font-semibold text-ink-800">Alasan pembatalan</label>
        <textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => { setReason(e.target.value); setLocalErr(null) }}
          maxLength={500}
          rows={3}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          placeholder="mis. Salah input jumlah"
          className="block w-full rounded-sm bg-white px-3 py-2.5 text-[0.9375rem] ring-1 ring-paper-300 ring-inset focus:ring-2 focus:ring-daun-600 focus:outline-none"
        />
        {err && <p id={`${id}-err`} className="mt-1.5 text-[0.8125rem] font-medium text-danger-600">{err}</p>}
      </form>
    </Dialog>
  )
}

export function SaleDetailPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const state = location.state as { justCreated?: boolean; previewSubtotal?: number } | null
  const { data: me } = useMe()
  const isOwner = me?.membership?.role === 'OWNER'
  const store = me?.membership?.store
  const [voiding, setVoiding] = useState(false)
  const sale = useQuery({ queryKey: salesKeys.detail(id), queryFn: () => salesApi.get(id) })

  if (sale.isPending) {
    return <div role="status" className="mx-auto h-[32rem] max-w-md animate-pulse rounded-md bg-paper-100"><span className="sr-only">Memuat nota…</span></div>
  }
  if (sale.isError) {
    return sale.error instanceof ApiError && sale.error.status === 404 ? (
      <EmptyState icon={<ReceiptText className="size-5" aria-hidden />} title="Nota tidak ditemukan" action={<ButtonLink to="/sales" variant="secondary">Riwayat transaksi</ButtonLink>}>
        Transaksi ini tidak ada di toko kamu.
      </EmptyState>
    ) : (
      <Alert tone="danger" title="Nota tidak dapat dimuat">Coba muat ulang halaman.</Alert>
    )
  }

  const s = sale.data
  const priceChanged = state?.justCreated && state.previewSubtotal !== undefined && state.previewSubtotal !== s.subtotal
  return (
    <div className="animate-rise">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/sales" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-ink-900">
          <ArrowLeft className="size-4" aria-hidden /> Riwayat transaksi
        </Link>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Cetak</Button>
          {isOwner && s.status === 'COMPLETED' && (
            <Button variant="danger-ghost" size="sm" onClick={() => setVoiding(true)}><Ban className="size-4" aria-hidden /> Void</Button>
          )}
        </div>
      </div>

      {state?.justCreated && s.status === 'COMPLETED' && (
        <div className="mx-auto mb-6 max-w-md space-y-3 print:hidden">
          <Alert tone="positive" title="Transaksi tersimpan">
            Stok sudah dikurangi dan tercatat di buku besar.
          </Alert>
          {priceChanged && (
            <Alert tone="warning" title="Harga berubah sejak keranjang dibuat">
              Total mengikuti harga terbaru di katalog ({formatIDR(s.subtotal)} vs pratinjau {formatIDR(state.previewSubtotal ?? 0)}).
            </Alert>
          )}
          <ButtonLink to="/sales/new" size="lg" className="w-full"><Plus className="size-4" aria-hidden /> Transaksi baru</ButtonLink>
        </div>
      )}

      <article aria-label={`Nota ${s.sale_number}`} className="relative mx-auto max-w-md">
        <Receipt className="rounded-t-md">
          <header className="text-center">
            <div className="font-display text-xl font-bold">{store?.name}</div>
            {store?.address && <div className="mt-0.5 text-[0.75rem] text-text-muted">{store.address}</div>}
            {/* The receipt number is the page title for assistive tech; looks unchanged. */}
            <h1 className="num mt-3 text-sm font-semibold"><span className="sr-only">Nota</span>{' '}{s.sale_number}</h1>
            <div className="num text-[0.75rem] text-text-muted">{formatStoreDateTime(new Date(s.sold_at), store?.timezone)} · Kasir {s.cashier.name}</div>
            {/* Status stamp sits in clear space: amounts on a receipt must never be covered. */}
            <div className="mt-4">
              <SaleStatusStamp status={s.status} size="lg" />
            </div>
          </header>

          <div className="my-4 border-t border-dashed border-paper-300" />
          <ul className="space-y-2.5" aria-label="Item">
            {s.items?.map((it) => (
              <li key={it.line_no}>
                <ReceiptRow label={it.product_name} value={formatIDR(it.line_subtotal).replace('Rp ', '')} />
                <div className="num text-[0.6875rem] text-text-subtle">
                  {formatQuantity(it.quantity, it.unit)} × {formatIDR(it.unit_price).replace('Rp ', '')}
                  {it.sku && ` · ${it.sku}`}
                </div>
              </li>
            ))}
          </ul>
          <div className="my-4 border-t border-dashed border-paper-300" />
          <div className="space-y-1.5">
            <ReceiptRow label="Subtotal" value={formatIDR(s.subtotal)} muted />
            {s.discount_amount > 0 && <ReceiptRow label="Diskon" value={`−${formatIDR(s.discount_amount)}`} muted />}
            <ReceiptRow label="Total" value={formatIDR(s.net_total)} strong />
            <ReceiptRow label="Pembayaran" value={PAYMENT_LABELS[s.payment_method]} muted />
          </div>
          {s.notes && <p className="mt-4 text-[0.8125rem] text-text-muted">Catatan: {s.notes}</p>}
          <p className="num mt-5 text-center text-[0.6875rem] text-text-subtle">terima kasih</p>
        </Receipt>

        {s.void && (
          <div className="mt-6 rounded-md bg-danger-50 p-4 text-sm text-danger-800 ring-1 ring-danger-200">
            <p className="flex items-center gap-2 font-semibold"><Ban className="size-4" aria-hidden /> Dibatalkan oleh {s.void.by.name}</p>
            <p className="mt-1">{s.void.reason}</p>
            <p className="num mt-1 text-[0.75rem] opacity-80">{formatStoreDateTime(new Date(s.void.at), store?.timezone)} · stok dikembalikan</p>
          </div>
        )}
        {s.status === 'COMPLETED' && !state?.justCreated && (
          <p className="mt-6 flex items-center justify-center gap-2 text-[0.8125rem] text-text-muted print:hidden">
            <CheckCircle2 className="size-4 text-daun-700" aria-hidden /> Tercatat permanen di buku besar
          </p>
        )}
      </article>

      {isOwner && <VoidDialog open={voiding} onClose={() => setVoiding(false)} saleId={s.id} saleNumber={s.sale_number} />}
    </div>
  )
}
