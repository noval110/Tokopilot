import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ownerMe, ownerMembership } from '@/test/api'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const team = {
  data: [
    { user_id: 'u1', name: 'Sari Wulandari', email: 'sari@warung.id', role: 'OWNER', joined_at: '2026-11-01T02:00:00Z' },
    { user_id: 'u2', name: 'Andi Kasir', email: 'andi@warung.id', role: 'STAFF', joined_at: '2026-11-05T02:00:00Z' },
  ],
  meta: { page: 1, per_page: 50, total: 2 },
}

describe('StoreSettingsPage', () => {
  it('loads settings, saves a change and updates the sidebar store name', async () => {
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /settings/store': () => ({ body: ownerMembership.store }),
      'PATCH /settings/store': ({ body }) => ({ body: { ...ownerMembership.store, ...(body as object) } }),
    })
    const user = userEvent.setup()
    renderApp('/settings/store')

    const name = await screen.findByLabelText('Nama toko')
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled()
    await user.clear(name)
    await user.type(name, 'Warung Bu Sari Jaya')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText('Pengaturan toko tersimpan.')).toBeInTheDocument()
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch?.body).toMatchObject({ name: 'Warung Bu Sari Jaya', timezone: 'Asia/Jakarta' })
    const nav = screen.getByRole('navigation', { name: 'Navigasi utama' }).closest('aside') as HTMLElement
    await waitFor(() => expect(within(nav).getByText('Warung Bu Sari Jaya')).toBeInTheDocument())
  })

  it('warns before changing the timezone', async () => {
    mockApi({ 'GET /me': () => ({ body: ownerMe }), 'GET /settings/store': () => ({ body: ownerMembership.store }) })
    const user = userEvent.setup()
    renderApp('/settings/store')
    await user.click(await screen.findByRole('radio', { name: /WIT\b/ }))
    expect(screen.getByText('Zona waktu akan berubah')).toBeInTheDocument()
  })

  it('shows an error state when settings cannot be loaded', async () => {
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /settings/store': () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server.' } } }),
    })
    renderApp('/settings/store')
    expect(await screen.findByText('Pengaturan tidak dapat dimuat')).toBeInTheDocument()
  })
})

describe('TeamPage', () => {
  it('lists members with role stamps and adds a staff member', async () => {
    let members = [...team.data]
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /settings/team': () => ({ body: { data: members, meta: { ...team.meta, total: members.length } } }),
      'POST /settings/team': ({ body }) => {
        const b = body as { name: string; email: string }
        const m = { user_id: 'u9', name: b.name, email: b.email, role: 'STAFF', joined_at: '2026-11-10T02:00:00Z' }
        members = [...members, m]
        return { status: 201, body: m }
      },
    })
    const user = userEvent.setup()
    renderApp('/settings/team')

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Owner')).toBeInTheDocument()
    expect(within(table).getByText('Staf')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Nama'), 'Rina')
    await user.type(screen.getByLabelText('Email'), 'rina@warung.id')
    await user.type(screen.getByLabelText('Password awal'), 'kasir-12345')
    await user.click(screen.getByRole('button', { name: 'Tambah staf' }))

    expect(await screen.findByText('Rina ditambahkan sebagai staf.')).toBeInTheDocument()
    expect(await within(screen.getByRole('table')).findByText('Rina')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Rina', email: 'rina@warung.id', password: 'kasir-12345' })
  })
})
