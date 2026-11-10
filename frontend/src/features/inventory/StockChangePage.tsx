import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, CheckCircle2, PackagePlus, SlidersHorizontal } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Loader'
import { ApiError, fieldErrors } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDelta, formatQuantity } from '@/lib/format'
import { normalizeQuantityInput, quantityError } from '@/lib/quantity'
import { catalogApi, catalogKeys, type Product } from '@/services/catalog'
import { inventoryApi, type ReasonCode, REASONS, type StockChangeResult } from '@/services/inventory'
import { PageHeader } from '@/features/settings/PageHeader'
import { ProductPicker } from './ProductPicker'
import { StockPreview } from './StockPreview'

type Mode = 'restock' | 'adjust'
type Errors = Partial<Record<'product_id' | 'quantity' | 'reason_code' | 'note' | 'direction', string>>

const copy = {
  restock: {
    title: 'Restock',
    eyebrow: 'Operasional · Barang masuk',
    lead: 'Catat barang yang baru datang. Stok bertambah dan mutasi RESTOCK tercatat dalam satu transaksi.',
    submit: 'Catat restock',
    Icon: PackagePlus,
  },
  adjust: {
    title: 'Penyesuaian stok',
    eyebrow: 'Operasional · Koreksi',
    lead: 'Koreksi selisih stok karena rusak, hilang, kedaluwarsa, atau hasil hitung ulang. Alasan selalu tercatat.',
    submit: 'Simpan penyesuaian',
    Icon: SlidersHorizontal,
  },
}

function ReasonPicker({ value, onChange, error }: { value: ReasonCode | ''; onChange: (r: ReasonCode) => void; error?: string | undefined }) {
  const name = useId()
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold text-ink-800">Alasan</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {REASONS.map((r) => (
          <label
            key={r.code}
            className={cn(
              'cursor-pointer rounded-sm bg-white px-3 py-2.5 ring-1 ring-inset transition-shadow has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-daun-600',
              value === r.code ? 'ring-2 ring-daun-700' : error ? 'ring-danger-200' : 'ring-paper-300 hover:ring-paper-400',
            )}
          >
            <input type="radio" name={name} value={r.code} checked={value === r.code} onChange={() => onChange(r.code)} className="sr-only" aria-label={`${r.label}: ${r.hint}`} />
            <span className="block text-sm font-semibold text-ink-900">{r.label}</span>
            <span className="block text-[0.75rem] text-text-muted">{r.hint}</span>
          </label>
        ))}
      </div>
      {error && <p className="mt-1.5 text-[0.8125rem] font-medium text-danger-600">{error}</p>}
    </fieldset>
  )
}

function Success({ res, mode, onAgain }: { res: StockChangeResult; mode: Mode; onAgain: () => void }) {
  const m = res.movement
  return (
    <div className="rounded-md bg-white p-6 ring-1 ring-daun-200 sm:p-8">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-daun-700" aria-hidden />
        <div role="status">
          <h2 className="text-xl font-bold">Tercatat di buku besar</h2>
          <p className="mt-1 text-text-muted">
            <span className="font-semibold text-ink-900">{m.product.name}</span>{' '}
            <span className="num font-semibold">{formatDelta(m.quantity_delta, m.product.unit)}</span>. Stok sekarang{' '}
            <span className="num font-semibold text-ink-900">{formatQuantity(m.stock_after, m.product.unit)}</span>.
          </p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-3 border-t border-paper-200 pt-5">
        <Button onClick={onAgain}>{mode === 'restock' ? 'Catat restock lain' : 'Penyesuaian lain'}</Button>
        <ButtonLink to={`/products/${m.product.id}`} variant="secondary">Lihat produk</ButtonLink>
        <ButtonLink to="/inventory?tab=ledger" variant="ghost">Buka buku besar</ButtonLink>
      </div>
    </div>
  )
}

