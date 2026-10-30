import { useId } from 'react';
import type { SectionArtKey } from './sections';

// Ilustraciones vectoriales livianas para el encabezado de cada sección.
// Todas comparten el lienzo 200×120 y usan los dos acentos de la sección.

export function SectionArt({ art, from, to, className }: { art: SectionArtKey; from: string; to: string; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const g = `sa-g-${id}`;
  const s = `sa-s-${id}`;
  const fill = `url(#${g})`;
  const stroke = `url(#${s})`;
  return (
    <svg viewBox="0 0 200 120" className={className} aria-hidden="true" fill="none">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={s} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={from} stopOpacity=".9" />
          <stop offset="1" stopColor={to} stopOpacity=".9" />
        </linearGradient>
      </defs>
      {ART[art]?.({ fill, stroke, from, to })}
    </svg>
  );
}

type P = { fill: string; stroke: string; from: string; to: string };

const ART: Partial<Record<SectionArtKey, (p: P) => React.ReactNode>> = {
  subjects: ({ fill, from, to }) => (
    <>
      <rect x="92" y="34" width="62" height="74" rx="10" fill={to} opacity=".35" transform="rotate(-14 123 71)" />
      <rect x="110" y="26" width="62" height="74" rx="10" fill={from} opacity=".55" transform="rotate(-4 141 63)" />
      <rect x="128" y="18" width="62" height="74" rx="10" fill={fill} />
      <path d="M142 42 h34 M142 52 h26 M142 62 h30" stroke="#fff" strokeOpacity=".75" strokeWidth="3" strokeLinecap="round" />
      <circle cx="176" cy="80" r="6" fill="#fff" fillOpacity=".85" />
    </>
  ),
  library: ({ fill, to }) => (
    <>
      <rect x="96" y="30" width="54" height="70" rx="6" fill={to} opacity=".3" transform="rotate(-12 123 65)" />
      <rect x="118" y="20" width="58" height="76" rx="6" fill="#e9eeff" opacity=".95" />
      <path d="M176 20 v14 h-14" fill="#c9d3f5" />
      <path d="M128 40 h30 M128 50 h40 M128 60 h36 M128 70 h24" stroke="#5a6aa8" strokeWidth="3" strokeLinecap="round" />
      <rect x="128" y="78" width="26" height="12" rx="3" fill={fill} />
      <text x="141" y="87.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff" fontFamily="Inter Variable, sans-serif">PDF</text>
    </>
  ),
  tasks: ({ fill, stroke }) => (
    <>
      <rect x="112" y="16" width="74" height="92" rx="10" fill="#141d48" stroke={stroke} strokeWidth="2" />
      <rect x="134" y="10" width="30" height="12" rx="5" fill={fill} />
      {[36, 58, 80].map((y, i) => (
        <g key={y}>
          <rect x="124" y={y} width="14" height="14" rx="4" fill={i < 2 ? fill : 'none'} stroke={stroke} strokeWidth="2" />
          {i < 2 && <path d={`M127.5 ${y + 7} l3 3 l5.5 -6`} stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
          <path d={`M146 ${y + 7} h${i === 1 ? 22 : 30}`} stroke="#cdd5f5" strokeOpacity={i < 2 ? 0.5 : 0.9} strokeWidth="3" strokeLinecap="round" />
        </g>
      ))}
    </>
  ),
  lab: ({ fill, stroke }) => (
    <>
      <g stroke={stroke} strokeWidth="2">
        <ellipse cx="146" cy="60" rx="44" ry="15" />
        <ellipse cx="146" cy="60" rx="44" ry="15" transform="rotate(60 146 60)" />
        <ellipse cx="146" cy="60" rx="44" ry="15" transform="rotate(-60 146 60)" />
      </g>
      <circle cx="146" cy="60" r="10" fill={fill} />
      <circle cx="146" cy="60" r="18" fill={fill} opacity=".2" />
      <circle cx="190" cy="60" r="4" fill="#bfe9ff" />
      <circle cx="124" cy="22" r="4" fill="#bfe9ff" />
      <circle cx="124" cy="98" r="4" fill="#bfe9ff" />
    </>
  ),
  video: ({ fill, stroke }) => (
    <>
      <rect x="96" y="22" width="96" height="66" rx="10" fill="#1a1440" stroke={stroke} strokeWidth="2" />
      {[30, 46, 62, 78].map((x) => (
        <g key={x}>
          <rect x={x + 76} y="26" width="8" height="6" rx="1.5" fill="#fff" opacity=".25" />
          <rect x={x + 76} y="78" width="8" height="6" rx="1.5" fill="#fff" opacity=".25" />
        </g>
      ))}
      <circle cx="144" cy="55" r="17" fill={fill} />
      <path d="M139 46 l14 9 l-14 9 z" fill="#fff" />
      <path d="M100 104 h88" stroke={stroke} strokeWidth="3" strokeLinecap="round" opacity=".5" />
      <path d="M100 104 h38" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  exams: ({ fill, stroke, to }) => (
    <>
      <rect x="104" y="18" width="70" height="90" rx="10" fill="#151a46" stroke={stroke} strokeWidth="2" />
      <rect x="124" y="12" width="30" height="12" rx="5" fill={fill} />
      <circle cx="139" cy="52" r="17" stroke={to} strokeOpacity=".25" strokeWidth="5" />
      <circle cx="139" cy="52" r="17" stroke={stroke} strokeWidth="5" strokeLinecap="round" strokeDasharray="80 107" transform="rotate(-90 139 52)" />
      <text x="139" y="57" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="Poppins, sans-serif">A</text>
      <path d="M118 82 h42 M118 94 h30" stroke="#cdd5f5" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  flashcards: ({ fill, from }) => (
    <>
      <rect x="100" y="34" width="70" height="50" rx="8" fill={from} opacity=".45" transform="rotate(-16 135 59)" />
      <rect x="110" y="28" width="70" height="50" rx="8" fill={fill} opacity=".8" transform="rotate(-7 145 53)" />
      <rect x="120" y="24" width="72" height="52" rx="8" fill="#f4f6ff" transform="rotate(3 156 50)" />
      <path d="M134 46 h40 M138 56 h30" stroke="#3b3f7a" strokeWidth="3" strokeLinecap="round" transform="rotate(3 156 50)" />
      <path d="M170 92 a8 8 0 1 1 1 0" stroke="#22c55e" strokeWidth="3" />
    </>
  ),
  calendar: ({ fill, stroke }) => (
    <>
      <rect x="104" y="20" width="88" height="84" rx="10" fill="#0f2238" stroke={stroke} strokeWidth="2" />
      <rect x="104" y="20" width="88" height="18" rx="9" fill={fill} />
      {Array.from({ length: 12 }, (_, i) => {
        const x = 114 + (i % 4) * 19;
        const y = 46 + Math.floor(i / 4) * 18;
        return <rect key={i} x={x} y={y} width="13" height="12" rx="3" fill={i === 6 ? fill : '#fff'} opacity={i === 6 ? 1 : 0.14} />;
      })}
      <circle cx="171" cy="88" r="2.5" fill="#fbbf24" />
    </>
  ),
  stats: ({ fill, stroke }) => (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={110 + i * 17} y={96 - [28, 44, 36, 60, 74][i]} width="11" height={[28, 44, 36, 60, 74][i]} rx="3" fill={fill} opacity={0.45 + i * 0.12} />
      ))}
      <path d="M104 74 L125 60 L142 66 L160 42 L190 24" stroke="#fff" strokeOpacity=".85" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="190" cy="24" r="4.5" fill="#fff" />
      <path d="M102 100 h92" stroke={stroke} strokeWidth="2" opacity=".6" />
    </>
  ),
  settings: ({ fill, stroke }) => (
    <>
      <circle cx="150" cy="58" r="26" stroke={stroke} strokeWidth="10" strokeDasharray="9 7.4" />
      <circle cx="150" cy="58" r="19" fill={fill} opacity=".5" />
      <circle cx="150" cy="58" r="8" fill="#0c1331" stroke="#fff" strokeOpacity=".6" strokeWidth="2" />
      <circle cx="104" cy="92" r="14" stroke={stroke} strokeWidth="7" strokeDasharray="6 5" opacity=".7" />
      <circle cx="104" cy="92" r="5" fill="#0c1331" />
    </>
  ),
  board: ({ stroke }) => (
    <>
      <rect x="96" y="16" width="98" height="80" rx="8" fill="#0c2a22" stroke={stroke} strokeWidth="2" />
      <path d="M108 80 h74 M114 86 v-60" stroke="#d9f99d" strokeOpacity=".45" strokeWidth="1.5" />
      <path d="M118 30 Q140 98 172 34" stroke="#bbf7d0" strokeWidth="2.5" strokeLinecap="round" />
      <text x="150" y="44" fontSize="12" fill="#f0fdf4" fontStyle="italic" fontFamily="Georgia, serif">y = x²</text>
      <path d="M130 104 h40" stroke="#fde68a" strokeWidth="5" strokeLinecap="round" />
    </>
  ),
  maps: ({ fill, stroke, to }) => (
    <>
      <g stroke={stroke} strokeWidth="2" opacity=".85">
        <path d="M146 58 L112 28 M146 58 L186 30 M146 58 L114 96 M146 58 L186 92" />
      </g>
      <rect x="126" y="48" width="40" height="20" rx="7" fill={fill} />
      {[
        [104, 20],
        [178, 22],
        [106, 88],
        [178, 84],
      ].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="18" height="14" rx="5" fill="#0e2c34" stroke={i % 2 ? to : '#7c9bff'} strokeWidth="2" />
      ))}
    </>
  ),
  focus: ({ stroke, from }) => (
    <>
      <circle cx="150" cy="60" r="40" stroke="#fff" strokeOpacity=".1" strokeWidth="8" />
      <circle cx="150" cy="60" r="40" stroke={stroke} strokeWidth="8" strokeLinecap="round" strokeDasharray="170 252" transform="rotate(-90 150 60)" />
      <circle cx="150" cy="60" r="26" stroke={from} strokeOpacity=".35" strokeWidth="2" strokeDasharray="2 5" />
      <text x="150" y="66" textAnchor="middle" fontSize="16" fontWeight="600" fill="#fff" fontFamily="JetBrains Mono Variable, monospace">25:00</text>
    </>
  ),
  tutor: ({ fill, stroke }) => (
    <>
      <rect x="104" y="22" width="70" height="40" rx="14" fill={fill} />
      <path d="M118 62 l-6 12 l16 -12" fill={fill} />
      <path d="M118 42 h44" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".8" />
      <g stroke={stroke} strokeWidth="3" strokeLinecap="round">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <path key={i} d={`M${130 + i * 9} ${96 - [6, 14, 22, 12, 18, 8, 4][i]} v${[6, 14, 22, 12, 18, 8, 4][i] * 2}`} />
        ))}
      </g>
    </>
  ),
};
