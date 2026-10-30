import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Box, Clock, Ellipsis, EllipsisVertical, FileText, Layers, List, Mic, MessageSquareText, Play, Plus, Quote, Rocket, SquareCheck, Target, WandSparkles, CircleQuestionMark, MessageCircle, Lightbulb } from 'lucide-react';
import { db, type Subject } from '@/lib/db';
import { getStudyStats, subjectProgress, type StudyStats } from '@/lib/stats';
import { SubjectGlyph, subjectStyle } from '@/lib/subjects';
import { fmtDate, fmtMinutes, relativeDay, startOfDay, timeAgo, addDays } from '@/lib/format';
import { weakConcepts } from '@/lib/mastery';
import { useSettings } from '@/stores/settings';
import { Mountains, Flame } from '@/components/layout/Brand';
import { AvatarView } from '@/features/avatar/AvatarView';
import { ImportDialog } from '@/features/library/ImportDialog';
import { NewSubjectDialog } from '@/features/subjects/NewSubjectDialog';
import { cx } from '@/components/ui';
import { DocTypeIcon } from '@/components/DocTypeIcon';

function Card({ title, action, children, className, ...rest }: { title: string; action?: ReactNode; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cx('panel p-3.5', className)} {...rest}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold text-[15px] xl:text-[16px] text-white leading-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SeeAll({ to, label = 'Ver todas' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="flex items-center gap-1 text-[11.5px] text-[#8ea2ff] hover:text-[#b9c6ff] whitespace-nowrap shrink-0">
      {label} <ArrowRight className="size-3.5" />
    </Link>
  );
}

const ACTIONS = [
  { key: 'upload', title: 'Subir documento', sub: 'PDF, imágenes, apuntes...', grad: 'from-[#5a5cff] to-[#7a3cf0]', icon: FileText },
  { key: 'tutor', title: 'Profesor IA', sub: 'Explica, resuelve, conversa...', grad: 'from-[#2e7bff] to-[#3d4dff]', icon: MessageCircle, to: '/tutor' },
  { key: 'summary', title: 'Generar resumen', sub: 'Desde un tema o archivo', grad: 'from-[#12a58a] to-[#0d7d72]', icon: List, to: '/library?pick=summary' },
  { key: 'exam', title: 'Crear examen', sub: 'Practica lo aprendido', grad: 'from-[#8b4dff] to-[#6a2fe0]', icon: CircleQuestionMark, to: '/exams?new=1' },
  { key: 'lab', title: 'Laboratorio 3D', sub: 'Simulaciones interactivas', grad: 'from-[#1f6dff] to-[#1a47c8]', icon: Box, to: '/lab' },
  { key: 'video', title: 'Generar video', sub: 'Animaciones educativas', grad: 'from-[#e0389a] to-[#a92ad6]', icon: Play, to: '/video' },
] as const;

function TodayChip({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-[#0b1030]/70 border border-white/15 text-[11.5px] text-[#e3e8ff] backdrop-blur-sm">
      {icon}
      {label}
    </Link>
  );
}

function SubjectTile({ s, progress }: { s: Subject; progress?: { score: number; concepts: number } }) {
  const st = subjectStyle(s.color);
  const pct = progress ? Math.round(progress.score * 100) : null;
  return (
    <Link to={`/subjects/${s.id}`} className="relative flex flex-col gap-1 rounded-[10px] p-2.5 pb-3 text-white min-h-[96px] transition hover:brightness-110" style={{ background: st.bg, border: `1px solid ${st.border}` }}>
      <span className="h-[26px] flex items-center">
        <SubjectGlyph icon={s.icon} className="size-6" color={s.icon === 'leaf' ? st.bar : undefined} />
      </span>
      <span className="text-[13px] font-semibold truncate pr-3" title={s.name}>{s.name}</span>
      <span className="flex justify-between gap-1 text-[11px] whitespace-nowrap" style={{ color: st.soft }} title={pct === null ? 'Todavía no hay resultados en esta materia' : undefined}>
        <span>Progreso</span>
        <span>{pct === null ? '—' : `${pct}%`}</span>
      </span>
      <span className="block h-1 rounded bg-white/20">
        <span className="block h-1 rounded" style={{ width: `${pct ?? 0}%`, background: st.bar }} />
      </span>
      <Ellipsis className="hidden sm:block absolute top-2 right-2 size-3.5 opacity-80" />
    </Link>
  );
}

function Donut({ value }: { value: number | null }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <div className="relative size-[132px] shrink-0">
      <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={value === null ? 'Sin datos de progreso todavía' : `Dominio general ${Math.round(v * 100)}%`}>
        <defs>
          <linearGradient id="donut-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset=".6" stopColor="#3d7bff" />
            <stop offset="1" stopColor="#5b5cff" />
          </linearGradient>
        </defs>
        <circle cx="66" cy="66" r={r} fill="none" stroke="rgba(120,140,255,.14)" strokeWidth="10" />
        {value !== null && <circle cx="66" cy="66" r={r} fill="none" stroke="url(#donut-g)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 66 66)" />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="font-display font-semibold text-2xl text-white">{value === null ? '—' : `${Math.round(v * 100)}%`}</span>
        <span className="text-[10px] text-[#b2bcdf] text-center leading-tight px-4">{value === null ? 'Respondé ejercicios para medirlo' : 'Progreso general'}</span>
      </div>
    </div>
  );
}

function WeekBars({ days }: { days: StudyStats['last7'] }) {
  const max = Math.max(30, ...days.map((d) => d.minutes));
  const best = days.reduce((b, d) => (d.minutes > b.minutes ? d : b), days[0]);
  const letters = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  return (
    <div className="flex-1 min-w-[180px] flex flex-col gap-1.5">
      <span className="text-xs text-[#c3cbe6]">Últimos 7 días</span>
      <div className="relative h-24 grid grid-cols-7 items-end gap-2 px-1 border-l border-b border-[#96a5dc]/25 bg-[repeating-linear-gradient(0deg,transparent_0_23px,rgba(150,165,220,.08)_23px_24px)]">
        {days.map((d, i) => (
          <span key={d.day} className="relative block rounded-t-[3px]" style={{ height: `${Math.max(d.minutes ? 6 : 0, (d.minutes / max) * 100)}%`, background: i >= 4 ? 'linear-gradient(180deg,#a77dff,#7550f0)' : 'linear-gradient(180deg,#5b7bff,#3a56e8)' }} title={`${fmtDate(d.day, { weekday: 'long' })}: ${fmtMinutes(d.minutes)}`}>
            {d === best && d.minutes > 0 && (
              <span className="absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 text-[11px] text-white bg-[#121b3e] border border-[#8ca0ff]/60 rounded-md px-1.5 py-0.5 whitespace-nowrap">{fmtMinutes(d.minutes)}</span>
            )}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2 px-1 text-[10px] text-[#9ea9cc] text-center">
        {days.map((d) => (
          <span key={d.day}>{letters[new Date(d.day).getDay()]}</span>
        ))}
      </div>
      {days.every((d) => d.minutes === 0) && <span className="text-[11px] text-faint">Se registra con Focus, exámenes, tareas y flashcards.</span>}
    </div>
  );
}

function MiniStat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2.5 rounded-xl bg-[#121a3a]/80 border border-line">
      {icon}
      <div className="flex flex-col min-w-0">
        <span className="font-display font-semibold text-[17px] text-white">{value}</span>
        <span className="text-[11px] leading-tight text-[#b2bcdf]">{label}</span>
      </div>
    </div>
  );
}

function HoloBoard() {
  return (
    <div className="holo absolute left-2.5 top-4 w-[64%] h-[78%] rounded-md [transform:perspective(600px)_rotateY(14deg)] origin-left" aria-hidden="true">
      <svg viewBox="0 0 220 250" className="absolute inset-0 size-full">
        <g stroke="#7fd8ff" fill="none" strokeWidth="1.2" opacity=".9">
          <ellipse cx="62" cy="92" rx="46" ry="16" />
          <ellipse cx="62" cy="92" rx="46" ry="16" transform="rotate(60 62 92)" />
          <ellipse cx="62" cy="92" rx="46" ry="16" transform="rotate(-60 62 92)" />
        </g>
        <circle cx="62" cy="92" r="9" fill="#7fb4ff" />
        <circle cx="62" cy="92" r="16" fill="#7fb4ff" opacity=".18" />
        <circle cx="106" cy="92" r="3" fill="#bfe9ff" />
        <circle cx="40" cy="54" r="3" fill="#bfe9ff" />
        <circle cx="40" cy="130" r="3" fill="#bfe9ff" />
        <text x="128" y="62" fill="#bfe6ff" fontFamily="Georgia, serif" fontStyle="italic" fontSize="17">F = ma</text>
        <text x="122" y="112" fill="#bfe6ff" fontFamily="Georgia, serif" fontStyle="italic" fontSize="17">E = mc²</text>
        <path d="M118 150 l4 -14 l3 22 l4 -30 l4 36 l4 -20 l4 10" stroke="#8fd9ff" fill="none" strokeWidth="1.2" />
        <path d="M12 210 L30 210 L36 170 L44 205 L52 150 L60 200 L68 180 L76 210 L100 210" stroke="#6fc8ff" fill="none" strokeWidth="1.4" />
        <path d="M12 210 L30 210 L36 170 L44 205 L52 150 L60 200 L68 180 L76 210 L100 210 L100 214 L12 214 Z" fill="#3d9bff" opacity=".18" />
        <g stroke="#6fc8ff" strokeWidth="1" fill="none" opacity=".7">
          <path d="M118 196 h70" />
          <path d="M118 206 h52" />
          <path d="M118 186 h40" />
        </g>
      </svg>
    </div>
  );
}

function TutorPanel() {
  const nav = useNavigate();
  const character = useSettings((s) => s.s.avatar.character);
  const show3d = useSettings((s) => s.s.avatar.show);
  const [msg, setMsg] = useState('');
  const quick = [
    { label: 'Explicame un tema', icon: MessageSquareText, color: 'text-[#8ea2ff]', q: 'Explicame un tema: ' },
    { label: 'Resolvé un ejercicio', icon: WandSparkles, color: 'text-[#b18cff]', q: 'Ayudame a resolver este ejercicio paso a paso: ' },
    { label: 'Generá un resumen', icon: FileText, color: 'text-[#8ea2ff]', to: '/library?pick=summary' },
    { label: 'Creá un examen', icon: CircleQuestionMark, color: 'text-[#b18cff]', to: '/exams?new=1' },
  ];
  const send = () => {
    if (!msg.trim()) return nav('/tutor');
    nav(`/tutor?q=${encodeURIComponent(msg.trim())}&send=1`);
  };
  return (
    <aside aria-label="Profesor IA" className="relative overflow-hidden rounded-[18px] border border-line-strong bg-[linear-gradient(180deg,#121a44_0%,#0d1334_55%,#0b1029_100%)] p-3.5 flex flex-col gap-3 min-h-[480px] sm:min-h-[560px]">
      <div className="relative z-10 flex flex-col gap-2">
        <h2 className="font-display font-semibold text-xl text-white">Profesor IA</h2>
        <span className="self-start inline-flex items-center gap-1.5 text-[11px] text-[#c9f7dc] bg-ok/15 border border-ok/35 rounded-full px-2.5 py-0.5">
          <span className="size-[7px] rounded-full bg-ok" /> En línea
        </span>
      </div>
      <div className="relative flex-1 min-h-[250px] sm:min-h-[300px] -mx-3.5">
        <HoloBoard />
        {show3d ? <AvatarView character={character} framing="half" facing={-0.42} className="absolute inset-y-0 right-0 w-[72%]" /> : <img src="./teacher-seed.png" alt="Profesora virtual" className="absolute right-0 bottom-0 h-full w-auto object-contain" />}
      </div>
      <div className="relative z-10 -mt-10 self-start max-w-[88%] px-4 py-3 rounded-2xl rounded-bl-sm bg-[#161e46]/95 border border-line-strong text-sm">¿En qué te gustaría que te ayude hoy?</div>
      <div className="relative z-10 grid grid-cols-2 gap-2">
        {quick.map((q) => (
          <button key={q.label} onClick={() => nav(q.to ?? `/tutor?q=${encodeURIComponent(q.q!)}`)} className="flex items-center gap-2 min-h-11 px-3 rounded-[10px] bg-[#121a3e]/90 border border-line-strong text-xs text-left hover:bg-[#18224e]">
            <q.icon className={cx('size-4 shrink-0', q.color)} />
            {q.label}
          </button>
        ))}
      </div>
      <form
        className="relative z-10 flex items-center gap-2 mt-1.5 pl-3.5 pr-1.5 py-1.5 rounded-2xl bg-[#0a102a]/95 border border-line-strong"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="flex-1 min-w-0">
          <span className="sr-only">Mensaje al profesor</span>
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Escribí tu mensaje o usá el micrófono..." className="w-full bg-transparent outline-none text-[14px] sm:text-[12.5px] placeholder:text-[#7f8db0]" />
        </label>
        <button type="button" onClick={() => nav('/tutor?voice=1')} aria-label="Hablar por micrófono" className="grid place-items-center size-11 rounded-xl text-[#c3cbea] hover:text-white">
          <Mic className="size-[18px]" />
        </button>
        <button type="submit" aria-label="Enviar" className="grid place-items-center size-11 rounded-full bg-gradient-to-br from-[#4d6bff] to-[#3a4fe0] text-white shadow-[0_6px_20px_-6px_rgba(80,110,255,.9)]">
          <ArrowRight className="size-[18px]" />
        </button>
      </form>
    </aside>
  );
}

function ModuleCard({ title, badge, text, cta, to, art, ctaClass }: { title: string; badge?: string; text: string; cta: string; to: string; art: ReactNode; ctaClass: string }) {
  return (
    <section aria-label={title} className="relative overflow-hidden min-h-[206px] rounded-2xl border border-line-strong/80 bg-[#0b1030] p-3.5 px-4 flex flex-col justify-between gap-2.5">
      {art}
      <div className="relative flex items-center gap-2">
        <h2 className="font-display font-semibold text-base text-white">{title}</h2>
        {badge && <span className="text-[10.5px] font-semibold text-white bg-[#6d4dff] rounded-md px-1.5 py-0.5">{badge}</span>}
      </div>
      <div className="relative flex flex-col gap-2.5">
        <p className="text-xs leading-relaxed text-[#dbe1f7]">{text}</p>
        <Link to={to} className={cx('self-start inline-flex items-center gap-2 min-h-9 px-4 rounded-[10px] text-white text-[12.5px] font-semibold', ctaClass)}>
          {cta} <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </section>
  );
}

const SolarArt = (
  <svg aria-hidden="true" viewBox="0 0 320 206" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
    <defs>
      <radialGradient id="lab-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#fff4c2" /><stop offset=".35" stopColor="#ffb43a" /><stop offset=".7" stopColor="#ff7a1a" stopOpacity=".55" /><stop offset="1" stopColor="#ff6a00" stopOpacity="0" /></radialGradient>
      <radialGradient id="lab-p1" cx=".35" cy=".35" r=".7"><stop offset="0" stopColor="#e8c9a0" /><stop offset="1" stopColor="#7a5232" /></radialGradient>
      <radialGradient id="lab-p2" cx=".35" cy=".35" r=".7"><stop offset="0" stopColor="#9fd0ff" /><stop offset="1" stopColor="#2a4f9a" /></radialGradient>
      <radialGradient id="lab-p3" cx=".35" cy=".35" r=".7"><stop offset="0" stopColor="#ffb08a" /><stop offset="1" stopColor="#8a3a22" /></radialGradient>
      <linearGradient id="lab-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#090d22" stopOpacity=".2" /><stop offset=".55" stopColor="#090d22" stopOpacity="0" /><stop offset="1" stopColor="#090d22" stopOpacity=".92" /></linearGradient>
    </defs>
    <rect width="320" height="206" fill="#090d22" />
    <g fill="none" stroke="#c7c2ff" strokeOpacity=".35">
      <ellipse cx="225" cy="98" rx="60" ry="18" />
      <ellipse cx="225" cy="98" rx="100" ry="32" />
      <ellipse cx="225" cy="98" rx="140" ry="46" />
    </g>
    <circle cx="225" cy="98" r="34" fill="url(#lab-sun)" />
    <circle cx="225" cy="98" r="15" fill="#ffd36a" />
    <circle cx="168" cy="108" r="8" fill="url(#lab-p2)" />
    <circle cx="128" cy="92" r="11" fill="url(#lab-p1)" />
    <ellipse cx="128" cy="92" rx="19" ry="4" fill="none" stroke="#e8d2b0" strokeOpacity=".7" strokeWidth="1.4" />
    <circle cx="92" cy="128" r="14" fill="url(#lab-p3)" />
    <rect width="320" height="206" fill="url(#lab-fade)" />
  </svg>
);

const VideoArt = (
  <>
    <svg aria-hidden="true" viewBox="0 0 320 206" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
      <defs>
        <linearGradient id="vid-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#16246a" /><stop offset="1" stopColor="#0b1030" /></linearGradient>
        <radialGradient id="vid-a1" cx=".35" cy=".35" r=".7"><stop offset="0" stopColor="#ff9aa8" /><stop offset="1" stopColor="#c0263a" /></radialGradient>
        <radialGradient id="vid-a2" cx=".35" cy=".35" r=".7"><stop offset="0" stopColor="#9aa8c8" /><stop offset="1" stopColor="#2a3350" /></radialGradient>
        <linearGradient id="vid-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1030" stopOpacity=".1" /><stop offset=".5" stopColor="#0b1030" stopOpacity="0" /><stop offset="1" stopColor="#0b1030" stopOpacity=".95" /></linearGradient>
      </defs>
      <rect width="320" height="206" fill="url(#vid-bg)" />
      <g stroke="#5ea8ff" strokeOpacity=".35" fill="none">
        <rect x="18" y="40" width="70" height="44" rx="4" />
        <path d="M24 76 l10 -14 l8 8 l10 -18 l10 12 l10 -6" />
        <rect x="240" y="44" width="62" height="70" rx="4" />
        <path d="M248 58 h46 M248 68 h36 M248 78 h42 M248 88 h28" />
      </g>
      <g stroke="#dfe6ff" strokeWidth="3.5" strokeLinecap="round">
        <path d="M150 62 L188 50" /><path d="M188 50 L222 70" /><path d="M188 50 L196 24" /><path d="M150 62 L132 92" /><path d="M222 70 L236 100" />
      </g>
      <circle cx="150" cy="62" r="13" fill="url(#vid-a1)" /><circle cx="188" cy="50" r="15" fill="url(#vid-a2)" /><circle cx="222" cy="70" r="12" fill="url(#vid-a1)" /><circle cx="196" cy="24" r="9" fill="url(#vid-a1)" /><circle cx="132" cy="92" r="9" fill="url(#vid-a2)" /><circle cx="236" cy="100" r="8" fill="url(#vid-a1)" />
      <rect width="320" height="206" fill="url(#vid-fade)" />
    </svg>
    <span className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 grid place-items-center size-[52px] rounded-full border-2 border-white/85 bg-[#0a1030]/55 text-white" aria-hidden="true">
      <Play className="size-5 fill-white" />
    </span>
  </>
);

const MapArt = (
  <div className="absolute inset-x-4 top-12 h-[104px]" aria-hidden="true">
    <svg viewBox="0 0 260 104" preserveAspectRatio="none" className="absolute inset-0 size-full">
      <g stroke="#3fd7c7" strokeWidth="1.3" fill="none" opacity=".8">
        <path d="M40 70 L70 26" /><path d="M40 70 L86 84" /><path d="M110 56 L176 14" /><path d="M110 56 L70 26" /><path d="M110 56 L196 50" /><path d="M110 56 L196 92" /><path d="M86 84 L110 56" />
      </g>
    </svg>
    <span className="absolute left-[22%] top-2 -translate-x-1/2 text-[9.5px] px-1.5 py-0.5 rounded-md border border-[#6e8cff]/70 bg-[#121b45] whitespace-nowrap">Energía cinética</span>
    <span className="absolute left-[70%] top-0 text-[9.5px] px-1.5 py-0.5 rounded-md border border-[#46dcbe]/80 bg-[#0e2c34] whitespace-nowrap">Energía potencial</span>
    <span className="absolute left-[42%] top-11 -translate-x-1/2 font-display font-semibold text-[13px] px-3 py-1 rounded-lg border border-[#6e8cff]/90 bg-[#1a2a78]">Energía</span>
    <span className="absolute left-[76%] top-10 text-[9.5px] px-1.5 py-0.5 rounded-md border border-[#be8cff]/80 bg-[#2a1a55]">Trabajo</span>
    <span className="absolute left-[76%] top-[82px] text-[9.5px] px-1.5 py-0.5 rounded-md border border-[#46dcbe]/80 bg-[#0e2c34]">Potencia</span>
    <span className="absolute left-[8%] top-14 grid place-items-center size-7 rounded-full bg-[#1fb3a1]"><Box className="size-3.5" /></span>
    <span className="absolute left-[30%] top-[74px] size-[22px] rounded-full bg-primary grid place-items-center"><span className="size-2 rounded-full border-2 border-white" /></span>
  </div>
);

function FlashArt({ due }: { due: number }) {
  return (
    <div className="absolute inset-x-4 top-12 h-[104px]" aria-hidden="true">
      <div className="absolute left-[14%] top-[18px] w-[64%] h-[76px] rounded-[10px] bg-gradient-to-br from-[#5a4dd6] to-[#3b2fa8] -rotate-[10deg]" />
      <div className="absolute left-[20%] top-2.5 w-[64%] h-[78px] rounded-[10px] bg-gradient-to-br from-[#8577f0] to-[#5a4dd6] -rotate-[5deg]" />
      <div className="absolute left-[27%] top-0.5 w-[64%] h-[82px] rounded-[10px] bg-[#f4f6ff] -rotate-3 shadow-[0_14px_30px_-10px_rgba(0,0,0,.6)] grid place-items-center px-3 pr-8">
        <span className="font-display font-medium text-xs text-[#1a2140] text-center">{due > 0 ? `${due} tarjeta${due === 1 ? '' : 's'} para hoy` : '¿Qué es la fotosíntesis?'}</span>
        <Lightbulb className="absolute right-2 bottom-2 size-5 text-[#22b35a]" />
      </div>
    </div>
  );
}

export function Dashboard() {
  const nav = useNavigate();
  const name = useSettings((s) => s.s.profile.name);
  const [importOpen, setImportOpen] = useState(false);
  const [newSubject, setNewSubject] = useState(false);
  const subjects = useLiveQuery(() => db.subjects.orderBy('createdAt').toArray(), []) ?? [];
  // Al cambiar la cantidad de materias, el carrusel vuelve al inicio (el scroll-snap
  // se queda enganchado al botón «Agregar» si las materias se insertan antes).
  const subjectRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    subjectRow.current?.scrollTo({ left: 0 });
  }, [subjects.length]);
  const subjectsById = new Map(subjects.map((s) => [s.id, s]));
  const docs = useLiveQuery(() => db.documents.orderBy('createdAt').reverse().limit(4).toArray(), []) ?? [];
  const exams = useLiveQuery(() => db.events.where('start').aboveOrEqual(startOfDay()).filter((e) => e.type === 'exam').limit(3).toArray(), []) ?? [];
  const tasks = useLiveQuery(() => db.tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'needs_review').toArray(), []) ?? [];
  const todaySessions = useLiveQuery(() => db.events.where('start').between(startOfDay(), addDays(startOfDay(), 1)).filter((e) => (e.type === 'study' || e.type === 'review' || e.type === 'task') && !e.taskId).toArray(), []) ?? [];
  const dueCards = useLiveQuery(() => db.cards.where('due').belowOrEqual(Date.now()).count(), []) ?? 0;
  const tick = useLiveQuery(() => Promise.all([db.activity.count(), db.focus.count(), db.reviews.count(), db.mastery.count(), db.examAttempts.count(), db.taskAttempts.count()]).then((x) => x.join()), []);
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [progress, setProgress] = useState<Map<string, { score: number; concepts: number }>>(new Map());
  const weak = useLiveQuery(() => weakConcepts(undefined, 3), [tick]) ?? [];
  useEffect(() => {
    getStudyStats().then(setStats);
    subjectProgress().then(setProgress);
  }, [tick]);

  const sortedTasks = [...tasks].sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || b.createdAt - a.createdAt);

  return (
    <div className="space-y-3.5">
      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3.5">
          {/* Hero */}
          <section aria-label="Bienvenida" className="relative overflow-hidden rounded-[20px] sm:rounded-2xl min-h-[116px] border border-line-strong bg-[#0d1230] flex flex-wrap items-center justify-between gap-4 px-4 sm:px-7 py-4 sm:py-5">
            <Mountains variant="hero" className="absolute inset-0 size-full" />
            <div className="relative min-w-0">
              <p className="sm:hidden text-[11px] uppercase tracking-[.14em] text-[#aab6e8] mb-1">{fmtDate(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              <h1 className="font-display font-bold text-[28px] sm:text-[36px] tracking-tight text-white leading-tight">¡Hola{name.trim() ? `, ${name.trim().split(' ')[0]}` : ''}!</h1>
              <p className="flex items-center gap-2 text-[15px] sm:text-lg text-[#e3e8ff] mt-1">
                Hoy es un gran día para aprender <Rocket className="size-5 text-[#ff8a3d]" />
              </p>
              {/* Resumen del día (celular): solo datos registrados */}
              <div className="sm:hidden flex flex-wrap gap-1.5 mt-3">
                <TodayChip to="/stats" icon={<Flame className="size-3.5" />} label={`${stats?.streak ?? 0} ${stats?.streak === 1 ? 'día' : 'días'} de racha`} />
                <TodayChip to="/tasks" icon={<SquareCheck className="size-3.5 text-[#c4a6ff]" />} label={`${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'}`} />
                <TodayChip to="/flashcards" icon={<Layers className="size-3.5 text-[#8ea2ff]" />} label={`${dueCards} ${dueCards === 1 ? 'tarjeta' : 'tarjetas'} hoy`} />
              </div>
            </div>
            <div className="relative hidden md:flex gap-2 max-w-[230px]">
              <Quote className="size-3.5 shrink-0 mt-0.5 text-[#aab6e8] fill-[#aab6e8]" />
              <p className="text-[13px] leading-relaxed text-[#e7ebff]">“El conocimiento se construye con curiosidad, constancia y las herramientas adecuadas.”</p>
            </div>
          </section>

          {/* Acciones rápidas */}
          <section aria-label="Acciones rápidas" className="grid grid-cols-3 2xl:grid-cols-6 gap-2 sm:gap-2.5">
            {ACTIONS.map((a) => (
              <button key={a.key} onClick={() => ('to' in a ? nav(a.to) : setImportOpen(true))} className="tile relative flex flex-col items-center sm:items-start gap-1.5 px-1.5 py-3 sm:p-3 sm:pb-3.5 text-center sm:text-left hover:border-line-strong active:scale-[.97] transition">
                <span className={cx('grid place-items-center size-11 sm:size-[38px] rounded-[13px] sm:rounded-[10px] bg-gradient-to-br sm:mb-1 shadow-[0_8px_18px_-10px_rgba(90,110,255,.9)]', a.grad)}>
                  <a.icon className={cx('size-5 sm:size-[19px] text-white', a.key === 'video' && 'fill-white')} />
                </span>
                <span className="text-[12px] sm:text-[13.5px] font-semibold leading-tight">{a.title}</span>
                <span className="hidden sm:block text-[11px] text-muted">{a.sub}</span>
                <Ellipsis className="hidden sm:block absolute top-3 right-3 size-4 text-muted" />
              </button>
            ))}
          </section>

          {/* Recomendaciones basadas en resultados reales */}
          {(weak.length > 0 || dueCards > 0) && (
            <section aria-label="Recomendaciones" className="flex flex-wrap items-center gap-2 tile px-3 py-2.5">
              <span className="text-xs text-muted mr-1">Recomendado para vos:</span>
              {dueCards > 0 && (
                <Link to="/flashcards" className="text-xs rounded-full border border-line-strong px-3 py-1.5 hover:bg-white/5">
                  Repasar {dueCards} flashcard{dueCards === 1 ? '' : 's'}
                </Link>
              )}
              {weak.map((w) => (
                <Link key={w.id} to={`/tasks?reinforce=${encodeURIComponent(w.concept)}${w.subjectId ? `&subject=${w.subjectId}` : ''}`} className="text-xs rounded-full border border-warn/35 bg-warn/10 text-[#ffd98a] px-3 py-1.5 hover:bg-warn/15">
                  Reforzar «{w.concept}» ({Math.round(w.score * 100)}%)
                </Link>
              ))}
            </section>
          )}

          <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Card title="Mis materias" action={<SeeAll to="/subjects" />}>
              <div ref={subjectRow} className="snap-row -mx-3.5 px-3.5 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-4 sm:gap-2.5 [&>*]:w-[38%] sm:[&>*]:w-auto">
                {subjects.slice(0, 7).map((s) => (
                  <SubjectTile key={s.id} s={s} progress={progress.get(s.id)} />
                ))}
                <button onClick={() => setNewSubject(true)} className="flex flex-col items-center justify-center gap-1.5 min-h-[96px] rounded-[10px] border-[1.5px] border-dashed border-[#96a5dc]/40 text-[#b4bedf] text-xs hover:text-white hover:border-[#96a5dc]/70">
                  <Plus className="size-5" /> Agregar materia
                </button>
              </div>
            </Card>

            <Card title="Mi progreso" action={<SeeAll to="/stats" label="Ver estadísticas" />} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <Donut value={stats?.overallMastery ?? null} />
                {stats && <WeekBars days={stats.last7} />}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <MiniStat icon={<Flame className="size-6 shrink-0" />} value={String(stats?.streak ?? 0)} label="Días de racha" />
                <MiniStat icon={<Clock className="size-6 shrink-0 text-[#6f8cff]" />} value={stats ? (stats.weekMinutes >= 60 ? `${Math.round(stats.weekMinutes / 6) / 10}h` : `${Math.round(stats.weekMinutes)}m`) : '0m'} label="Esta semana" />
                <MiniStat icon={<Target className="size-6 shrink-0 text-[#c77dff]" />} value={String(stats?.masteredConcepts ?? 0)} label="Temas dominados" />
              </div>
            </Card>
          </div>

          <div className="grid gap-3.5 md:grid-cols-3">
            <Card title="Últimos documentos" action={<SeeAll to="/library" label="Ver todos" />}>
              {docs.length === 0 ? (
                <button onClick={() => setImportOpen(true)} className="w-full text-left text-sm text-muted py-6">
                  Todavía no subiste material. <span className="text-[#8ea2ff]">Subí tu primer documento →</span>
                </button>
              ) : (
                <ul>
                  {docs.map((d) => (
                    <li key={d.id} className="border-b border-[#96a5dc]/10 last:border-0">
                      <Link to={`/library/${d.id}`} className="flex items-center gap-2.5 py-2">
                        <DocTypeIcon kind={d.kind} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12.5px] truncate">{d.title}</span>
                          <span className="block text-[10.5px] text-muted truncate">
                            {d.subjectId && subjectsById.get(d.subjectId) ? <span style={{ color: subjectStyle(subjectsById.get(d.subjectId)!.color).text }}>{subjectsById.get(d.subjectId)!.name}</span> : 'Sin materia'} · {d.pageCount} {d.unitLabel.toLowerCase()}
                            {d.pageCount === 1 ? '' : 's'} · {timeAgo(d.createdAt)}
                          </span>
                        </span>
                        {d.status === 'processing' ? <span className="text-[10px] text-cyan">Procesando…</span> : <Ellipsis className="size-4 text-muted" />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Próximos exámenes" action={<SeeAll to="/calendar" label="Ver calendario" />}>
              {exams.length === 0 ? (
                <Link to="/calendar?new=exam" className="block text-sm text-muted py-6">
                  No hay exámenes agendados. <span className="text-[#8ea2ff]">Registrar una fecha →</span>
                </Link>
              ) : (
                <ul className="space-y-2">
                  {exams.map((e) => {
                    const s = e.subjectId ? subjectsById.get(e.subjectId) : undefined;
                    const st = subjectStyle(s?.color);
                    return (
                      <li key={e.id}>
                        <Link to="/calendar" className="flex items-center gap-3 py-1">
                          <span className="grid place-items-center size-9 rounded-[9px] text-white shrink-0" style={{ background: st.bg }}>
                            <SubjectGlyph icon={s?.icon ?? 'book'} className="size-[18px]" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[12.5px] truncate">{e.title}</span>
                            <span className="block text-[10.5px] text-muted">
                              {fmtDate(e.start, { day: 'numeric', month: 'long' })} · {relativeDay(e.start)}
                            </span>
                          </span>
                          <EllipsisVertical className="size-4 text-muted" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card title="Tareas pendientes" action={<SeeAll to="/tasks" />}>
              {sortedTasks.length === 0 && todaySessions.length === 0 ? (
                <Link to="/tasks?new=1" className="block text-sm text-muted py-6">
                  No tenés tareas pendientes. <span className="text-[#8ea2ff]">Crear tarea con IA →</span>
                </Link>
              ) : (
                <ul className="space-y-1.5">
                  {todaySessions.slice(0, 2).map((e) => (
                    <li key={e.id} className="flex items-start gap-2.5 py-0.5">
                      <input type="checkbox" aria-label={`Marcar "${e.title}" como hecha`} checked={e.done} onChange={(ev) => db.events.update(e.id, { done: ev.target.checked })} className="mt-0.5 size-4 accent-primary" />
                      <span className="flex flex-col">
                        <span className={cx('text-[12.5px]', e.done && 'line-through text-muted')}>{e.title}</span>
                        <span className="text-[10.5px] text-muted">Plan de estudio · Hoy</span>
                      </span>
                    </li>
                  ))}
                  {sortedTasks.slice(0, 4 - Math.min(2, todaySessions.length)).map((t) => {
                    const s = t.subjectId ? subjectsById.get(t.subjectId) : undefined;
                    const overdue = t.dueDate && t.dueDate < startOfDay();
                    return (
                      <li key={t.id}>
                        <Link to={`/tasks/${t.id}`} className="flex items-start gap-2.5 py-0.5">
                          <SquareCheck className={cx('size-4 mt-0.5 shrink-0', t.status === 'needs_review' ? 'text-warn' : 'text-[#5b6b95]')} />
                          <span className="flex flex-col min-w-0">
                            <span className="text-[12.5px] truncate">{t.title}</span>
                            <span className="text-[10.5px] text-muted">
                              {s ? <span style={{ color: subjectStyle(s.color).text }}>{s.name}</span> : 'General'}
                              {' · '}
                              {t.status === 'needs_review' ? <span className="text-warn">Necesita repaso</span> : t.dueDate ? <span className={overdue || relativeDay(t.dueDate) === 'hoy' ? 'text-[#ff8a8a]' : ''}>{relativeDay(t.dueDate)}</span> : t.status === 'in_progress' ? 'En progreso' : 'Pendiente'}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>

        <TutorPanel />
      </div>

      <div className="snap-row -mx-3.5 px-3.5 sm:mx-0 sm:px-0 sm:grid sm:gap-3.5 sm:grid-cols-2 xl:grid-cols-4 [&>*]:w-[80%] sm:[&>*]:w-auto">
        <ModuleCard title="Laboratorio 3D" badge="Nuevo" text="Explorá simulaciones interactivas de Física, Química, Biología y más." cta="Explorar laboratorio" to="/lab" art={SolarArt} ctaClass="border border-[#8ca0ff]/65 bg-[#283ca0]/35" />
        <ModuleCard title="Generador de videos" text="Convertí tus apuntes en videos educativos con animaciones, narración y ejemplos." cta="Crear video" to="/video" art={VideoArt} ctaClass="bg-gradient-to-r from-[#7a4dff] to-[#a04dff]" />
        <ModuleCard title="Mapas conceptuales" text="Generá mapas conceptuales a partir de tus apuntes con IA." cta="Crear mapa" to="/maps" art={MapArt} ctaClass="bg-[#2f63ff]" />
        <ModuleCard title="Flashcards" text="Tarjetas inteligentes con repetición espaciada para un mejor aprendizaje." cta={dueCards ? 'Repasar ahora' : 'Crear flashcards'} to="/flashcards" art={<FlashArt due={dueCards} />} ctaClass="bg-[#2f63ff]" />
      </div>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <NewSubjectDialog open={newSubject} onClose={() => setNewSubject(false)} />
    </div>
  );
}
