"use client";

import { useEffect, useRef } from "react";

/** Esfera de partículas animada (canvas 2D), como fondo del inicio. */
export function ParticleSphere() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const N = 1400;
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = i * Math.PI * (3 - Math.sqrt(5));
      return { x: Math.cos(th) * r, y, z: Math.sin(th) * r, j: Math.random() };
    });
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (t: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.42;
      const a = reduce ? 0.6 : t * 0.00012;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (const p of pts) {
        const x = p.x * ca - p.z * sa;
        const z = p.x * sa + p.z * ca;
        const breathe = 1 + Math.sin(t * 0.001 + p.j * 6) * 0.025;
        const px = w / 2 + x * R * breathe;
        const py = h / 2 + p.y * R * 0.92 * breathe;
        const depth = (z + 1) / 2;
        ctx.fillStyle = `rgba(${200 + depth * 55},${210 + depth * 45},255,${0.08 + depth * 0.55})`;
        ctx.fillRect(px, py, 1.1 + depth * 0.9, 1.1 + depth * 0.9);
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
