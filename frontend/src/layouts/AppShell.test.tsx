import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modules, navGroups } from '@/app/modules'
import { implementedModuleIds } from '@/app/router'
import { mockApi, noStoreMe, ownerMe, staffMe, unauthenticated } from '@/test/api'
import { renderApp } from '@/test/render'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

const asOwner = () => mockApi({ 'GET /me': () => ({ body: ownerMe }) })

describe('AppShell (owner)', () => {
  it('renders the five PRD navigation groups in order with the real store name', async () => {
    asOwner()
    renderApp('/dashboard')
    const nav = await screen.findByRole('navigation', { name: 'Navigasi utama' })
    const text = nav.textContent ?? ''
    const positions = navGroups.map((g) => text.indexOf(g.label))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(screen.getByText('Warung Bu Sari')).toBeInTheDocument()
  })

  it('marks the active page and shows its breadcrumb', async () => {
    asOwner()
    renderApp('/inventory')
    const nav = await screen.findByRole('navigation', { name: 'Navigasi utama' })
    expect(within(nav).getByRole('link', { name: /Inventaris/ })).toHaveAttribute('aria-current', 'page')
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumb).getByText('Operasional')).toBeInTheDocument()
  })

  it('opens the mobile drawer as a dialog and closes it with Escape, restoring focus', async () => {
    asOwner()
    const user = userEvent.setup()
    renderApp('/dashboard')
    const trigger = await screen.findByRole('button', { name: 'Buka menu' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Menu navigasi' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('collapses the desktop sidebar and remembers the preference', async () => {
    asOwner()
    const user = userEvent.setup()
    renderApp('/dashboard')
    const toggle = await screen.findByRole('button', { name: 'Ciutkan sidebar' })
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Lebarkan sidebar' })).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem('tokopilot.sidebar.collapsed')).toBe('1')
  })

  it('logs out: revokes server-side, clears the cache and returns to login', async () => {
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'POST /auth/logout': () => ({ status: 204 }),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/dashboard')
    const nav = await screen.findByRole('navigation', { name: 'Navigasi utama' })
    const aside = nav.closest('aside') as HTMLElement
    await user.click(within(aside).getByRole('button', { name: 'Keluar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(calls.some((c) => c.method === 'POST' && c.path === '/auth/logout')).toBe(true)
  })
})

describe('way back to the landing page', () => {
  it('goes from the dashboard to the landing page, which then offers the way back in', async () => {
    const { fn } = mockApi({ 'GET /me': () => ({ body: ownerMe }) })
    const user = userEvent.setup()
    const { router } = renderApp('/dashboard')
    const nav = await screen.findByRole('navigation', { name: 'Navigasi utama' })
    const aside = nav.closest('aside') as HTMLElement
    await user.click(within(aside).getByRole('link', { name: 'Halaman depan' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    const calls = fn.mock.calls.length
    const back = within(screen.getByRole('navigation', { name: 'Navigasi situs' })).getByRole('link', { name: 'Ke dasbor' })
    expect(back).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByRole('link', { name: 'Masuk' })).not.toBeInTheDocument()
    expect(fn.mock.calls.length).toBe(calls) // the landing page reads the cache, no extra request
  })

  it('shows anonymous visitors the login button instead', () => {
    mockApi({})
    renderApp('/')
    expect(within(screen.getByRole('navigation', { name: 'Navigasi situs' })).getByRole('link', { name: 'Masuk' })).toHaveAttribute('href', '/login')
  })
})

describe('role-aware navigation (staff)', () => {
  it('hides owner-only entries from staff', async () => {
    mockApi({ 'GET /me': () => ({ body: staffMe }) })
    renderApp('/dashboard')
    const nav = await screen.findByRole('navigation', { name: 'Navigasi utama' })
    expect(within(nav).queryByText('Administrasi')).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Tim/ })).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Kasir/ })).toBeInTheDocument()
    expect(screen.getByText(/Staf · WIB/)).toBeInTheDocument()
  })

  it('shows an explanation when staff open an owner URL directly (API still enforces 403)', async () => {
    mockApi({ 'GET /me': () => ({ body: staffMe }) })
    renderApp('/settings/team')
    expect(await screen.findByRole('heading', { name: 'Halaman khusus owner' })).toBeInTheDocument()
  })
})

describe('route guards', () => {
  it('redirects anonymous users to login, preserving the target', async () => {
    mockApi({ 'GET /me': unauthenticated })
    const { router } = renderApp('/reports?range=7d')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe('?next=%2Freports%3Frange%3D7d')
  })

  it('sends users without a store to onboarding', async () => {
    mockApi({ 'GET /me': () => ({ body: noStoreMe }) })
    const { router } = renderApp('/dashboard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/store'))
  })

  it('keeps users with a store out of onboarding', async () => {
    asOwner()
    const { router } = renderApp('/onboarding/store')
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('bounces logged-in users away from the login page', async () => {
    asOwner()
    const { router } = renderApp('/login')
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })
})

describe('MVP completeness', () => {
  it('every PRD module route has a real screen (no Sprint placeholders left)', () => {
    expect(modules.map((m) => m.id).filter((id) => !implementedModuleIds.includes(id))).toEqual([])
  })
})

describe('public routes', () => {
  it('renders the landing page without calling the API', async () => {
    const { fn } = mockApi({})
    renderApp('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/kopilot/)
    expect(screen.getByRole('link', { name: /Buat akun toko/ })).toHaveAttribute('href', '/register')
    expect(fn).not.toHaveBeenCalled()
  })

  it('shows a friendly 404 for unknown routes', () => {
    mockApi({})
    renderApp('/tidak-ada')
    expect(screen.getByRole('heading', { name: /tidak ada di buku/ })).toBeInTheDocument()
  })
})
