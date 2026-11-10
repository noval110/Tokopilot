import { ChevronDown } from 'lucide-react'
import { type ComponentProps, type ReactNode, useId } from 'react'
import { cn } from '@/lib/cn'

const base =
  'h-11 w-full appearance-none rounded-sm bg-white pr-9 pl-3 text-[0.9375rem] text-ink-900 ring-1 ring-inset ' +
  'focus:outline-none focus:ring-2 disabled:bg-paper-100'

/** Native select styled to match fields (native = best keyboard & mobile support). */
export function SelectField({
  label,
  error,
  helper,
  className,
  children,
  hideLabel,
  ...props
}: Omit<ComponentProps<'select'>, 'id'> & {
  label: string
  error?: string | undefined
  helper?: ReactNode
  hideLabel?: boolean
}) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className={cn('mb-1.5 block text-sm font-semibold text-ink-800', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(base, error ? 'ring-danger-600 focus:ring-danger-600' : 'ring-ink-900/55 hover:ring-ink-900/80 focus:ring-daun-600')}
          {...props}
        >
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-subtle" />
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[0.8125rem] font-medium text-danger-600">
          {error}
        </p>
      )}
      {helper && !error && <div className="mt-1.5 text-[0.8125rem] text-text-muted">{helper}</div>}
    </div>
  )
}
