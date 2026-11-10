import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Paper receipt surface with a perforated bottom edge. */
export function Receipt({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'receipt-edge relative bg-paper-50 px-5 pt-5 text-ink-900 shadow-lift',
        'bg-[radial-gradient(circle_at_20%_0%,rgb(255_255_255/0.9),transparent_60%)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function ReceiptRow({
  label,
  value,
  strong,
  muted,
}: {
  label: ReactNode
  value: ReactNode
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-baseline gap-2 text-[0.8125rem]',
        strong && 'text-[0.9375rem] font-bold',
        muted && 'text-text-muted',
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span aria-hidden className="leader" />
      <span className="num shrink-0">{value}</span>
    </div>
  )
}
