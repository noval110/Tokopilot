import { Eye, EyeOff } from 'lucide-react'
import { type ComponentProps, type ReactNode, useId, useState } from 'react'
import { cn } from '@/lib/cn'

interface FieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: string
  helper?: ReactNode
  error?: string | undefined
  /** Optional element on the label row, e.g. "Opsional". */
  aside?: ReactNode
}

const inputBase =
  'block h-11 w-full rounded-sm bg-white px-3 text-[0.9375rem] text-ink-900 ring-1 ring-inset ' +
  'placeholder:text-text-subtle transition-shadow focus:outline-none focus:ring-2 disabled:bg-paper-100'

/** Text input with label, helper text and field-level error (NFR-14). */
export function TextField({ label, helper, error, aside, className, type = 'text', ...props }: FieldProps) {
  const id = useId()
  const [reveal, setReveal] = useState(false)
  const isPassword = type === 'password'
  const describedBy = [error && `${id}-error`, helper && `${id}-helper`].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink-800">
          {label}
        </label>
        {aside && <span className="text-xs text-text-subtle">{aside}</span>}
      </div>
      <div className="relative">
        <input
          id={id}
          type={isPassword && reveal ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            inputBase,
            isPassword && 'pr-11',
            error ? 'ring-danger-600 focus:ring-danger-600' : 'ring-ink-900/55 hover:ring-ink-900/80 focus:ring-daun-600',
          )}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-text-subtle hover:text-ink-800"
            aria-label={reveal ? 'Sembunyikan password' : 'Tampilkan password'}
            aria-pressed={reveal}
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[0.8125rem] font-medium text-danger-600">
          {error}
        </p>
      )}
      {helper && !error && (
        <p id={`${id}-helper`} className="mt-1.5 text-[0.8125rem] text-text-muted">
          {helper}
        </p>
      )}
    </div>
  )
}
