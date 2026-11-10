/** Joins truthy class names. Deliberately tiny — no merge magic needed yet. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
