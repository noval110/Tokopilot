import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeNext } from '@/lib/navigation'
import { mockApi, noStoreMe, ownerMe, ownerMembership, unauthenticated } from '@/test/api'
import { renderApp } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'tp_csrf=; Max-Age=0; path=/'
})

describe('safeNext', () => {
  it('accepts only same-site relative paths', () => {
    expect(safeNext('/reports?x=1')).toBe('/reports?x=1')
    expect(safeNext('//evil.example')).toBeUndefined()
    expect(safeNext('/\\evil.example')).toBeUndefined()
    expect(safeNext('https://evil.example')).toBeUndefined()
    expect(safeNext(null)).toBeUndefined()
  })
})

describe('LoginPage', () => {
  it('validates empty fields locally without calling login', async () => {
    const { calls } = mockApi({ 'GET /me': unauthenticated })
    const user = userEvent.setup()
    renderApp('/login')
    await user.click(await screen.findByRole('button', { name: 'Masuk' }))
    expect(screen.getByText('Email wajib diisi.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false)
  })

  it('shows the generic credentials error from the API', async () => {
    mockApi({
      'GET /me': unauthenticated,
      'POST /auth/login': () => ({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Email atau password salah.', request_id: 'r' } },
      }),
    })
    const user = userEvent.setup()
    renderApp('/login')
    await user.type(await screen.findByLabelText('Email'), 'sari@warung.id')
    await user.type(screen.getByLabelText('Password'), 'salah-sekali')
    await user.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email atau password salah.')
  })

  it('redirects to a safe ?next after login, ignoring open-redirect attempts', async () => {
    mockApi({ 'GET /me': unauthenticated, 'POST /auth/login': () => ({ body: ownerMe }) })
    const user = userEvent.setup()
    const { router } = renderApp('/login?next=%2F%2Fevil.example')
    await user.type(await screen.findByLabelText('Email'), 'sari@warung.id')
    await user.type(screen.getByLabelText('Password'), 'rahasia-123')
    await user.click(screen.getByRole('button', { name: 'Masuk' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('sends users without a store to onboarding after login', async () => {
    mockApi({ 'GET /me': unauthenticated, 'POST /auth/login': () => ({ body: noStoreMe }) })
    const user = userEvent.setup()
    const { router } = renderApp('/login?next=%2Freports')
    await user.type(await screen.findByLabelText('Email'), 'budi@toko.id')
    await user.type(screen.getByLabelText('Password'), 'rahasia-123')
    await user.click(screen.getByRole('button', { name: 'Masuk' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/store'))
  })
})

describe('RegisterPage', () => {
  it('maps EMAIL_TAKEN to the email field', async () => {
    mockApi({
      'GET /me': unauthenticated,
      'POST /auth/register': () => ({
        status: 409,
        body: {
          error: {
            code: 'EMAIL_TAKEN',
            message: 'Email sudah terdaftar.',
            details: { fields: { email: 'Email sudah terdaftar. Silakan masuk.' } },
            request_id: 'r',
          },
        },
      }),
    })
    const user = userEvent.setup()
    renderApp('/register')
    await user.type(await screen.findByLabelText('Nama lengkap'), 'Sari')
    await user.type(screen.getByLabelText('Email'), 'sari@warung.id')
    await user.type(screen.getByLabelText('Password'), 'rahasia-123')
    await user.click(screen.getByRole('button', { name: 'Buat akun' }))
    expect(await screen.findByText('Email sudah terdaftar. Silakan masuk.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('enforces the minimum password length before submitting', async () => {
    const { calls } = mockApi({ 'GET /me': unauthenticated })
    const user = userEvent.setup()
    renderApp('/register')
    await user.type(await screen.findByLabelText('Nama lengkap'), 'Sari')
    await user.type(screen.getByLabelText('Email'), 'sari@warung.id')
    await user.type(screen.getByLabelText('Password'), 'pendek')
    await user.click(screen.getByRole('button', { name: 'Buat akun' }))
    expect(screen.getByText('Password minimal 8 karakter.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/auth/register')).toBe(false)
  })

  it('continues to onboarding after creating the account', async () => {
    mockApi({ 'GET /me': unauthenticated, 'POST /auth/register': () => ({ status: 201, body: noStoreMe }) })
    const user = userEvent.setup()
    const { router } = renderApp('/register')
    await user.type(await screen.findByLabelText('Nama lengkap'), 'Budi Baru')
    await user.type(screen.getByLabelText('Email'), 'budi@toko.id')
    await user.type(screen.getByLabelText('Password'), 'rahasia-123')
    await user.click(screen.getByRole('button', { name: 'Buat akun' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/store'))
    expect(await screen.findByRole('heading', { name: 'Siapkan tokomu' })).toBeInTheDocument()
  })
})

describe('StoreSetupPage', () => {
  it('previews the receipt header live and creates the store with CSRF header', async () => {
    document.cookie = 'tp_csrf=csrf-token-123; path=/'
    const { calls } = mockApi({
      'GET /me': () => ({ body: noStoreMe }),
      'POST /stores': () => ({
        status: 201,
        body: { ...ownerMembership, store: { ...ownerMembership.store, name: 'Toko Budi', timezone: 'Asia/Makassar' } },
      }),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/onboarding/store')

    await user.type(await screen.findByLabelText('Nama toko'), 'Toko Budi')
    expect(screen.getAllByLabelText('Pratinjau kop nota')[0]).toHaveTextContent('Toko Budi')

    await user.click(screen.getByRole('radio', { name: /WITA/ }))
    expect(screen.getAllByLabelText('Pratinjau kop nota')[0]).toHaveTextContent('WITA')

    await user.click(screen.getByRole('button', { name: /Buat toko/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))

    const post = calls.find((c) => c.method === 'POST' && c.path === '/stores')
    expect(post?.body).toEqual({ name: 'Toko Budi', timezone: 'Asia/Makassar' })
    expect(post?.headers['X-CSRF-Token']).toBe('csrf-token-123')
    expect(await screen.findByText('Toko Budi')).toBeInTheDocument()
  })

  it('requires a store name', async () => {
    const { calls } = mockApi({ 'GET /me': () => ({ body: noStoreMe }) })
    const user = userEvent.setup()
    renderApp('/onboarding/store')
    await user.click(await screen.findByRole('button', { name: /Buat toko/ }))
    expect(screen.getByText('Nama toko wajib diisi.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/stores')).toBe(false)
  })
})
