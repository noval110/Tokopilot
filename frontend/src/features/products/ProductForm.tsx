import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save } from 'lucide-react'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Loader'
import { RupiahField } from '@/components/ui/RupiahField'
import { SelectField } from '@/components/ui/Select'
import { ApiError, fieldErrors } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatIDR } from '@/lib/format'
import { catalogApi, catalogKeys, UNIT_PRESETS } from '@/services/catalog'
import { PriceTag } from './PriceTag'
import { margin, type ProductFormErrors, type ProductFormValues, validateProduct } from './productModel'

const NEW_CATEGORY = '__new__'
const SCALE_LABELS = ['Bulat (0)', '1 desimal', '2 desimal', '3 desimal']

function Section({ n, title, hint, children }: { n: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-paper-300 pt-6 first:border-t-0 first:pt-0">
      <legend className="contents">
        <span className="flex items-baseline gap-3">
          <span className="num text-sm font-semibold text-daun-700">{n}</span>
          <span className="font-display text-lg font-bold text-ink-900">{title}</span>
        </span>
      </legend>
      {hint && <p className="mt-1 text-[0.8125rem] text-text-muted">{hint}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </fieldset>
  )
}

function CategoryPicker({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (id: string) => void
  error?: string | undefined
}) {
  const qc = useQueryClient()
  const categories = useQuery({ queryKey: catalogKeys.categories, queryFn: () => catalogApi.categories() })
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => catalogApi.createCategory(name),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: catalogKeys.categories })
      onChange(c.id)
      setAdding(false)
      setName('')
    },
  })
  const createError = create.error ? (fieldErrors(create.error)['name'] ?? (create.error instanceof ApiError ? create.error.message : 'Gagal menambah kategori.')) : undefined

  if (adding) {
    return (
      <div className="rounded-sm bg-paper-100 p-3 ring-1 ring-paper-300">
        <TextField
          label="Kategori baru"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={createError}
          maxLength={60}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (name.trim()) create.mutate()
            }
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setAdding(false); create.reset() }}>
            Batal
          </Button>
          <Button size="sm" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner /> : <Plus className="size-4" aria-hidden />} Tambah
          </Button>
        </div>
      </div>
    )
  }

  return (
    <SelectField
      label="Kategori"
      value={value}
      error={error}
      disabled={categories.isPending}
      onChange={(e) => (e.target.value === NEW_CATEGORY ? setAdding(true) : onChange(e.target.value))}
    >
      <option value="">Tanpa kategori</option>
      {categories.data?.data.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value={NEW_CATEGORY}>＋ Kategori baru…</option>
    </SelectField>
  )
}

