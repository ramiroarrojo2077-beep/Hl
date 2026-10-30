import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ellipsis, Quote, X } from 'lucide-react';
import { NAV_MAIN, NAV_MOBILE, NAV_TOOLS } from './nav';
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
  const all = [...NAV_MAIN, ...NAV_TOOLS];
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
        <main className={cx('flex-1 w-full mx-auto', immersive ? '' : 'max-w-[1440px] px-3.5 sm:px-4 lg:pl-4 lg:pr-3.5 pt-3.5 pb-28 lg:pb-6')}>{children}</main>
      </div>

      {!immersive && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass border-x-0 border-b-0 pb-[var(--safe-bottom)]" aria-label="Navegación inferior">
          <div className="grid grid-cols-5 h-16">
            {mobile.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('flex flex-col items-center justify-center gap-1 text-[10px]', isActive ? 'text-white' : 'text-muted')}>
                {({ isActive }) => (
                  <>
                    <span className={cx('grid place-items-center h-7 w-12 rounded-full transition', isActive && 'bg-primary/30')}>
                      <n.icon className="size-5" />
                    </span>
                    {n.to === '/tasks' ? 'Tareas' : n.label.replace(' IA', '')}
                  </>
                )}
              </NavLink>
            ))}
            <button onClick={() => setMore(true)} className="flex flex-col items-center justify-center gap-1 text-[10px] text-muted" aria-label="Más secciones">
              <span className="grid place-items-center h-7 w-12">
                <Ellipsis className="size-5" />
              </span>
              Más
            </button>
          </div>
        </nav>
      )}

      <AnimatePresence>
        {more && (
          <motion.div className="lg:hidden fixed inset-0 z-50 bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)}>
            <motion.div
              className="absolute bottom-0 inset-x-0 glass rounded-t-3xl p-4 pb-[calc(1rem+var(--safe-bottom))]"
              initial={{ y: 300 }}
              animate={{ y: 0 }}
              exit={{ y: 300 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-display font-semibold">Todas las secciones</span>
                <button onClick={() => setMore(false)} aria-label="Cerrar" className="size-11 grid place-items-center rounded-xl text-muted">
                  <X className="size-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 max-h-[60dvh] overflow-y-auto">
                {all.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setMore(false)} className={({ isActive }) => cx('flex flex-col items-center gap-1.5 rounded-2xl border border-line p-3 text-[11px] text-center min-h-[72px] justify-center', isActive ? 'nav-active text-white' : 'text-muted')}>
                    <n.icon className="size-5" />
                    {n.label}
                  </NavLink>
                ))}
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
