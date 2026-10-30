import { useId } from 'react';

export function Logo({ size = 44 }: { size?: number }) {
  // id único: si el mismo degradado está dentro de un elemento oculto, otros usos no lo encuentran
  const id = `brand-cap-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b7bff" />
          <stop offset="1" stopColor="#2e4bdb" />
        </linearGradient>
      </defs>
      <path d="M24 9 3 19l21 10 21-10z" fill={`url(#${id})`} />
      <path d="M11 23.5v8.5c0 3.6 5.8 6.5 13 6.5s13-2.9 13-6.5v-8.5l-13 6.2z" fill="#3f5ff0" />
      <path d="M41 21v10" stroke="#8fd3ff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="41" cy="33" r="2.4" fill="#8fd3ff" />
    </svg>
  );
}

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={compact ? 36 : 44} />
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className={`font-display font-bold tracking-tight text-white ${compact ? 'text-xl' : 'text-[25px]'}`}>StudyOS</span>
          <span className="font-display font-semibold text-[11px] text-white bg-primary rounded-md px-1.5 py-px">AI</span>
        </div>
        {!compact && <span className="text-[10px] text-muted whitespace-nowrap">Tu sistema operativo de aprendizaje</span>}
      </div>
    </div>
  );
}

/** Montañas nocturnas de fondo (decorativas). */
export function Mountains({ className, variant = 'side' }: { className?: string; variant?: 'side' | 'hero' }) {
  if (variant === 'hero')
    return (
      <svg aria-hidden="true" viewBox="0 0 920 140" preserveAspectRatio="xMidYMid slice" className={className}>
        <defs>
          <linearGradient id="h-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d1438" />
            <stop offset=".55" stopColor="#2a1d5c" />
            <stop offset=".85" stopColor="#6a2f6e" />
            <stop offset="1" stopColor="#a24a6a" />
          </linearGradient>
          <radialGradient id="h-sun" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#ffe2b0" />
            <stop offset=".25" stopColor="#ff9fb0" stopOpacity=".85" />
            <stop offset="1" stopColor="#ff7aa8" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="h-m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5a3f9e" /><stop offset="1" stopColor="#2a2160" /></linearGradient>
          <linearGradient id="h-m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2d2a72" /><stop offset="1" stopColor="#151640" /></linearGradient>
          <linearGradient id="h-m3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#15184a" /><stop offset="1" stopColor="#0a0d26" /></linearGradient>
          <linearGradient id="h-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0b1030" stopOpacity=".92" />
            <stop offset=".45" stopColor="#0b1030" stopOpacity=".2" />
            <stop offset=".75" stopColor="#0b1030" stopOpacity=".15" />
            <stop offset="1" stopColor="#0b1030" stopOpacity=".7" />
          </linearGradient>
        </defs>
        <rect width="920" height="140" fill="url(#h-sky)" />
        {[[40, 20], [160, 34], [290, 14], [420, 28], [700, 18], [820, 40], [610, 10]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={1} fill="#dfe6ff" />
        ))}
        <circle cx="600" cy="92" r="70" fill="url(#h-sun)" />
        <path d="M0 110 L70 80 L130 98 L210 62 L290 96 L360 70 L430 92 L500 58 L560 84 L610 72 L660 90 L730 60 L800 88 L860 70 L920 86 L920 140 L0 140 Z" fill="url(#h-m1)" opacity=".9" />
        <path d="M0 122 L60 104 L120 118 L200 92 L270 116 L340 100 L420 120 L500 96 L570 116 L640 102 L710 120 L790 98 L860 116 L920 104 L920 140 L0 140 Z" fill="url(#h-m2)" />
        <path d="M0 132 L80 120 L150 130 L240 116 L330 132 L420 120 L520 134 L600 122 L690 134 L780 120 L860 132 L920 124 L920 140 L0 140 Z" fill="url(#h-m3)" />
        <rect width="920" height="140" fill="url(#h-fade)" />
      </svg>
    );
  return (
    <svg aria-hidden="true" viewBox="0 0 240 420" preserveAspectRatio="xMidYMax slice" className={className}>
      <defs>
        <linearGradient id="sb-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#080d1c" stopOpacity="0" /><stop offset=".55" stopColor="#1b1747" /><stop offset="1" stopColor="#3a1d63" /></linearGradient>
        <linearGradient id="sb-m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4b3aa8" /><stop offset="1" stopColor="#1d1846" /></linearGradient>
        <linearGradient id="sb-m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a2a7a" /><stop offset="1" stopColor="#0e1030" /></linearGradient>
        <linearGradient id="sb-m3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#151a4a" /><stop offset="1" stopColor="#070a18" /></linearGradient>
      </defs>
      <rect width="240" height="420" fill="url(#sb-sky)" />
      {[[30, 150], [180, 120], [120, 175], [210, 190], [70, 110]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1} fill="#c9d3ff" />
      ))}
      <path d="M0 270 L40 225 L70 250 L110 200 L150 240 L185 215 L240 260 L240 420 L0 420 Z" fill="url(#sb-m1)" opacity=".85" />
      <path d="M0 300 L35 280 L60 300 L95 255 L135 300 L170 270 L205 295 L240 280 L240 420 L0 420 Z" fill="url(#sb-m2)" />
      <path d="M0 350 L45 320 L85 345 L120 315 L165 350 L200 330 L240 345 L240 420 L0 420 Z" fill="url(#sb-m3)" />
    </svg>
  );
}

export function Flame({ className = 'size-7' }: { className?: string }) {
  const id = `flame-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd166" />
          <stop offset=".55" stopColor="#ff8a1f" />
          <stop offset="1" stopColor="#ff4d1f" />
        </linearGradient>
      </defs>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" fill={`url(#${id})`} />
    </svg>
  );
}
