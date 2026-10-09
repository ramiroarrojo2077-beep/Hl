import { useEffect, useRef, useState, type RefObject } from 'react'

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Añade la clase `is-in` a los elementos con [data-reveal] dentro del ref cuando entran en pantalla. */
export function useReveal<T extends HTMLElement>(deps: unknown[] = []): RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const els = [root, ...root.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => el.hasAttribute('data-reveal'))
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-in')
            io.unobserve(e.target)
          }
        }),
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

/**
 * Progreso de scroll de un elemento (0 → 1 mientras lo atraviesas) escrito como
 * variable CSS `--p` sin provocar renders de React. `onChange` es opcional.
 * mode 'through': de que el borde superior toca el fondo del viewport a que el inferior sale por arriba.
 * mode 'sticky': de top=0 a bottom=viewport (para secciones con contenido sticky).
 * mode 'exit': de top=0 a que el elemento sale completamente por arriba (hero).
 */
export function useScrollProgress<T extends HTMLElement>(
  mode: 'through' | 'sticky' | 'exit' = 'through',
  onChange?: (p: number) => void,
): RefObject<T | null> {
  const ref = useRef<T>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    let last = -1
    let visible = true
    const update = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const p =
        mode === 'sticky'
          ? -r.top / Math.max(1, r.height - vh)
          : mode === 'exit'
            ? -r.top / Math.max(1, r.height)
            : (vh - r.top) / (vh + r.height)
      const c = Math.min(1, Math.max(0, p))
      if (Math.abs(c - last) < 0.0005) return
      last = c
      el.style.setProperty('--p', c.toFixed(4))
      cb.current?.(c)
    }
    const onScroll = () => {
      if (visible && !raf) raf = requestAnimationFrame(update)
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible) onScroll()
    })
    io.observe(el)
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [mode])
  return ref
}

export function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [threshold])
  return scrolled
}

export function useMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description)
  }, [title, description])
}
