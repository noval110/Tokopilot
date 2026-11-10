/**
 * Only same-site relative paths are accepted as post-login redirect targets,
 * so `?next=` cannot be abused as an open redirect.
 */
export function safeNext(raw: string | null): string | undefined {
  if (!raw) return undefined
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return undefined
  return raw
}
