import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

const tones = {
  danger: { cls: 'bg-danger-50 text-danger-800 ring-danger-200', Icon: XCircle },
  warning: { cls: 'bg-warn-50 text-warn-800 ring-warn-200', Icon: AlertTriangle },
  positive: { cls: 'bg-daun-50 text-daun-900 ring-daun-200', Icon: CheckCircle2 },
  info: { cls: 'bg-paper-100 text-ink-800 ring-paper-300', Icon: Info },
}

/** Inline message. Errors are announced to screen readers (role=alert). */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof tones
  title?: string
  children?: ReactNode
  className?: string
}) {
  const { cls, Icon } = tones[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-sm px-4 py-3 text-sm ring-1 ring-inset', cls, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  )
}
