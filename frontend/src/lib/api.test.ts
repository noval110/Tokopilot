import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './api'

function mockFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch', () => {
  it('uses same-origin credentials and the v1 prefix', async () => {
    const fn = mockFetch(async () => Response.json({ status: 'ok' }))
    await expect(apiFetch('/health')).resolves.toEqual({ status: 'ok' })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/health')
    expect(init.credentials).toBe('same-origin')
  })

  it('maps the PRD error envelope to ApiError', async () => {
    mockFetch(async () =>
      Response.json(
        {
          error: {
            code: 'INSUFFICIENT_STOCK',
            message: 'Stok produk tidak mencukupi.',
            details: { available: '1.000', requested: '2.000' },
            request_id: 'req_abc',
          },
        },
        { status: 409 },
      ),
    )
    const err = await apiFetch('/sales', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      requestId: 'req_abc',
      details: { available: '1.000' },
    })
  })

  it('never surfaces raw non-JSON error bodies', async () => {
    mockFetch(async () => new Response('<html>stack trace at line 42</html>', { status: 502 }))
    const err = (await apiFetch('/x').catch((e: unknown) => e)) as ApiError
    expect(err.code).toBe('UNEXPECTED_RESPONSE')
    expect(err.message).not.toContain('stack')
  })

  it('reports network failure with a friendly Indonesian message', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const err = (await apiFetch('/x').catch((e: unknown) => e)) as ApiError
    expect(err.code).toBe('NETWORK_ERROR')
    expect(err.status).toBe(0)
  })
})
