import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage } from '@/services/assistant'
import { mockApi, ownerMe, staffMe } from '@/test/api'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const CONV = '55555555-5555-4555-8555-555555555555'
const conv = { id: CONV, title: 'Berapa penjualan hari ini?', created_at: '2026-11-10T08:00:00Z', updated_at: '2026-11-10T08:00:00Z' }

const reply = (question: string, answer: string): [AssistantMessage, AssistantMessage] => [
  { id: 'u1', role: 'user', content: question, sources: [], created_at: '2026-11-10T08:00:00Z' },
  {
    id: 'a1', role: 'assistant', content: answer, created_at: '2026-11-10T08:00:01Z',
    sources: [{ tool: 'get_sales_summary', label: 'Ringkasan penjualan', from: '2026-11-10', to: '2026-11-10', as_of: '2026-11-10T08:20:00Z' }],
  },
]

describe('Asisten AI', () => {
  it('starts from a suggestion, creates a conversation and shows the grounded answer with its source', async () => {
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /assistant/conversations': () => ({ body: { data: [], meta: { page: 1, per_page: 50, total: 0 } } }),
      'POST /assistant/conversations': () => ({ status: 201, body: conv }),
      'POST /assistant/conversations/:id/messages': ({ body }) => ({
        status: 201,
        body: { messages: reply((body as { content: string }).content, 'Penjualan 10 Nov 2026: bersih Rp 9.000 dari 1 transaksi.') },
      }),
      'GET /assistant/conversations/:id': () => ({ body: { conversation: conv, messages: reply('Berapa penjualan hari ini?', 'Penjualan 10 Nov 2026: bersih Rp 9.000 dari 1 transaksi.') } }),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/assistant')
    expect(await screen.findByText('Baca-saja · tidak dapat mengubah data')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Berapa penjualan hari ini?' }))

    expect(await screen.findByText('Penjualan 10 Nov 2026: bersih Rp 9.000 dari 1 transaksi.')).toBeInTheDocument()
    const sources = screen.getByRole('list', { name: 'Sumber data' })
    expect(sources).toHaveTextContent('get_sales_summary')
    expect(sources).toHaveTextContent('10 Nov 2026')
    expect(sources).toHaveTextContent('WIB')
    await waitFor(() => expect(router.state.location.search).toBe(`?c=${CONV}`))
    const send = calls.find((c) => c.method === 'POST' && c.path.endsWith('/messages'))
    expect(send?.body).toEqual({ content: 'Berapa penjualan hari ini?' })
  })

  it('sends on Enter, keeps Shift+Enter for new lines', async () => {
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /assistant/conversations': () => ({ body: { data: [conv], meta: { page: 1, per_page: 50, total: 1 } } }),
      'GET /assistant/conversations/:id': () => ({ body: { conversation: conv, messages: [] } }),
      'POST /assistant/conversations/:id/messages': () => ({ status: 201, body: { messages: reply('a\nb', 'ok') } }),
    })
    const user = userEvent.setup()
    renderApp(`/assistant?c=${CONV}`)
    const box = await screen.findByLabelText('Pertanyaan untuk asisten')
    await user.type(box, 'a{Shift>}{Enter}{/Shift}b')
    expect(box).toHaveValue('a\nb')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ content: 'a\nb' }))
  })

  it('keeps the draft and offers retry when the AI service is down', async () => {
    let attempts = 0
    let stored: AssistantMessage[] = [] // behaves like the server: only successful turns are persisted
    mockApi({
      'GET /me': () => ({ body: staffMe }),
      'GET /assistant/conversations': () => ({ body: { data: [conv], meta: { page: 1, per_page: 50, total: 1 } } }),
      'GET /assistant/conversations/:id': () => ({ body: { conversation: conv, messages: stored } }),
      'POST /assistant/conversations/:id/messages': () => {
        attempts++
        if (attempts === 1) {
          return { status: 503, body: { error: { code: 'AI_UNAVAILABLE', message: 'Layanan AI sementara tidak tersedia. Fitur stok dan penjualan tetap berjalan.' } } }
        }
        stored = reply('Stok kopi?', 'Stok “Kopi”: 3 pcs.')
        return { status: 201, body: { messages: stored } }
      },
    })
    const user = userEvent.setup()
    renderApp(`/assistant?c=${CONV}`)
    const box = await screen.findByLabelText('Pertanyaan untuk asisten')
    await user.type(box, 'Stok kopi?{Enter}')
    expect(await screen.findByText(/Layanan AI sementara tidak tersedia/)).toBeInTheDocument()
    expect(box).toHaveValue('Stok kopi?')
    await user.click(screen.getByRole('button', { name: /Coba kirim lagi/ }))
    expect(await screen.findByText('Stok “Kopi”: 3 pcs.')).toBeInTheDocument()
    expect(box).toHaveValue('')
  })

  it('renders answers as text: store data cannot inject HTML', async () => {
    const evil = '<img src=x onerror="alert(1)"> Stok “Kopi”'
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /assistant/conversations': () => ({ body: { data: [conv], meta: { page: 1, per_page: 50, total: 1 } } }),
      'GET /assistant/conversations/:id': () => ({ body: { conversation: conv, messages: reply('stok?', evil) } }),
    })
    renderApp(`/assistant?c=${CONV}`)
    expect(await screen.findByText(evil)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('lists only the user’s conversations and opens one from history', async () => {
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /assistant/conversations': () => ({ body: { data: [conv], meta: { page: 1, per_page: 50, total: 1 } } }),
      'GET /assistant/conversations/:id': () => ({ body: { conversation: conv, messages: reply('Berapa penjualan hari ini?', 'Rp 9.000') } }),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/assistant')
    const history = await screen.findByRole('navigation', { name: 'Riwayat percakapan' })
    await user.click(await within(history).findByRole('button', { name: /Berapa penjualan hari ini\?/ }))
    await waitFor(() => expect(router.state.location.search).toBe(`?c=${CONV}`))
    expect(await screen.findByText('Rp 9.000')).toBeInTheDocument()
  })
})
