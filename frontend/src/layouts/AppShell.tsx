import { useMutation } from '@tanstack/react-query'
import { Menu, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { findModule } from '@/app/modules'
import { useMe, useResetSession } from '@/app/session'
import { authApi } from '@/services/auth'
import { ButtonLink } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { formatStoreDate, timezoneLabel } from '@/lib/format'
import { Sidebar } from './Sidebar'

const COLLAPSE_KEY = 'tokopilot.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell({ now = () => new Date() }: { now?: () => Date }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { data: me } = useMe()
  const resetSession = useResetSession()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  const match = findModule(location.pathname)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* storage unavailable (private mode) — preference just isn't remembered */
    }
  }, [collapsed])

  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    drawerRef.current?.querySelector<HTMLElement>('button, a')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDrawerOpen(false)
      menuButtonRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen])

  // Even if the request fails (e.g. offline) the local session is cleared.
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      resetSession()
      navigate('/login', { replace: true })
    },
  })

  function closeDrawer() {
    setDrawerOpen(false)
    menuButtonRef.current?.focus()
  }

  if (!me?.membership) return <Navigate to="/onboarding/store" replace />
  const { user, membership } = me
  const sidebarProps = { user, membership, onLogout: () => logout.mutate(), loggingOut: logout.isPending }

  return (
    <div className="min-h-dvh bg-paper-50 [background-image:var(--grain)]">
      <a
        href="#konten"
        className="sr-only z-50 rounded-sm border-2 border-ink-900 bg-kunyit-300 text-ink-900 px-3 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Lewati ke konten
      </a>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden border-r-2 border-ink-900 transition-[width] duration-200 ease-(--ease-ledger) lg:block print:hidden',
          collapsed ? 'w-[4.5rem]' : 'w-64',
        )}
      >
        <Sidebar
          {...sidebarProps}
          variant="desktop"
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-950/50"
            onClick={closeDrawer}
            aria-hidden
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi"
            className="animate-rise absolute inset-y-0 left-0 w-[min(18rem,85vw)] border-r-2 border-ink-900 shadow-sign"
          >
            <Sidebar {...sidebarProps} variant="drawer" collapsed={false} onClose={closeDrawer} />
          </div>
        </div>
      )}

      <div
        className={cn(
          'transition-[padding] duration-200 ease-(--ease-ledger)',
          collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-64',
          'print:pl-0',
        )}
      >
        <header className="sticky top-0 z-20 border-b-2 border-ink-900 bg-paper-50 print:hidden">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="press grid size-10 place-items-center rounded-sm border-2 border-ink-900 bg-white text-ink-900 shadow-(--shadow-glow) lg:hidden"
              aria-label="Buka menu"
              aria-expanded={drawerOpen}
            >
              <Menu className="size-5" />
            </button>

            <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
              <ol className="flex items-center gap-2 text-sm">
                {match?.group && (
                  <li className="eyebrow hidden text-text-subtle sm:block">{match.group.label}</li>
                )}
                {match?.group && (
                  <li aria-hidden className="hidden text-paper-400 sm:block">
                    /
                  </li>
                )}
                <li className="truncate font-bold text-ink-900" aria-current="page">
                  {match?.module.title ?? 'TokoPilot'}
                </li>
              </ol>
            </nav>

            <div className="hidden text-right leading-tight md:block">
              <div className="text-[0.8125rem] font-medium text-ink-800">
                {formatStoreDate(now(), membership.store.timezone)}
              </div>
              <div className="text-[0.75rem] text-text-subtle">
                Zona toko · {timezoneLabel(membership.store.timezone)}
              </div>
            </div>

            <ButtonLink to="/sales/new" size="sm" className="ml-1">
              <Plus className="size-4" aria-hidden />
              <span className="hidden sm:inline">Transaksi baru</span>
              <span className="sm:hidden">Kasir</span>
            </ButtonLink>
          </div>
        </header>

        <main id="konten" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none sm:px-6 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
