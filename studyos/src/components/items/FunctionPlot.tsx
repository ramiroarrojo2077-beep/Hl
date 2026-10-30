import { useMemo } from 'react';
import { sampleFunction, tryCompile } from '@/lib/mathexpr';

/** Gráfico de y = f(x) en SVG, calculado con el parser seguro (sin eval). */
export function FunctionPlot({ expression, xMin, xMax, title, height = 220 }: { expression: string; xMin: number; xMax: number; title?: string; height?: number }) {
  const data = useMemo(() => {
    const { fn, error } = tryCompile(expression, ['x']);
    if (!fn) return { error };
    const pts = sampleFunction(fn, xMin, xMax, 300);
    const ys = pts.map((p) => p.y).filter((y): y is number => y !== null);
    if (!ys.length) return { error: 'La función no tiene valores reales en ese intervalo.' };
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (yMax - yMin < 1e-9) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.08;
    return { pts, yMin: yMin - pad, yMax: yMax + pad };
  }, [expression, xMin, xMax]);
  const W = 520;
  const H = height;
  if ('error' in data && data.error) return <div className="text-xs text-bad">No se pudo graficar «{expression}»: {data.error}</div>;
  const { pts, yMin, yMax } = data as { pts: { x: number; y: number | null }[]; yMin: number; yMax: number };
  const sx = (x: number) => ((x - xMin) / (xMax - xMin)) * W;
  const sy = (y: number) => H - ((y - yMin) / (yMax - yMin)) * H;
  let d = '';
  let pen = false;
  for (const p of pts) {
    if (p.y === null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
    pen = true;
  }
  const ticks = (a: number, b: number) => {
    const step = Math.pow(10, Math.floor(Math.log10((b - a) / 5)));
    const m = (b - a) / step > 10 ? step * 2 : step;
    const out: number[] = [];
    for (let v = Math.ceil(a / m) * m; v <= b; v += m) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  };
  return (
    <figure className="rounded-xl border border-line bg-[#0a1024] p-3">
      {title && <figcaption className="text-xs text-muted mb-2">{title}</figcaption>}
      <svg viewBox={`-30 -10 ${W + 40} ${H + 30}`} className="w-full h-auto" role="img" aria-label={`Gráfico de y = ${expression}`}>
        {ticks(xMin, xMax).map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={0} y2={H} stroke="rgba(150,165,220,.12)" />
            <text x={sx(t)} y={H + 14} fontSize="10" fill="#8590b5" textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        {ticks(yMin, yMax).map((t) => (
          <g key={`y${t}`}>
            <line x1={0} x2={W} y1={sy(t)} y2={sy(t)} stroke="rgba(150,165,220,.12)" />
            <text x={-6} y={sy(t) + 3} fontSize="10" fill="#8590b5" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {yMin < 0 && yMax > 0 && <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} stroke="rgba(200,210,255,.45)" />}
        {xMin < 0 && xMax > 0 && <line x1={sx(0)} x2={sx(0)} y1={0} y2={H} stroke="rgba(200,210,255,.45)" />}
        <path d={d} fill="none" stroke="#5fdcff" strokeWidth="2.2" />
      </svg>
      <div className="text-[11px] text-faint mt-1 font-mono">y = {expression}</div>
    </figure>
  );
}
