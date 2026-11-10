import { useEffect, useRef } from 'react'

/**
 * Motion is decoration, never information: every animation here falls back to
 * the final state when the user prefers reduced motion, when the browser lacks
 * the APIs (tests, old browsers), or before JavaScript runs.
 */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Scroll reveal for every `.reveal` element below `root`. Content is visible by
 * default; the hiding CSS only applies after `reveal-armed` is set here.
 */
export function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!root || !motionAllowed() || typeof IntersectionObserver === 'undefined') return
    const items = [...root.querySelectorAll<HTMLElement>('.reveal')]
    // Already on screen at load: show immediately, no flash.
    const viewport = window.innerHeight
    for (const el of items) if (el.getBoundingClientRect().top < viewport * 0.9) el.classList.add('is-visible')
    document.documentElement.classList.add('reveal-armed')
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    )
    for (const el of items) if (!el.classList.contains('is-visible')) io.observe(el)
    return () => {
      io.disconnect()
      document.documentElement.classList.remove('reveal-armed')
    }
  }, [])
  return ref
}

/**
 * Pointer parallax: writes --px/--py (−1…1, from the centre) on the element while
 * a fine pointer moves over it. `.depth-1/2/3` children drift at different depths.
 * Off for touch, reduced motion and tests.
 */
export function usePointerParallax<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !motionAllowed() || !window.matchMedia('(pointer: fine)').matches) return
    let frame = 0
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        el.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3))
        el.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3))
      })
    }
    const onLeave = () => {
      el.style.setProperty('--px', '0')
      el.style.setProperty('--py', '0')
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [])
  return ref
}
