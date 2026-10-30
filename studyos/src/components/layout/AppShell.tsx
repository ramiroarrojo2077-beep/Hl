import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Ellipsis, X } from 'lucide-react';
import { NAV_MAIN, NAV_MOBILE, NAV_TOOLS } from './nav';
import { JobsTray } from './JobsTray';
import { Toasts } from './Toasts';
import { cx } from '../ui';
import { useSettings, aiConfigured } from '@/stores/settings';
import { PROVIDER_LABEL } from '@/ai/types';

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src="./icon.svg" alt="" className="size-8" />
      <div className="leading-tight">
        <div className="font-display font-semibold tracking-tight">StudyOS <span className="text-gradient">AI</span></div>
        <div className="text-[10px] text-faint uppercase tracking-[.14em]">Estudio inteligente</div>
      </div>
    </div>
  );
}

function NavItem({ to, label, icon: Icon, end, onClick }: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; end?: boolean; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cx('group relative flex items-center gap-3 rounded-xl px-3 h-9 text-[13px] transition', isActive ? 'bg-gradient-to-r from-primary/20 to-violet/10 text-ink' : 'text-muted hover:text-ink hover:bg-white/[.04]')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="nav-active" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-gradient-to-b from-primary to-cyan" />}
          <Icon className={cx('size-[17px] shrink-0', isActive ? 'text-[#a9b8ff]' : '')} />
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}

function AiBadge() {
  const s = useSettings((x) => x.s);
  const ok = aiConfigured(s);
  return (
    <NavLink to="/settings" className="mx-2 mt-3 flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[11px] text-muted hover:text-ink">
      <span className={cx('size-2 rounded-full', ok ? 'bg-ok shadow-[0_0_10px] shadow-ok/70' : 'bg-warn')} />
      {ok && s.ai.provider !== 'none' ? (
        <span className="truncate">
          {PROVIDER_LABEL[s.ai.provider].split(' ')[0]} · {s.ai.models[s.ai.provider]}
        </span>
      ) : (
        <span>IA sin configurar</span>
      )}
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const immersive = loc.pathname.startsWith('/focus/session');
  const all = [...NAV_MAIN, ...NAV_TOOLS];
  const mobile = NAV_MOBILE.map((to) => all.find((n) => n.to === to)!);
  return (
    <div className="app-backdrop min-h-full flex">
      {!immersive && (
        <aside className="hidden lg:flex flex-col w-60 shrink-0 h-dvh sticky top-0 border-r border-line bg-[#0a0e19]/80 py-4">
          <Brand />
          <nav className="mt-6 flex-1 overflow-y-auto scroll-thin px-2 space-y-0.5" aria-label="Principal">
            {NAV_MAIN.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
            <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-[.14em] text-faint">Herramientas</div>
            {NAV_TOOLS.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
          <AiBadge />
        </aside>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        {!immersive && (
          <header className="lg:hidden sticky top-0 z-30 glass border-x-0 border-t-0 pt-[var(--safe-top)]">
            <div className="h-14 flex items-center justify-between px-3">
              <Brand />
            </div>
          </header>
        )}
        <main className={cx('flex-1 w-full mx-auto', immersive ? '' : 'max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-5 pb-28 lg:pb-10')}>{children}</main>
      </div>

      {!immersive && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass border-x-0 border-b-0 pb-[var(--safe-bottom)]" aria-label="Navegación inferior">
          <div className="grid grid-cols-5 h-16">
            {mobile.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('flex flex-col items-center justify-center gap-1 text-[10px]', isActive ? 'text-ink' : 'text-muted')}>
                {({ isActive }) => (
                  <>
                    <n.icon className={cx('size-5', isActive && 'text-[#a9b8ff]')} />
                    {n.label.replace(' IA', '')}
                  </>
                )}
              </NavLink>
            ))}
            <button onClick={() => setMore(true)} className="flex flex-col items-center justify-center gap-1 text-[10px] text-muted" aria-label="Más secciones">
              <Ellipsis className="size-5" />
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
                <button onClick={() => setMore(false)} aria-label="Cerrar" className="size-9 grid place-items-center rounded-xl text-muted">
                  <X className="size-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {all.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setMore(false)} className={({ isActive }) => cx('flex flex-col items-center gap-1.5 rounded-2xl border border-line p-3 text-[11px] text-center', isActive ? 'bg-primary/15 text-ink' : 'text-muted')}>
                    <n.icon className="size-5" />
                    {n.label}
                  </NavLink>
                ))}
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
