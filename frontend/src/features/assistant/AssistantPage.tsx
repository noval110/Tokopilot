import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, History, MessageSquarePlus, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMe } from '@/app/session'
import { LogoMark } from '@/components/brand/Logo'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Loader'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatStoreDateTime, timezoneLabel } from '@/lib/format'
import { formatPeriod } from '@/lib/period'
import { type AssistantMessage, type AssistantSource, assistantApi, assistantKeys } from '@/services/assistant'

const MAX_CHARS = 1000

const SUGGESTIONS: Array<{ text: string; send: boolean }> = [
  { text: 'Produk apa yang stoknya hampir habis?', send: true },
  { text: 'Berapa penjualan hari ini?', send: true },
  { text: 'Produk apa yang paling laku minggu ini?', send: true },
  { text: 'Bagaimana kondisi toko minggu ini?', send: true },
  { text: 'Berapa stok ', send: false },
]

function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Terjadi kesalahan. Coba lagi.'
  if (err.code === 'RATE_LIMITED') return 'Batas pertanyaan tercapai untuk saat ini. Coba lagi nanti.'
  if (err.code === 'NETWORK_ERROR') return 'Koneksi terputus. Pertanyaanmu masih tersimpan di kotak teks.'
  return err.message
}

function SourceChip({ s, tz }: { s: AssistantSource; tz: string }) {
  return (
    // Segments wrap as whole units on narrow screens instead of squeezing into columns.
    <li className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-xs bg-white px-2 py-1 text-[0.6875rem] ring-1 ring-paper-300">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="size-1.5 rounded-full bg-daun-600" aria-hidden />
        <code className="num text-ink-800">{s.tool}</code>
      </span>
      <span className="whitespace-nowrap text-text-muted">· {s.label}</span>
      {s.from && s.to && <span className="whitespace-nowrap text-text-muted">· {formatPeriod(s.from, s.to)}</span>}
      <span className="num whitespace-nowrap text-text-subtle">· data per {formatStoreDateTime(new Date(s.as_of), tz)} {timezoneLabel(tz)}</span>
    </li>
  )
}