export function StockChangePage({ mode }: { mode: Mode }) {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const { data: me } = useMe()
  const prefillId = params.get('product_id') ?? ''
  const c = copy[mode]

  const [product, setProduct] = useState<Product | null>(null)
  const [picked, setPicked] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT')
  const [reason, setReason] = useState<ReasonCode | ''>('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Errors>({})

  // Optional ?product_id= prefill (e.g. from the low-stock list or product page).
  const prefill = useQuery({ queryKey: catalogKeys.product(prefillId), queryFn: () => catalogApi.product(prefillId), enabled: Boolean(prefillId) && !picked })
  const selected = picked ? product : (product ?? (prefill.data?.is_active ? prefill.data : null))

  const save = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('no product')
      const qty = normalizeQuantityInput(quantity)
      const n = note.trim() || undefined
      return mode === 'restock'
        ? inventoryApi.restock({ product_id: selected.id, quantity: qty, ...(n ? { note: n } : {}) })
        : inventoryApi.adjust({ product_id: selected.id, direction, quantity: qty, reason_code: reason as ReasonCode, ...(n ? { note: n } : {}) })
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.setQueryData(catalogKeys.product(res.product.id), res.product)
    },
    onError: (err) => setErrors(fieldErrors(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const next: Errors = {}
    if (!selected) next.product_id = 'Pilih produk.'
    if (!quantity.trim()) next.quantity = 'Jumlah wajib diisi.'
    else if (selected) {
      const qe = quantityError(quantity, selected.unit_scale, 'Jumlah')
      if (qe) next.quantity = qe
      else if (/^0*([.,]0*)?$/.test(quantity.trim())) next.quantity = 'Jumlah harus lebih dari 0.'
    }
    if (mode === 'adjust') {
      if (!reason) next.reason_code = 'Pilih alasan penyesuaian.'
      if (reason === 'OTHER' && !note.trim()) next.note = 'Jelaskan alasan pada catatan.'
    }
    setErrors(next)
    if (Object.keys(next).length === 0) save.mutate()
  }

  function reset() {
    save.reset()
    setProduct(null)
    setPicked(true)
    setQuantity('')
    setReason('')
    setNote('')
    setErrors({})
  }

  const err = save.error
  const insufficient = err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK'
  const generic = err && !insufficient && Object.keys(fieldErrors(err)).length === 0

  return (
    <div className="animate-rise">
      <Link to="/inventory" className="mb-5 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-ink-900">
        <ArrowLeft className="size-4" aria-hidden /> Inventaris
      </Link>
      <PageHeader eyebrow={c.eyebrow} title={c.title}>{c.lead}</PageHeader>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {save.data ? (
          <Success res={save.data} mode={mode} onAgain={reset} />
        ) : (
          <form onSubmit={submit} noValidate className="space-y-6 rounded-md bg-white p-6 ring-1 ring-paper-300 sm:p-8">
            {insufficient && (
              <Alert tone="danger" title="Stok tidak mencukupi">
                Tersedia {formatQuantity(String(err.details?.['available'] ?? '0'), selected?.unit)}, diminta{' '}
                {formatQuantity(String(err.details?.['requested'] ?? '0'), selected?.unit)}. Tidak ada perubahan yang disimpan.
              </Alert>
            )}
            {generic && <Alert tone="danger">{err instanceof ApiError ? err.message : 'Gagal menyimpan. Coba lagi.'}</Alert>}

            <ProductPicker
              value={selected}
              onChange={(p) => {
                setProduct(p)
                setPicked(true)
                setErrors((x) => ({ ...x, product_id: undefined, quantity: undefined }))
                save.reset()
              }}
              error={errors.product_id}
            />

            {mode === 'adjust' && (
              <fieldset>
                <legend className="mb-1.5 text-sm font-semibold text-ink-800">Arah penyesuaian</legend>
                <div role="radiogroup" className="grid grid-cols-2 gap-2">
                  {([
                    { v: 'OUT', label: 'Stok keluar', Icon: ArrowUpFromLine },
                    { v: 'IN', label: 'Stok masuk', Icon: ArrowDownToLine },
                  ] as const).map(({ v, label, Icon }) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={direction === v}
                      onClick={() => setDirection(v)}
                      className={cn(
                        'flex h-11 items-center justify-center gap-2 rounded-sm text-sm font-semibold ring-1 ring-inset transition-colors',
                        direction === v ? 'bg-daun-700 text-white ring-daun-700 shadow-(--shadow-glow)' : 'bg-white text-ink-800 ring-paper-300 hover:ring-paper-400',
                      )}
                    >
                      <Icon className="size-4" aria-hidden /> {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <TextField
              label={`Jumlah${selected ? ` (${selected.unit})` : ''}`}
              inputMode="decimal"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value)
                setErrors((x) => ({ ...x, quantity: undefined }))
              }}
              error={errors.quantity}
              helper={selected ? (selected.unit_scale === 0 ? 'Bilangan bulat.' : `Hingga ${selected.unit_scale} angka di belakang koma.`) : undefined}
            />

            {mode === 'adjust' && <ReasonPicker value={reason} onChange={(r) => { setReason(r); setErrors((x) => ({ ...x, reason_code: undefined })) }} error={errors.reason_code} />}

            <TextField
              label="Catatan"
              aside={mode === 'adjust' && reason === 'OTHER' ? 'Wajib' : 'Opsional'}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setErrors((x) => ({ ...x, note: undefined }))
              }}
              error={errors.note}
              maxLength={500}
              placeholder={mode === 'restock' ? 'mis. Kiriman Supplier Pak Budi' : 'mis. Kemasan bocor saat dibongkar'}
            />

            <div className="flex items-center justify-between gap-4 border-t border-paper-300 pt-6">
              <p className="text-[0.8125rem] text-text-muted">Dicatat atas nama {me?.user.name}.</p>
              <Button type="submit" size="lg" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : <c.Icon className="size-4" aria-hidden />}
                {save.isPending ? 'Menyimpan…' : c.submit}
              </Button>
            </div>
          </form>
        )}

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <StockPreview product={save.data ? null : selected} quantity={quantity} direction={mode === 'restock' ? 'IN' : direction} />
        </aside>
      </div>
    </div>
  )
}
