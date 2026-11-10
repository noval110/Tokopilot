import { vi } from 'vitest'
import type { Me, Membership } from '@/services/auth'

type Req = { method: string; path: string; search: URLSearchParams; body: unknown; headers: Record<string, string> }
type Handler = (req: Req) => {
  status?: number
  body?: unknown
}

/**
 * Stubs global fetch with a tiny router keyed by "METHOD /path" (path without
 * the /api/v1 prefix and query string). Unmatched calls fail loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Req[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const req = { method, path, search: url.searchParams, body, headers }
    calls.push(req)
    // Exact match first, then a ":id" pattern match (e.g. "GET /products/:id").
    const handler =
      routes[`${method} ${path}`] ??
      Object.entries(routes).find(([k]) => {
        const [m, p] = k.split(' ')
        if (m !== method || !p?.includes(':')) return false
        return new RegExp(`^${p.replace(/:[^/]+/g, '[^/]+')}$`).test(path)
      })?.[1]
    if (!handler) throw new Error(`Unmocked API call: ${method} ${path}`)
    const { status = 200, body: resBody } = handler(req)
    if (status === 204) return new Response(null, { status })
    return new Response(JSON.stringify(resBody ?? {}), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

export const unauthenticated = () => ({
  status: 401,
  body: { error: { code: 'UNAUTHENTICATED', message: 'Silakan masuk terlebih dahulu.', request_id: 'req_test' } },
})

export const ownerMembership: Membership = {
  role: 'OWNER',
  store: { id: 'store-a', name: 'Warung Bu Sari', timezone: 'Asia/Jakarta', currency: 'IDR', address: null },
}

export const ownerMe: Me = { user: { id: 'u1', name: 'Sari Wulandari', email: 'sari@warung.id' }, membership: ownerMembership }
export const staffMe: Me = {
  user: { id: 'u2', name: 'Andi Kasir', email: 'andi@warung.id' },
  membership: { ...ownerMembership, role: 'STAFF' },
}
export const noStoreMe: Me = { user: { id: 'u3', name: 'Budi Baru', email: 'budi@toko.id' }, membership: null }
