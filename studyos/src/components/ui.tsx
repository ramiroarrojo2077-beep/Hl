import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LoaderCircle, X } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-primary to-violet text-white shadow-[0_6px_24px_-8px_rgba(82,113,255,.7)] hover:brightness-110',
  secondary: 'bg-surface-3 text-ink hover:bg-[#26314f] border border-line',
  ghost: 'text-muted hover:text-ink hover:bg-white/5',
  danger: 'bg-bad/15 text-bad hover:bg-bad/25 border border-bad/30',
  outline: 'border border-line-strong text-ink hover:bg-white/5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-[15px]',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('inline-grid place-items-center size-9 rounded-xl text-muted hover:text-ink hover:bg-white/5 transition disabled:opacity-40', active && 'bg-primary/20 text-ink', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('panel', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, action, subtitle }: { title: string; action?: ReactNode; subtitle?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div>
        <h2 className="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: string; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="mt-0.5 grid place-items-center size-10 rounded-xl bg-gradient-to-br from-primary/25 to-violet/25 border border-line text-ink shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1 max-w-2xl">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'primary' | 'violet' | 'cyan'; className?: string }) {
  const tones = {
    neutral: 'bg-white/6 text-muted border-line',
    ok: 'bg-ok/12 text-ok border-ok/25',
    warn: 'bg-warn/12 text-warn border-warn/25',
    bad: 'bg-bad/12 text-bad border-bad/25',
    primary: 'bg-primary/15 text-[#a9b8ff] border-primary/30',
    violet: 'bg-violet/15 text-[#c4b0ff] border-violet/30',
    cyan: 'bg-cyan/12 text-cyan border-cyan/25',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-xs font-medium text-muted mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-faint mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-xl bg-[#0d1322] border border-line px-3 text-sm text-ink placeholder:text-faint focus:border-primary/60 transition';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputCls, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputCls, 'py-2.5 min-h-24 resize-y leading-relaxed', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, 'h-10 pr-8 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%2394a3b8%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_.7rem_center]', className)} {...rest}>
      {children}
    </select>
  );
}

export function Slider({ value, min, max, step = 1, onChange, label, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; format?: (v: number) => string }) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs text-muted mb-1.5">
        <span>{label}</span>
        <span className="font-mono text-ink">{format ? format(value) : value}</span>
      </span>
      <input type="range" className="w-full" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer py-1">
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted mt-0.5">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative shrink-0 h-6 w-11 rounded-full transition border border-line', checked ? 'bg-primary' : 'bg-surface-3')}
      >
        <span className={cx('absolute top-0.5 size-[18px] rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex flex-wrap p-1 rounded-xl bg-[#0d1322] border border-line gap-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('rounded-lg px-3 transition font-medium', size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm', value === o.value ? 'bg-surface-3 text-ink shadow' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-line mb-4 overflow-x-auto scroll-thin">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx('relative px-3 h-10 text-sm whitespace-nowrap transition', value === t.value ? 'text-ink' : 'text-muted hover:text-ink')}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-[11px] text-faint">{t.count}</span>}
          {value === t.value && <motion.span layoutId={`tab-${tabs.map((x) => x.value).join()}`} className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-gradient-to-r from-primary to-cyan" />}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cx('glass w-full sm:rounded-2xl rounded-t-2xl max-h-[92dvh] flex flex-col', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
              <h3 className="font-display font-semibold">{title}</h3>
              <IconButton label="Cerrar" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="px-5 py-4 overflow-y-auto scroll-thin">{children}</div>
            {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 pb-[calc(.75rem+var(--safe-bottom))] sm:pb-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <div className="grid place-items-center size-14 rounded-2xl bg-gradient-to-br from-primary/20 to-violet/20 border border-line mb-4 text-[#a9b8ff]">{icon}</div>
      <h3 className="font-display font-semibold">{title}</h3>
      <p className="text-sm text-muted mt-1 max-w-sm">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('size-4 animate-spin text-primary', className)} />;
}

export function ProgressBar({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'ok' | 'warn' | 'bad' }) {
  const colors = { primary: 'from-primary to-cyan', ok: 'from-ok to-cyan', warn: 'from-warn to-[#fb923c]', bad: 'from-bad to-[#fb7185]' };
  return (
    <div className={cx('h-1.5 rounded-full bg-white/6 overflow-hidden', className)}>
      <div className={cx('h-full rounded-full bg-gradient-to-r transition-[width] duration-500', colors[tone])} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        {icon}
      </div>
      <div className="font-display text-2xl font-semibold mt-1.5">{value}</div>
      {hint && <div className="text-[11px] text-faint mt-0.5">{hint}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; title?: string }) {
  const tones = { info: 'border-primary/30 bg-primary/8', warn: 'border-warn/30 bg-warn/8', bad: 'border-bad/30 bg-bad/8', ok: 'border-ok/30 bg-ok/8' };
  return (
    <div className={cx('rounded-xl border px-3.5 py-2.5 text-sm', tones[tone])}>
      {title && <div className="font-medium mb-0.5">{title}</div>}
      <div className="text-[13px] text-[#cbd5e1] leading-relaxed">{children}</div>
    </div>
  );
}
