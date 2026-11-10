import type { ReactNode } from 'react'

export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-paper-300 pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="eyebrow text-text-subtle">{eyebrow}</p>
        <h1 className="mt-3 text-[2rem] leading-[1.05] font-bold sm:text-[2.5rem]">{title}</h1>
        {children && <p className="mt-2 text-[0.9375rem] text-text-muted">{children}</p>}
      </div>
      {actions}
    </header>
  )
}