export function ProductForm({
  initial,
  creating,
  submitLabel,
  pending,
  error,
  onSubmit,
  currentStockNote,
  categoryName,
}: {
  initial: ProductFormValues
  creating: boolean
  submitLabel: string
  pending: boolean
  error: unknown
  onSubmit: (v: ProductFormValues) => void
  /** Edit mode: read-only current stock, which only changes via the ledger. */
  currentStockNote?: ReactNode
  categoryName?: (id: string) => string | undefined
}) {
  const unitListId = useId()
  const [values, setValues] = useState(initial)
  const [localErrors, setLocalErrors] = useState<ProductFormErrors>({})
  const [scaleTouched, setScaleTouched] = useState(!creating)

  // Server field errors disappear for a field once the user edits it.
  const [cleared, setCleared] = useState<{ err: unknown; keys: string[] }>({ err: null, keys: [] })
  const clearedKeys = cleared.err === error ? cleared.keys : []
  const allServerErrors = fieldErrors(error) as ProductFormErrors
  const serverErrors = Object.fromEntries(
    Object.entries(allServerErrors).filter(([k]) => !clearedKeys.includes(k)),
  ) as ProductFormErrors
  const errors: ProductFormErrors = { ...serverErrors, ...localErrors }
  const generic = Boolean(error) && Object.keys(allServerErrors).length === 0

  const set = (patch: Partial<ProductFormValues>) => {
    setValues((v) => ({ ...v, ...patch }))
    setLocalErrors((x) => ({ ...x, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) }))
    setCleared((c) => ({ err: error, keys: [...(c.err === error ? c.keys : []), ...Object.keys(patch)] }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = validateProduct(values, creating)
    setLocalErrors(v)
    if (Object.keys(v).length === 0) onSubmit(values)
  }

  const m = margin(values.cost_price, values.selling_price)
  const scaleHint =
    values.unit_scale === 0 ? 'Kuantitas bulat, mis. 3' : `Hingga ${values.unit_scale} angka di belakang koma, mis. 2,5`

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="space-y-6 rounded-md bg-white p-6 ring-1 ring-paper-300 sm:p-8">
        {generic && (
          <Alert tone="danger">{error instanceof ApiError ? error.message : 'Gagal menyimpan. Coba lagi.'}</Alert>
        )}

        <Section n="01" title="Identitas">
          <TextField label="Nama produk" value={values.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} maxLength={150} placeholder="mis. Kopi Arabica 250g" />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="SKU"
              aside="Opsional"
              value={values.sku}
              onChange={(e) => set({ sku: e.target.value })}
              error={errors.sku}
              maxLength={64}
              className="[&_input]:font-mono [&_input]:uppercase"
              helper="Unik di toko ini. Disimpan huruf besar."
            />
            <CategoryPicker value={values.category_id} onChange={(category_id) => set({ category_id })} error={errors.category_id} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <TextField
                label="Satuan"
                list={unitListId}
                value={values.unit}
                onChange={(e) => {
                  const unit = e.target.value
                  const preset = UNIT_PRESETS.find((p) => p.unit === unit.trim().toLowerCase())
                  set(preset && !scaleTouched ? { unit, unit_scale: preset.scale } : { unit })
                }}
                error={errors.unit}
                maxLength={20}
              />
              <datalist id={unitListId}>
                {UNIT_PRESETS.map((p) => (
                  <option key={p.unit} value={p.unit} />
                ))}
              </datalist>
            </div>
            <SelectField
              label="Desimal kuantitas"
              value={String(values.unit_scale)}
              error={errors.unit_scale}
              helper={scaleHint}
              onChange={(e) => {
                setScaleTouched(true)
                set({ unit_scale: Number(e.target.value) })
              }}
            >
              {SCALE_LABELS.map((l, i) => (
                <option key={l} value={i}>
                  {l}
                </option>
              ))}
            </SelectField>
          </div>
        </Section>

        <Section n="02" title="Harga" hint="Rupiah bulat. Harga saat checkout selalu diambil dari sini oleh server.">
          <div className="grid gap-5 sm:grid-cols-2">
            <RupiahField label="Harga modal" value={values.cost_price} onChange={(cost_price) => set({ cost_price })} error={errors.cost_price} />
            <RupiahField label="Harga jual" value={values.selling_price} onChange={(selling_price) => set({ selling_price })} error={errors.selling_price} />
          </div>
          {m && (
            <div
              role="status"
              className={cn(
                'flex items-center justify-between rounded-sm px-4 py-3 text-sm ring-1 ring-inset',
                m.amount < 0 ? 'bg-warn-50 text-warn-800 ring-warn-200' : 'bg-paper-100 text-ink-800 ring-paper-300',
              )}
            >
              <span>{m.amount < 0 ? 'Harga jual di bawah modal' : 'Margin per satuan'}</span>
              <span className="num font-semibold">
                {m.amount < 0 ? '−' : ''}
                {formatIDR(Math.abs(m.amount))}
                {m.pct !== null && <span className="ml-2 font-normal text-text-muted">({m.pct.toLocaleString('id-ID')}%)</span>}
              </span>
            </div>
          )}
        </Section>

        <Section n="03" title="Stok" hint="Stok rendah ditandai saat stok ≤ stok minimum.">
          <div className="grid gap-5 sm:grid-cols-2">
            {creating ? (
              <TextField
                label="Stok awal"
                inputMode="decimal"
                value={values.initial_stock}
                onChange={(e) => set({ initial_stock: e.target.value })}
                error={errors.initial_stock}
                placeholder="0"
                helper="Dicatat sebagai mutasi INITIAL di buku besar."
              />
            ) : (
              currentStockNote
            )}
            <TextField
              label="Stok minimum"
              inputMode="decimal"
              value={values.min_stock}
              onChange={(e) => set({ min_stock: e.target.value })}
              error={errors.min_stock}
              placeholder="0"
            />
          </div>
        </Section>

        <div className="flex justify-end border-t border-paper-300 pt-6">
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? <Spinner /> : <Save className="size-4" aria-hidden />}
            {pending ? 'Menyimpan…' : submitLabel}
          </Button>
        </div>
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <PriceTag
            name={values.name}
            price={values.selling_price}
            unit={values.unit}
            sku={values.sku}
            category={categoryName?.(values.category_id)}
          />
        </div>
      </aside>
    </form>
  )
}
