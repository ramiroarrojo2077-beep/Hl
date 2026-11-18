import { useState } from "preact/hooks";
import type { ProfileSample } from "../../services/elevation.ts";
import { formatDistance, formatHeight, type UnitSystem } from "../../geo/format.ts";
import { t } from "../../i18n/index.ts";

/** Gráfico SVG del perfil de elevación con lectura interactiva sincronizada con el globo. */
export function ProfileChart({ samples, onHover, units }: { samples: ProfileSample[]; onHover: (i: number | null) => void; units: UnitSystem }) {
  const [hover, setHover] = useState<number | null>(null);
  if (samples.length < 2) return null;
  const W = 320;
  const H = 150;
  const P = { l: 40, r: 8, t: 10, b: 20 };
  const maxD = samples[samples.length - 1]!.distance || 1;
  let minE = Infinity;
  let maxE = -Infinity;
  for (const s of samples) {
    minE = Math.min(minE, s.elevation);
    maxE = Math.max(maxE, s.elevation);
  }
  const pad = Math.max(5, (maxE - minE) * 0.1);
  const lo = minE - pad;
  const hi = maxE + pad;
  const x = (d: number) => P.l + (d / maxD) * (W - P.l - P.r);
  const y = (e: number) => P.t + (1 - (e - lo) / (hi - lo)) * (H - P.t - P.b);
  const line = samples.map((s, i) => `${i ? "L" : "M"}${x(s.distance).toFixed(1)},${y(s.elevation).toFixed(1)}`).join("");
  const area = `${line}L${x(maxD)},${H - P.b}L${x(0)},${H - P.b}Z`;
  const onMove = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const d = ((px - P.l) / (W - P.l - P.r)) * maxD;
    let best = 0;
    let bestDiff = Infinity;
    samples.forEach((s, i) => {
      const diff = Math.abs(s.distance - d);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    setHover(best);
    onHover(best);
  };
  const hs = hover !== null ? samples[hover] : null;
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Perfil de elevación")} onPointerMove={onMove} onPointerLeave={() => (setHover(null), onHover(null))}>
      <defs>
        <linearGradient id="pg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--accent)" stop-opacity="0.45" />
          <stop offset="1" stop-color="var(--accent)" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <line class="axis" x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} />
      <line class="axis" x1={P.l} x2={P.l} y1={P.t} y2={H - P.b} />
      <text x={P.l - 4} y={y(maxE) + 3} text-anchor="end">
        {formatHeight(maxE, units)}
      </text>
      <text x={P.l - 4} y={y(minE) + 3} text-anchor="end">
        {formatHeight(minE, units)}
      </text>
      <text x={W - P.r} y={H - 5} text-anchor="end">
        {formatDistance(maxD, units)}
      </text>
      <path d={area} fill="url(#pg)" />
      <path d={line} fill="none" stroke="var(--accent)" stroke-width="2" />
      {hs && (
        <>
          <line x1={x(hs.distance)} x2={x(hs.distance)} y1={P.t} y2={H - P.b} stroke="var(--warn)" stroke-dasharray="3 3" />
          <circle cx={x(hs.distance)} cy={y(hs.elevation)} r="4" fill="var(--warn)" />
          <text x={Math.min(W - 90, x(hs.distance) + 6)} y={P.t + 10} style={{ fill: "var(--text)" }}>
            {formatHeight(hs.elevation, units)} · {formatDistance(hs.distance, units)}
          </text>
        </>
      )}
    </svg>
  );
}
