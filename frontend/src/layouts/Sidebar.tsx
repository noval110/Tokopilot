import { ChevronsLeft, ChevronsRight, House, LogOut, Store, X } from 'lucide-react'
import { Link, NavLink } from 'react-router'
import { navGroups } from '@/app/modules'
import { Logo, LogoMark } from '@/components/brand/Logo'
import { cn } from '@/lib/cn'
import { timezoneLabel } from '@/lib/format'
import type { Membership, User } from '@/services/auth'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed?: () => void
  onClose?: () => void
  onLogout: () => void
  loggingOut?: boolean
  variant: 'desktop' | 'drawer'
  user: User
  membership: Membership
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export function Sidebar({ collapsed, onToggleCollapsed, onClose, onLogout, loggingOut, variant, user, membership }: SidebarProps) {
  const compact = variant === 'desktop' && collapsed
  const isOwner = membership.role === 'OWNER'
  // Staff never see owner-only entries. The API rejects them regardless.
  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => isOwner || i.access !== 'owner') }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="flex h-full flex-col bg-paper-50 text-ink-800 [background-image:var(--grain)]">
      <div className={cn('flex h-16 items-center px-4', compact ? 'justify-center' : 'justify-between')}>
        <Link to="/" onClick={onClose} aria-label="TokoPilot, ke halaman depan" className="rounded-sm">
          {compact ? <LogoMark className="size-9" /> : <Logo />}
        </Link>
        {variant === 'drawer' && (
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-sm border-2 border-ink-900 bg-white text-ink-900 hover:bg-kunyit-50"
            aria-label="Tutup menu"
          >
            <X className="size-5" />
          </button>
        )}
      </div>

      <div className={cn('px-3 pb-3', compact && 'px-2')}>
        <div
          className={cn(
            'sign-sm flex items-center gap-3 bg-kunyit-300 py-2.5',
            compact ? 'justify-center px-0' : 'px-3',
          )}
          title={compact ? membership.store.name : undefined}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-xs border-2 border-ink-900 bg-paper-50 text-ink-900">
            <Store className="size-4" aria-hidden />
          </span>
          {!compact && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[0.875rem] font-semibold text-ink-900">{membership.store.name}</div>
              <div className="mt-0.5 text-[0.75rem] font-semibold text-ink-800">
                {isOwner ? 'Owner' : 'Staf'} · {timezoneLabel(membership.store.timezone)}
              </div>
            </div>
          )}
        </div>
      </div>

      <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mt-4 first:mt-1">
            {compact ? (
              <div aria-hidden className="mx-auto mb-2 h-0.5 w-6 bg-ink-900/20" />
            ) : (
              <div className="eyebrow mb-1.5 px-2.5 text-[0.6875rem] text-text-subtle">{group.label}</div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.id}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/sales'}
                    onClick={onClose}
                    title={compact ? item.nav : undefined}
                    aria-label={compact ? item.nav : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex h-10 items-center gap-3 rounded-sm border-2 text-[0.9375rem] font-semibold transition-[background-color,transform,box-shadow] duration-200 ease-(--ease-spring)',
                        compact ? 'justify-center px-0' : 'px-2.5',
                        isActive
                          ? '-rotate-1 border-ink-900 bg-kunyit-300 text-ink-900 shadow-(--shadow-glow)'
                          : 'border-transparent text-ink-800 hover:translate-x-1 hover:bg-paper-200/70 hover:text-ink-900',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          aria-hidden
                          className={cn('size-[1.1rem] shrink-0 transition-transform duration-300 ease-(--ease-spring) group-hover:-rotate-12', isActive ? 'text-ink-900' : 'text-ink-600')}
                        />
                        {!compact && <span className="truncate">{item.nav}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t-2 border-ink-900/10 p-3">
        {/* Back to the public landing page (the app keeps the session). */}
        <Link
          to="/"
          onClick={onClose}
          title={compact ? 'Halaman depan' : undefined}
          aria-label={compact ? 'Halaman depan' : undefined}
          className={cn(
            'group flex h-9 w-full items-center gap-3 rounded-sm border-2 border-transparent text-[0.875rem] font-semibold text-ink-800 transition-colors hover:border-ink-900 hover:bg-kunyit-300',
            compact ? 'justify-center' : 'px-2.5',
          )}
        >
          <House className="size-4 transition-transform duration-300 ease-(--ease-spring) group-hover:-rotate-12" aria-hidden />
          {!compact && <span>Halaman depan</span>}
        </Link>
        <div className={cn('flex items-center gap-3 py-1.5', compact ? 'justify-center' : 'px-1')}>
          <span
            className="grid size-9 shrink-0 place-items-center rounded-sm border-2 border-ink-900 bg-terpal-200 text-[0.75rem] font-black text-ink-900"
            title={compact ? user.name : undefined}
            aria-hidden={!compact}
          >
            {initials(user.name)}
          </span>
          {!compact && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[0.875rem] font-semibold text-ink-900">{user.name}</div>
              <div className="truncate text-[0.75rem] text-text-subtle">{user.email}</div>
            </div>
          )}
          {!compact && (
            <button
              type="button"
              onClick={onLogout}
              disabled={loggingOut}
              className="grid size-9 place-items-center rounded-sm text-ink-600 hover:bg-cabe-50 hover:text-cabe-800 disabled:opacity-50"
              aria-label="Keluar"
              title="Keluar"
            >
              <LogOut className="size-4" />
            </button>
          )}
        </div>
        {compact && (
          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            className="flex h-9 w-full items-center justify-center rounded-sm text-ink-600 hover:bg-cabe-50 hover:text-cabe-800"
            aria-label="Keluar"
            title="Keluar"
          >
            <LogOut className="size-4" />
          </button>
        )}
        {variant === 'desktop' && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            className={cn(
              'flex h-9 w-full items-center gap-3 rounded-sm text-[0.8125rem] font-semibold text-text-subtle hover:bg-paper-200/70 hover:text-ink-900',
              compact ? 'justify-center' : 'px-2.5',
            )}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {!compact && <span>Ciutkan</span>}
          </button>
        )}
      </div>
    </div>
  )
}
