import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '../hooks/motion'

/** Pequeño campo de puntos interactivo: reacciona al puntero o al toque. Solo anima mientras está visible. */
export function LabField() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const reduced = prefersReducedMotion()
    let w = 0, h = 0, raf = 0, t = 0, visible = false
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pointer = { x: -999, y: -999 }
    const resize = () => {
      w = c.clientWidth
      h = c.clientHeight
      c.width = w * dpr
      c.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      const gap = 18
      for (let y = gap / 2; y < h; y += gap)
        for (let x = gap / 2; x < w; x += gap) {
          const d = Math.hypot(x - pointer.x, y - pointer.y)
          const near = Math.max(0, 1 - d / 120)
          const wave = reduced ? 0 : Math.sin(x * 0.03 + t) * Math.cos(y * 0.03 + t * 0.7) * 0.5 + 0.5
          ctx.globalAlpha = 0.12 + wave * 0.18 + near * 0.7
          ctx.fillStyle = near > 0.05 ? '#5B8CFF' : '#F5F5F7'
          ctx.beginPath()
          ctx.arc(x, y, 1 + near * 2.2, 0, Math.PI * 2)
          ctx.fill()
        }
    }
    const loop = () => {
      t += 0.012
      draw()
      raf = visible && !reduced ? requestAnimationFrame(loop) : 0
    }
    const move = (e: PointerEvent) => {
      const r = c.getBoundingClientRect()
      pointer.x = e.clientX - r.left
      pointer.y = e.clientY - r.top
      if (reduced) draw()
    }
    const leave = () => {
      pointer.x = pointer.y = -999
      if (reduced) draw()
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && !raf) loop()
    })
    resize()
    draw()
    io.observe(c)
    window.addEventListener('resize', resize)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      window.removeEventListener('resize', resize)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerleave', leave)
    }
  }, [])
  return <canvas ref={canvas} className="labfield" aria-label="Campo de partículas interactivo: mueve el cursor o el dedo encima" role="img" />
}
