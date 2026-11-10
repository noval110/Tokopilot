/**
 * Minimal API client. Requests go to the same origin (`/api/v1`), proxied by
 * Vite in dev and a Vercel rewrite in production, so auth can use first-party
 * httpOnly cookies — no tokens in localStorage.
 */

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export interface ApiErrorBody {
  code: string
  message: string
  details?: Record<string, unknown>
  request_id?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | undefined
  readonly requestId: string | undefined

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.details = body.details
    this.requestId = body.request_id
  }
}

const NETWORK_ERROR: ApiErrorBody = {
  code: 'NETWORK_ERROR',
  message: 'Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.',
}

function isErrorEnvelope(value: unknown): value is { error: ApiErrorBody } {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const err = (value as { error: unknown }).error
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as ApiErrorBody).code === 'string' &&
    typeof (err as ApiErrorBody).message === 'string'
  )
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

/** Reads the double-submit CSRF token the API sets after login (ADR-0002). */
export function readCsrfToken(): string | undefined {
  const match = /(?:^|;\s*)tp_csrf=([^;]+)/.exec(document.cookie)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  if (method !== 'GET') {
    const csrf = readCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
  }
  const init: RequestInit = { method, credentials: 'same-origin', headers }
  if (opts.signal) init.signal = opts.signal
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, NETWORK_ERROR)
  }

  const text = await res.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = undefined
    }
  }

  if (res.status === 204) return undefined as T

  if (!res.ok) {
    if (isErrorEnvelope(data)) throw new ApiError(res.status, data.error)
    const requestId = res.headers.get('X-Request-Id')
    throw new ApiError(res.status, {
      code: 'UNEXPECTED_RESPONSE',
      message: 'Server memberikan respons yang tidak dikenali.',
      ...(requestId ? { request_id: requestId } : {}),
    })
  }
  return data as T
}

/** Field-level messages from a VALIDATION_ERROR / EMAIL_TAKEN response. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {}
  const fields = err.details?.['fields']
  if (typeof fields !== 'object' || fields === null) return {}
  return Object.fromEntries(
    Object.entries(fields as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  )
}
