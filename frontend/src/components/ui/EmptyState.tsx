import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Empty state drawn on ruled ledger paper: an empty page in the store's book,
 * not a sad illustration.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'ledger-lines relative overflow-hidden rounded-md border border-dashed border-paper-300 bg-paper-50 px-6 py-12 text-center',
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-10 hidden w-px bg-daun-600/25 sm:block"
      />
      <div className="relative mx-auto flex max-w-md flex-col items-center">
        <div className="mb-4 grid size-12 place-items-center rounded-sm bg-white text-ink-700 shadow-paper ring-1 ring-paper-300">
          {icon}
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        {children && <div className="mt-1.5 text-sm text-text-muted">{children}</div>}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  )
}
