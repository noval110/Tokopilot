import { type ReactNode, useId } from 'react'
import { cn } from '@/lib/cn'

const group = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

/**
 * Integer-rupiah input. Shows thousand separators while typing and emits a
 * safe integer (or null when empty). Decimals cannot be entered at all (BR-08).
 */
export function RupiahField({
  label,
  value,
  onChange,
  error,
  helper,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  error?: string | undefined
  helper?: ReactNode
}) {
  const id = useId()
  const describedBy = [error && `${id}-error`, helper && `${id}-helper`].filter(Boolean).join(' ') || undefined
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink-800">
        {label}
      </label>
      <div
        className={cn(
          'flex h-11 items-center rounded-sm bg-white ring-1 ring-inset transition-shadow focus-within:ring-2',
          error ? 'ring-danger-600 focus-within:ring-danger-600' : 'ring-ink-900/55 hover:ring-ink-900/80 focus-within:ring-daun-600',
        )}
      >
        <span aria-hidden className="num pl-3 text-sm text-text-subtle">
          Rp
        </span>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          value={value === null ? '' : group.format(value)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 13)
            onChange(digits === '' ? null : Number(digits))
          }}
          className="num h-full w-full bg-transparent px-2 text-right text-[0.9375rem] text-ink-900 focus:outline-none"
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[0.8125rem] font-medium text-danger-600">
          {error}
        </p>
      )}
      {helper && !error && (
        <div id={`${id}-helper`} className="mt-1.5 text-[0.8125rem] text-text-muted">
          {helper}
        </div>
      )}
    </div>
  )
}
