import { memo, useId, useMemo, type ReactNode } from 'react'
import type { Project } from '../data/types'

type Mode = 'final' | 'wire' | 'sketch'
const W = 1600
const H = 900

function rng(seed: string) {
  let h = 1779033703
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

function ridge(r: () => number, base: number, amp: number, step = 20) {
  const f = [0.002 + r() * 0.002, 0.006 + r() * 0.004, 0.017 + r() * 0.01]
  const ph = [r() * 6, r() * 6, r() * 6]
  let d = `M0 ${H} `
  for (let x = 0; x <= W; x += step) {
    const y = base - amp * (Math.sin(x * f[0] + ph[0]) * 0.55 + Math.sin(x * f[1] + ph[1]) * 0.3 + Math.sin(x * f[2] + ph[2]) * 0.15)
    d += `L${x} ${y.toFixed(1)} `
  }
  return d + `L${W} ${H} Z`
}

const Layer = ({ depth, children, className = '' }: { depth: number; children: ReactNode; className?: string }) => (
  <g className={`layer ${className}`} style={{ ['--depth' as string]: depth }}>
    {children}
  </g>
)

function stars(r: () => number, n: number, maxY = H * 0.6) {
  return Array.from({ length: n }, (_, i) => (
    <circle key={i} className={i % 5 === 0 ? 'twinkle' : undefined} cx={r() * W} cy={r() * maxY} r={r() * 1.4 + 0.3} fill="#fff" opacity={0.25 + r() * 0.6} style={{ animationDelay: `${(i % 7) * 0.6}s` }} />
  ))
}

export type ArtSource = Pick<Project, 'slug' | 'name' | 'art' | 'accent' | 'cover'>

function scene(p: ArtSource, id: string): ReactNode {
  const [bg, mid, light] = p.art.palette
  const r = rng(p.slug)
  const g = (n: string) => `url(#${id}${n})`
  const defs = (
    <defs>
      <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={bg} />
        <stop offset="0.65" stopColor={mid} />
        <stop offset="1" stopColor={light} stopOpacity="0.35" />
      </linearGradient>
      <radialGradient id={`${id}glow`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor={light} stopOpacity="0.9" />
        <stop offset="0.35" stopColor={light} stopOpacity="0.25" />
        <stop offset="1" stopColor={light} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}fog`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={mid} stopOpacity="0" />
        <stop offset="1" stopColor={mid} stopOpacity="0.9" />
      </linearGradient>
      <radialGradient id={`${id}vig`} cx="0.5" cy="0.45" r="0.75">
        <stop offset="0.55" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.85" />
      </radialGradient>
      <linearGradient id={`${id}planet`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={light} />
        <stop offset="0.6" stopColor={mid} />
        <stop offset="1" stopColor={bg} />
      </linearGradient>
    </defs>
  )
  const sky = <rect className="keep bg" width={W} height={H} fill={g('sky')} />
  const vignette = <rect className="keep vig" width={W} height={H} fill={g('vig')} />
  let body: ReactNode = null

  switch (p.art.scene) {
    case 'horror':
      body = (
        <>
          <Layer depth={0.5}>{stars(r, 40, 400)}</Layer>
          <Layer depth={0.45}><circle className="breathe" cx="1180" cy="230" r="220" fill={g('glow')} opacity="0.55" /><circle cx="1180" cy="230" r="58" fill={light} opacity="0.75" /></Layer>
          <Layer depth={0.35}><path d={ridge(r, 640, 50)} fill="#0b0809" /></Layer>
          <Layer depth={0.2}>
            <path d="M560 720 V470 L700 380 L840 470 V720 Z M640 470 L640 410 L670 410 L670 450 Z" fill="#040304" />
            <rect x="676" y="520" width="44" height="58" fill={light} className="breathe" opacity="0.85" />
            {Array.from({ length: 7 }, (_, i) => {
              const x = 120 + i * 210 + r() * 60
              return <path key={i} d={`M${x} 760 L${x + 4} ${520 - r() * 120} M${x + 2} 620 L${x + 50} 560 M${x + 3} 580 L${x - 40} 520`} stroke="#050404" strokeWidth={6} fill="none" />
            })}
          </Layer>
          <Layer depth={0.1}><path d={ridge(r, 780, 25)} fill="#020202" /></Layer>
          <Layer depth={0.05} className="drift"><rect x="-200" y="520" width={W + 400} height="380" fill={g('fog')} opacity="0.6" /></Layer>
        </>
      )
      break
    case 'city': {
      const towers = (n: number, base: number, hMin: number, hMax: number, color: string, lit: number) =>
        Array.from({ length: n }, (_, i) => {
          const w = 40 + r() * 70
          const x = (i / n) * W + r() * 30 - 20
          const h = hMin + r() * (hMax - hMin)
          return (
            <g key={i}>
              <rect x={x} y={base - h} width={w} height={h + 200} fill={color} />
              {Array.from({ length: Math.floor(h / 26) }, (_, j) =>
                r() < lit ? <rect key={j} x={x + 8 + r() * (w - 20)} y={base - h + 14 + j * 26} width="8" height="4" fill={light} opacity={0.4 + r() * 0.6} /> : null,
              )}
            </g>
          )
        })
      body = (
        <>
          <Layer depth={0.5}>{stars(r, 30, 300)}</Layer>
          <Layer depth={0.45}><ellipse className="breathe" cx="800" cy="640" rx="900" ry="260" fill={g('glow')} opacity="0.5" /></Layer>
          <Layer depth={0.35}>{towers(22, 650, 120, 330, '#0a1222', 0.18)}</Layer>
          <Layer depth={0.2}>{towers(14, 700, 160, 470, '#060b16', 0.3)}</Layer>
          <Layer depth={0.08}>
            <rect x="0" y="700" width={W} height="200" fill="#02040a" />
            {Array.from({ length: 13 }, (_, i) => (
              <path key={i} d={`M800 700 L${-1200 + i * 333} ${H}`} stroke={light} strokeOpacity="0.25" strokeWidth="1.5" />
            ))}
            {[712, 730, 760, 805, 870].map((y) => <path key={y} d={`M0 ${y} H${W}`} stroke={light} strokeOpacity="0.2" strokeWidth="1.5" />)}
          </Layer>
        </>
      )
      break
    }
    case 'island':
      body = (
        <>
          <Layer depth={0.5}><circle className="breathe" cx="800" cy="560" r="360" fill={g('glow')} /><circle cx="800" cy="560" r="90" fill={light} opacity="0.95" /></Layer>
          <Layer depth={0.3}><path d={ridge(r, 600, 40)} fill={mid} opacity="0.7" /></Layer>
          <Layer depth={0.15}>
            <rect x="0" y="600" width={W} height="300" fill={bg} opacity="0.92" />
            {Array.from({ length: 14 }, (_, i) => (
              <rect key={i} className="drift" x={800 - (40 + i * 22) + r() * 20} y={612 + i * 18} width={(40 + i * 22) * 2} height="2" fill={light} opacity={0.5 - i * 0.03} />
            ))}
          </Layer>
          <Layer depth={0.06}>
            <path d="M260 640 Q420 520 600 600 Q640 620 680 640 Z" fill="#06100f" />
            <path d="M420 560 Q430 470 410 420 M410 420 q-50 -10 -80 20 M410 420 q40 -30 90 -10 M410 420 q-20 -40 -60 -40 M410 420 q30 -50 70 -40" stroke="#06100f" strokeWidth="9" fill="none" strokeLinecap="round" />
          </Layer>
        </>
      )
      break
    case 'orbit':
      body = (
        <>
          <Layer depth={0.5}>{stars(r, 120, H)}</Layer>
          <Layer depth={0.35}><circle className="breathe" cx="980" cy="430" r="460" fill={g('glow')} opacity="0.45" /></Layer>
          <Layer depth={0.25}>
            <ellipse cx="980" cy="430" rx="560" ry="140" fill="none" stroke={light} strokeOpacity="0.25" strokeDasharray="4 10" />
            <circle cx="980" cy="430" r="230" fill={g('planet')} />
            <ellipse cx="980" cy="440" rx="380" ry="70" fill="none" stroke={light} strokeOpacity="0.7" strokeWidth="3" />
          </Layer>
          <Layer depth={0.12}>
            <circle cx="420" cy="660" r="70" fill={mid} stroke={light} strokeOpacity="0.4" />
            <ellipse cx="420" cy="660" rx="180" ry="180" fill="none" stroke="#fff" strokeOpacity="0.12" strokeDasharray="2 8" />
            <circle cx="560" cy="560" r="6" fill="#fff" />
            <path d="M560 560 Q 760 420 980 300" stroke="#fff" strokeOpacity="0.5" strokeDasharray="6 8" fill="none" />
          </Layer>
        </>
      )
      break
    case 'interface':
      body = (
        <>
          <Layer depth={0.45}><circle className="breathe" cx="1100" cy="300" r="520" fill={g('glow')} opacity="0.35" /></Layer>
          <Layer depth={0.3}>
            {Array.from({ length: 24 }, (_, i) => <path key={i} d={`M${i * 70} 0 V${H}`} stroke="#fff" strokeOpacity="0.035" />)}
          </Layer>
          <Layer depth={0.18}>
            <g transform="translate(330 170) skewY(-6)">
              <rect width="640" height="420" rx="18" fill="#14110d" stroke="#fff" strokeOpacity="0.12" />
              <rect x="24" y="24" width="160" height="372" rx="10" fill="#1d1912" />
              {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="40" y={48 + i * 40} width={110 - i * 10} height="10" rx="5" fill={i === 1 ? light : '#3a3226'} />)}
              <rect x="208" y="24" width="408" height="160" rx="10" fill="#1d1912" />
              <path d="M228 160 C300 90 360 150 420 110 S540 60 596 80" stroke={light} strokeWidth="4" fill="none" />
              <rect x="208" y="200" width="196" height="196" rx="10" fill="#1d1912" />
              <rect x="420" y="200" width="196" height="196" rx="10" fill={light} opacity="0.9" />
            </g>
          </Layer>
          <Layer depth={0.08}>
            <g transform="translate(1010 380) skewY(-6)">
              <rect width="300" height="300" rx="18" fill="#1a160f" stroke="#fff" strokeOpacity="0.15" />
              {[0, 1, 2, 3].map((i) => <rect key={i} x="24" y={30 + i * 60} width="252" height="40" rx="8" fill="#262017" />)}
              <circle cx="56" cy="110" r="10" fill={light} />
            </g>
          </Layer>
        </>
      )
      break
    case 'neural': {
      const nodes = Array.from({ length: 46 }, () => ({ x: 120 + r() * 1360, y: 100 + r() * 700, s: r() }))
      body = (
        <>
          <Layer depth={0.45}><circle className="breathe" cx="800" cy="450" r="480" fill={g('glow')} opacity="0.4" /></Layer>
          <Layer depth={0.2}>
            {nodes.flatMap((a, i) =>
              nodes.slice(i + 1).filter((b) => Math.hypot(a.x - b.x, a.y - b.y) < 230).map((b, j) => (
                <path key={`${i}-${j}`} d={`M${a.x} ${a.y} L${b.x} ${b.y}`} stroke={light} strokeOpacity={0.12 + a.s * 0.2} />
              )),
            )}
          </Layer>
          <Layer depth={0.1}>
            {nodes.map((n, i) => (
              <circle key={i} className={i % 6 === 0 ? 'twinkle' : undefined} cx={n.x} cy={n.y} r={2 + n.s * 6} fill={n.s > 0.75 ? light : '#cfe'} opacity={0.4 + n.s * 0.6} />
            ))}
          </Layer>
        </>
      )
      break
    }
    case 'waves':
      body = (
        <>
          <Layer depth={0.45}><ellipse className="breathe" cx="800" cy="450" rx="760" ry="300" fill={g('glow')} opacity="0.45" /></Layer>
          <Layer depth={0.15}>
            {Array.from({ length: 18 }, (_, i) => {
              const a = 40 + i * 9
              const f = 0.004 + i * 0.0004
              let d = 'M0 450 '
              for (let x = 0; x <= W; x += 16) d += `L${x} ${(450 + Math.sin(x * f + i * 0.5) * a * Math.sin((x / W) * Math.PI)).toFixed(1)} `
              return <path key={i} d={d} stroke={i % 3 ? '#fff' : light} strokeOpacity={0.12 + (i % 3 ? 0 : 0.5)} strokeWidth={i % 3 ? 1 : 2} fill="none" />
            })}
          </Layer>
        </>
      )
      break
    case 'terrain':
      body = (
        <>
          <Layer depth={0.5}>{stars(r, 50, 350)}</Layer>
          <Layer depth={0.45}><circle className="breathe" cx="520" cy="420" r="380" fill={g('glow')} opacity="0.5" /></Layer>
          {[0, 1, 2, 3, 4].map((i) => (
            <Layer key={i} depth={0.4 - i * 0.08}>
              <path d={ridge(r, 420 + i * 95, 130 - i * 18, 16)} fill={i === 4 ? '#03050a' : mid} opacity={0.35 + i * 0.16} />
            </Layer>
          ))}
          <Layer depth={0.05} className="drift"><rect x="-200" y="560" width={W + 400} height="340" fill={g('fog')} opacity="0.35" /></Layer>
        </>
      )
      break
  }
  return (
    <>
      {defs}
      {sky}
      {body}
      {vignette}
    </>
  )
}

interface Props {
  project: ArtSource
  mode?: Mode
  className?: string
  /** Imagen decorativa (ya hay un título visible al lado). */
  decorative?: boolean
  sizes?: string
  eager?: boolean
}

/** Muestra la portada real del proyecto o, si no existe, su arte generativo de reemplazo. */
export const Artwork = memo(function Artwork({ project, mode = 'final', className = '', decorative, sizes = '100vw', eager }: Props) {
  const id = useId().replace(/:/g, '')
  const content = useMemo(() => scene(project, id), [project, id])
  const label = decorative ? undefined : `Arte de ${project.name}`
  if (project.cover && mode === 'final')
    return (
      <img
        className={`art ${className}`}
        src={project.cover.src}
        srcSet={project.cover.srcSet}
        sizes={sizes}
        alt={decorative ? '' : project.cover.alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    )
  return (
    <svg
      className={`art art--${mode} ${className}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ ['--accent' as string]: project.accent }}
    >
      {content}
    </svg>
  )
})
