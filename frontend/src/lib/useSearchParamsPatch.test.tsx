import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useSearchParamsPatch } from './useSearchParamsPatch'

function setup(initial: string) {
  let router: ReturnType<typeof createMemoryRouter> | undefined
  const wrapper = ({ children }: { children: ReactNode }) => {
    router ??= createMemoryRouter([{ path: '/', element: children }], { initialEntries: [initial] })
    return <RouterProvider router={router} />
  }
  const hook = renderHook(() => useSearchParamsPatch(), { wrapper })
  return { hook, search: () => router?.state.location.search ?? '' }
}

describe('useSearchParamsPatch', () => {
  it('keeps both patches when two land before a re-render (debounced q, then a filter click)', () => {
    const { hook, search } = setup('/?page=3')
    act(() => {
      hook.result.current.patch({ q: 'gula' })
      hook.result.current.patch({ stock_status: 'low' }) // same stale closure, no render in between
    })
    expect(new URLSearchParams(search()).get('q')).toBe('gula')
    expect(new URLSearchParams(search()).get('stock_status')).toBe('low')
    expect(new URLSearchParams(search()).get('page')).toBeNull()
  })

  it('removes empty values, can keep the page, and reset clears everything', () => {
    const { hook, search } = setup('/?q=kopi&type=SALE&page=2')
    act(() => hook.result.current.patch({ type: '' }, false))
    expect(search()).toBe('?q=kopi&page=2')
    act(() => hook.result.current.reset())
    expect(search()).toBe('')
  })
})