function Bubble({ m, tz }: { m: AssistantMessage; tz: string }) {
  if (m.role === 'user') {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] rounded-md rounded-br-xs border-2 border-ink-900 bg-daun-700 px-4 py-2.5 text-[0.9375rem] whitespace-pre-line text-white shadow-(--shadow-glow)">{m.content}</p>
      </li>
    )
  }
  return (
    <li className="flex gap-3">
      <LogoMark className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1">
        {/* Plain text only: answers can quote store data, so nothing is rendered as HTML. */}
        <div className="border-l-2 border-daun-500 pl-4 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-900">{m.content}</div>
        {m.sources.length > 0 && (
          <ul aria-label="Sumber data" className="mt-2.5 flex flex-wrap gap-1.5 pl-4">
            {m.sources.map((s, i) => (
              <SourceChip key={`${s.tool}-${i}`} s={s} tz={tz} />
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

export function AssistantPage() {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const tz = me?.membership?.store.timezone ?? 'Asia/Jakarta'
  const [params, setParams] = useSearchParams()
  const convId = params.get('c')
  const [draft, setDraft] = useState('')
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const list = useQuery({ queryKey: assistantKeys.list, queryFn: assistantApi.list })
  const conv = useQuery({ queryKey: assistantKeys.conversation(convId ?? ''), queryFn: () => assistantApi.get(convId ?? ''), enabled: Boolean(convId) })
  const messages = conv.data?.messages ?? []

  const send = useMutation({
    mutationFn: async (text: string) => {
      const id = convId ?? (await assistantApi.create()).id
      const res = await assistantApi.send(id, text)
      return { id, res }
    },
    onMutate: (text) => setPendingText(text),
    onSuccess: ({ id, res }) => {
      qc.setQueryData(assistantKeys.conversation(id), (old: { conversation: unknown; messages: AssistantMessage[] } | undefined) => ({
        conversation: old?.conversation,
        messages: [...(old?.messages ?? []), ...res.messages],
      }))
      void qc.invalidateQueries({ queryKey: assistantKeys.list })
      void qc.invalidateQueries({ queryKey: assistantKeys.conversation(id) })
      if (id !== convId) setParams({ c: id }, { replace: true })
      setDraft('')
      setPendingText(null)
    },
    onError: () => setPendingText(null),
  })

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, pendingText])

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || send.isPending || text.length > MAX_CHARS) return
    send.mutate(text)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function startNew() {
    setParams({}, { replace: true })
    setDraft('')
    send.reset()
    setShowHistory(false)
    inputRef.current?.focus()
  }

  const empty = !convId || (conv.isSuccess && messages.length === 0)

  return (
    <div className="animate-rise">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-paper-300 pb-6">
        <div>
          <p className="eyebrow text-text-subtle">Wawasan</p>
          <h1 className="mt-3 text-[2rem] leading-[1.05] font-bold sm:text-[2.5rem]">Asisten AI</h1>
        </div>
        <p className="inline-flex items-center gap-2 rounded-sm bg-daun-50 px-3 py-2 text-[0.8125rem] font-semibold text-daun-900 ring-1 ring-daun-200">
          <ShieldCheck className="size-4" aria-hidden /> Baca-saja · tidak dapat mengubah data
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Conversation history */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={startNew}>
              <MessageSquarePlus className="size-4" aria-hidden /> Percakapan baru
            </Button>
            <Button variant="ghost" className="lg:hidden" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory} aria-controls="riwayat-ai">
              <History className="size-4" aria-hidden /> <span className="sr-only">Riwayat</span>
            </Button>
          </div>
          <nav id="riwayat-ai" aria-label="Riwayat percakapan" className={cn('mt-3', !showHistory && 'hidden lg:block')}>
            {list.data && list.data.data.length === 0 && <p className="px-1 text-[0.8125rem] text-text-subtle">Belum ada percakapan.</p>}
            <ul className="space-y-0.5">
              {list.data?.data.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { setParams({ c: c.id }, { replace: true }); send.reset(); setShowHistory(false) }}
                    aria-current={c.id === convId ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-sm px-3 py-2 text-left transition-colors',
                      c.id === convId ? 'bg-white ring-1 ring-paper-300' : 'hover:bg-paper-100',
                    )}
                  >
                    <span className="line-clamp-2 text-[0.8125rem] font-medium text-ink-900">{c.title}</span>
                    <span className="num text-[0.6875rem] text-text-subtle">{formatStoreDateTime(new Date(c.updated_at), tz)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Chat */}
        {/* Desktop: fixed to the viewport so only the messages scroll and the composer stays in reach. */}
        <section aria-label="Percakapan" className="flex min-h-[60dvh] flex-col rounded-md bg-paper-50 ring-1 ring-paper-300 lg:h-[calc(100dvh-17.5rem)] lg:min-h-[28rem]">
          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            {conv.isError && <Alert tone="danger">Percakapan tidak ditemukan atau tidak dapat dimuat.</Alert>}
            {empty && !pendingText ? (
              <div className="mx-auto max-w-lg py-8 text-center">
                <span className="animate-pop sign-sm mx-auto grid size-14 -rotate-3 place-items-center bg-kunyit-300 text-ink-900">
                  <Sparkles className="size-5" aria-hidden />
                </span>
                <h2 className="font-sign mt-5 text-[2rem] font-normal tracking-normal">Tanya Pilot.</h2>
                <p className="mt-2 text-sm text-text-muted">
                  Setiap angka diambil dari data tokomu melalui alat baca-saja, lengkap dengan periode dan waktu datanya.
                </p>
                <ul className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <li key={s.text}>
                      <button
                        type="button"
                        onClick={() => {
                          if (s.send) send.mutate(s.text)
                          else { setDraft(s.text); inputRef.current?.focus() }
                        }}
                        disabled={send.isPending}
                        className="w-full rounded-sm bg-white px-3.5 py-3 text-left text-sm text-ink-800 ring-1 ring-paper-300 transition-shadow hover:shadow-paper hover:ring-daun-600"
                      >
                        {s.send ? s.text : 'Berapa stok … ? (sebutkan produk)'}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol className="space-y-6" aria-live="polite">
                {messages.map((m) => (
                  <Bubble key={m.id} m={m} tz={tz} />
                ))}
                {pendingText && (
                  <>
                    <Bubble m={{ id: 'pending', role: 'user', content: pendingText, sources: [], created_at: '' }} tz={tz} />
                    <li className="flex items-center gap-3 text-sm text-text-muted" role="status">
                      <LogoMark className="size-7 animate-pulse" />
                      <span className="inline-flex items-center gap-2"><Spinner className="text-daun-700" /> Memeriksa data toko…</span>
                    </li>
                  </>
                )}
              </ol>
            )}
            {send.isError && (
              <Alert tone="danger" className="mt-6" title="Jawaban belum dapat dibuat">
                <p>{errorText(send.error)}</p>
                <button type="button" onClick={() => submit()} className="mt-2 inline-flex items-center gap-1.5 font-semibold underline-offset-4 hover:underline">
                  <RotateCcw className="size-3.5" aria-hidden /> Coba kirim lagi
                </button>
              </Alert>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} className="sticky bottom-0 rounded-b-md border-t border-paper-300 bg-white p-3 sm:p-4 lg:static">
            <label htmlFor="ai-input" className="sr-only">Pertanyaan untuk asisten</label>
            <div className="flex items-end gap-2 rounded-md bg-paper-50 p-2 ring-1 ring-paper-300 focus-within:ring-2 focus-within:ring-daun-600">
              <textarea
                id="ai-input"
                ref={inputRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                maxLength={MAX_CHARS}
                placeholder="mis. Berapa penjualan minggu ini?"
                className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[0.9375rem] focus:outline-none"
                style={{ height: `${Math.min(10, Math.max(1, draft.split('\n').length)) * 1.5 + 1}rem` }}
              />
              <Button type="submit" size="sm" className="h-10 w-10 shrink-0 px-0" disabled={!draft.trim() || send.isPending} aria-label="Kirim">
                {send.isPending ? <Spinner /> : <ArrowUp className="size-4" />}
              </Button>
            </div>
            <p className="mt-2 flex justify-between px-1 text-[0.6875rem] text-text-subtle">
              <span>Enter untuk kirim · Shift+Enter baris baru</span>
              <span className="num">{draft.length}/{MAX_CHARS}</span>
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}
