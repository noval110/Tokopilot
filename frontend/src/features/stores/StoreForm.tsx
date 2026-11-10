import { type FormEvent, type ReactNode, useId } from 'react'
import { Receipt, ReceiptRow } from '@/components/ui/Receipt'
import { TextField } from '@/components/ui/Field'
import { cn } from '@/lib/cn'
import { formatStoreDate, timezoneLabel } from '@/lib/format'
import { type StoreTimezone, TIMEZONES } from '@/services/auth'
import type { StoreFormErrors, StoreFormValues } from './storeValidation'

/** Timezone picker as cards: the zone decides where a business day starts and ends (BR-13). */
function TimezonePicker({
  value,
  onChange,
  error,
}: {
  value: StoreTimezone
  onChange: (tz: StoreTimezone) => void
  error?: string | undefined
}) {
  const name = useId()
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold text-ink-800">Zona waktu toko</legend>
      <div className="grid grid-cols-3 gap-2">
        {TIMEZONES.map((tz) => (
          <label
            key={tz.value}
            className={cn(
              'group relative cursor-pointer rounded-sm bg-white p-3 ring-1 ring-inset transition-shadow',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-daun-600',
              value === tz.value ? 'ring-2 ring-daun-700' : 'ring-paper-300 hover:ring-paper-400',
            )}
          >
            <input
              type="radio"
              name={name}
              value={tz.value}
              checked={value === tz.value}
              onChange={() => onChange(tz.value)}
              aria-label={`${tz.label}, ${tz.city}`}
              className="sr-only"
            />
            <span className="num block text-base font-bold text-ink-900">{tz.label}</span>
            <span className="mt-0.5 block text-[0.6875rem] leading-snug text-text-muted">{tz.city}</span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-[0.8125rem] text-text-muted">
        {error ?? 'Menentukan kapan satu hari penjualan dimulai dan berakhir di laporan.'}
      </p>
    </fieldset>
  )
}

/** Live "kop nota" preview: what the store header will look like on receipts. */
export function ReceiptPreview({
  values,
  now,
  onDark = false,
}: {
  values: StoreFormValues
  now: Date
  onDark?: boolean
}) {
  return (
    <figure aria-label="Pratinjau kop nota" className="w-full max-w-xs">
      <figcaption className={cn('eyebrow mb-3', onDark ? 'text-ink-300' : 'text-text-muted')}>Pratinjau kop nota</figcaption>
      <Receipt className="rotate-[-1.5deg] rounded-t-sm">
        <div className="text-center">
          <div className="font-display text-lg leading-tight font-bold break-words">
            {values.name.trim() || <span className="text-text-subtle">Nama tokomu</span>}
          </div>
          <div className="mt-1 text-[0.75rem] leading-snug break-words text-text-muted">
            {values.address.trim() || <span className="text-text-subtle">Alamat toko (opsional)</span>}
          </div>
        </div>
        <div className="my-4 border-t border-dashed border-paper-300" />
        <ReceiptRow label="Tanggal" value={formatStoreDate(now, values.timezone).replace(/^\w+, /, '')} muted />
        <ReceiptRow label="Zona" value={timezoneLabel(values.timezone)} muted />
        <ReceiptRow label="Mata uang" value="IDR" muted />
        <div className="my-4 border-t border-dashed border-paper-300" />
        <p className="num text-center text-[0.6875rem] text-text-subtle">belum ada transaksi</p>
      </Receipt>
    </figure>
  )
}

export function StoreFields({
  values,
  errors,
  onChange,
}: {
  values: StoreFormValues
  errors: StoreFormErrors
  onChange: (patch: Partial<StoreFormValues>) => void
}) {
  return (
    <>
      <TextField
        label="Nama toko"
        value={values.name}
        onChange={(e) => onChange({ name: e.target.value })}
        error={errors.name}
        maxLength={100}
        placeholder="mis. Warung Bu Sari"
      />
      <TextField
        label="Alamat"
        aside="Opsional"
        value={values.address}
        onChange={(e) => onChange({ address: e.target.value })}
        error={errors.address}
        maxLength={500}
        placeholder="Jl. Melati No. 3, Bandung"
      />
      <TimezonePicker value={values.timezone} onChange={(timezone) => onChange({ timezone })} error={errors.timezone} />
    </>
  )
}

export function FormShell({ onSubmit, children }: { onSubmit: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {children}
    </form>
  )
}
