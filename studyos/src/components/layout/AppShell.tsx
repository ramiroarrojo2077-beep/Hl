import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useLiveQuery } from 'dexie-react-hooks';
import { GraduationCap, LayoutGrid, Quote, X } from 'lucide-react';
import { NAV_MAIN, NAV_MOBILE, NAV_TOOLS } from './nav';
import { SECTION_THEME, sectionGradient, sectionRoot } from './sections';
import { Brand, Flame, Mountains } from './Brand';
import { TopBar } from './TopBar';
import { JobsTray } from './JobsTray';
import { Toasts } from './Toasts';
import { cx } from '../ui';
import { getStudyStats } from '@/lib/stats';
import { db } from '@/lib/db';

function NavItem({ to, label, icon: Icon, end, onClick }: { to: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; end?: boolean; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) => cx('flex items-center gap-3.5 rounded-xl px-4 h-11 text-[14.5px] transition border border-transparent', isActive ? 'nav-active text-white font-medium' : 'text-[#cdd5f0] hover:text-white hover:bg-white/[.04]')}
    >
      <Icon className="size-5 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function StreakCard() {
  // Se recalcula cuando cambia la actividad registrada.
  const tick = useLiveQuery(() => Promise.all([db.activity.count(), db.reviews.count(), db.focus.count()]).then((x) => x.join('-')), []);
  const [streak, setStreak] = useState<number | null>(null);
  useEffect(() => {
    getStudyStats().then((s) => setStreak(s.streak));
  }, [tick]);
  return (
    <div className="relative flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-[#141a3a]/75 border border-line-strong/70">
      <Flame />
      <div className="flex flex-col">
        <span className="text-xs text-[#b8c2e6]">Racha de estudio</span>
        <span className="font-display font-semibold text-white">{streak === null ? '—' : `${streak} ${streak === 1 ? 'día' : 'días'}`}</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const immersive = loc.pathname.startsWith('/focus/session') || loc.pathname.startsWith('/video/play');
  // Pantallas que ocupan todo el alto disponible en celular (chat del profesor)
  const fitHeight = loc.pathname.startsWith('/tutor');
  const all = [...NAV_MAIN, ...NAV_TOOLS];
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [more]);
  const mobile = NAV_MOBILE.map((to) => all.find((n) => n.to === to)!);
  return (
    <div className="app-backdrop min-h-full flex">
      {!immersive && (
        <aside className="hidden lg:flex flex-col w-[236px] shrink-0 h-dvh sticky top-0 border-r border-line overflow-hidden bg-[linear-gradient(180deg,#0a1022_0%,#080d1c_60%,#0b0b22_100%)] px-3 py-[18px]">
          <div className="px-1.5">
            <Brand />
          </div>
          <nav className="mt-6 flex-1 overflow-y-auto scroll-thin space-y-1 relative z-10" aria-label="Principal">
            {NAV_MAIN.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
            <div className="pt-3 pb-1 px-4 text-[10px] uppercase tracking-[.14em] text-faint">Herramientas</div>
            {NAV_TOOLS.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
          <Mountains className="absolute inset-x-0 bottom-0 w-full h-[420px] pointer-events-none" />
          <div className="relative mt-4">
            <StreakCard />
          </div>
          <div className="relative flex gap-2 px-2.5 pt-3 text-[#dfe5ff]">
            <Quote className="size-4 shrink-0 mt-1 text-[#8b9be8] fill-[#8b9be8]" />
            <p className="text-sm leading-snug">“Un pequeño progreso cada día produce grandes resultados”</p>
          </div>
        </aside>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        {!immersive && <TopBar />}
        <main className={cx('flex-1 w-full mx-auto', immersive ? '' : 'max-w-[1440px] px-3.5 sm:px-4 lg:pl-4 lg:pr-3.5 pt-3.5 lg:pb-6', fitHeight ? 'pb-[calc(4.625rem+var(--safe-bottom))]' : 'pb-[calc(6.5rem+var(--safe-bottom))]')}>
          {/* Fundido suave al cambiar de sección (sin desmontar al cambiar de clase o tarea dentro de la misma) */}
          <div key={immersive ? 'immersive' : sectionRoot(loc.pathname)} className="page-in">
            {children}
          </div>
        </main>
      </div>

      {!immersive && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 pb-[var(--safe-bottom)] bg-[linear-gradient(180deg,rgba(13,20,48,.92),rgba(8,12,30,.98))] backdrop-blur-xl border-t border-line-strong/60 rounded-t-[22px] shadow-[0_-12px_32px_-12px_rgba(0,0,0,.7)]" aria-label="Navegación inferior">
          <div className="grid grid-cols-5 h-[62px]">
            {mobile.map((n) =>
              n.to === '/tutor' ? (
                <NavLink key={n.to} to={n.to} className="relative flex flex-col items-center justify-end pb-1.5 text-[10.5px] font-medium">
                  {({ isActive }) => (
                    <>
                      <span className={cx('absolute -top-5 grid place-items-center size-[54px] rounded-full text-white ring-[5px] ring-[#080c1e] transition', isActive ? 'shadow-[0_0_26px_-2px_rgba(110,120,255,.95)]' : 'shadow-[0_8px_22px_-8px_rgba(80,110,255,.9)]')} style={{ background: 'radial-gradient(circle at 30% 25%, #7d93ff, #4d5cff 45%, #7a3cf0)' }}>
                        <GraduationCap className="size-6" strokeWidth={1.9} />
                        <span className="absolute inset-0 rounded-full border border-white/25" />
                      </span>
                      <span className={isActive ? 'text-white' : 'text-[#aab4d8]'}>Profesor</span>
                    </>
                  )}
                </NavLink>
              ) : (
                <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition', isActive ? 'text-white' : 'text-[#8f9ac0]')}>
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute top-0 h-[3px] w-9 rounded-b-full bg-gradient-to-r from-[#6d86ff] to-violet shadow-[0_2px_12px_rgba(109,134,255,.9)]" />}
                      <n.icon className={cx('size-[22px]', isActive && 'drop-shadow-[0_0_8px_rgba(130,150,255,.7)]')} strokeWidth={isActive ? 2.1 : 1.8} />
                      {n.to === '/tasks' ? 'Tareas' : n.label}
                    </>
                  )}
                </NavLink>
              ),
            )}
            <button onClick={() => setMore(true)} className={cx('relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium', more ? 'text-white' : 'text-[#8f9ac0]')} aria-label="Más secciones">
              <LayoutGrid className="size-[22px]" strokeWidth={1.8} />
              Más
            </button>
          </div>
        </nav>
      )}

      <AnimatePresence>
        {more && (
          <motion.div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)}>
            <motion.div
              role="dialog"
              aria-label="Todas las secciones"
              className="absolute bottom-0 inset-x-0 rounded-t-[26px] border-t border-line-strong bg-[linear-gradient(180deg,#121a40,#0a1029)] px-4 pt-2.5 pb-[calc(1rem+var(--safe-bottom))]"
              initial={{ y: 400 }}
              animate={{ y: 0 }}
              exit={{ y: 400 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="block mx-auto h-1 w-10 rounded-full bg-white/20 mb-2" aria-hidden="true" />
              <div className="flex items-center justify-between mb-2">
                <span className="font-display font-semibold text-[17px]">Todas las secciones</span>
                <button onClick={() => setMore(false)} aria-label="Cerrar" className="size-11 grid place-items-center rounded-xl text-muted -mr-2">
                  <X className="size-5" />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-x-1.5 gap-y-3 max-h-[58dvh] overflow-y-auto pb-1">
                {all.map((n) => {
                  const t = SECTION_THEME[n.to] ?? SECTION_THEME['/'];
                  return (
                    <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setMore(false)} className={({ isActive }) => cx('flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 text-[11px] leading-tight text-center', isActive ? 'text-white bg-white/[.06]' : 'text-[#c3cbe6]')}>
                      <span className="grid place-items-center size-[50px] rounded-[16px] text-white shadow-[0_8px_18px_-10px_var(--g)]" style={{ background: sectionGradient(t), ['--g' as string]: t.from }}>
                        <n.icon className="size-[22px]" strokeWidth={1.9} />
                      </span>
                      {n.label}
                    </NavLink>
                  );
                })}
              </div>
              <div className="mt-3">
                <StreakCard />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <JobsTray />
      <Toasts />
    </div>
  );
}
