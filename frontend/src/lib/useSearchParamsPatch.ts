import { useCallback, useLayoutEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

/**
 * URL-filter state with merge-safe patches.
 *
 * React Router's functional `setSearchParams((prev) => …)` hands `prev` from
 * the hook's last render, not the live URL. Two updates in quick succession
 * (debounced search committing, then a filter click before the re-render)
 * would make the second one drop the first. We patch from the latest params
 * we wrote ourselves, re-synced on every render (so back/forward still wins).
 */
export function useSearchParamsPatch() {
  const [params, setParams] = useSearchParams()
  const latest = useRef(params)
  useLayoutEffect(() => {
    latest.current = params
  }, [params])

  const patch = useCallback(
    (changes: Record<string, string>, resetPage = true) => {
      const next = new URLSearchParams(latest.current)
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      if (resetPage) next.delete('page')
      latest.current = next
      setParams(next, { replace: true })
    },
    [setParams],
  )

  const reset = useCallback(() => {
    latest.current = new URLSearchParams()
    setParams({}, { replace: true })
  }, [setParams])

  return { params, patch, reset }
}
