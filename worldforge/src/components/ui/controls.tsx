"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  size = "md",
  className,
  testId,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  testId?: string;
}) {
  const dim = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        dim,
        "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-35",
        active ? "bg-accent/20 text-accent ring-1 ring-accent/50" : "text-muted hover:bg-surface-2 hover:text-text",
        className,
      )}
    >
      <Icon name={icon} size={size === "lg" ? 22 : size === "sm" ? 15 : 18} />
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  icon,
  disabled,
  className,
  type = "button",
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "glow";
  icon?: IconName;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  testId?: string;
}) {
  const styles = {
    primary: "bg-accent text-white hover:bg-accent/85",
    secondary: "bg-surface-2 text-text hover:bg-line",
    ghost: "text-muted hover:text-text hover:bg-surface-2",
    danger: "bg-danger/15 text-danger hover:bg-danger/25",
    glow: "bg-gradient-to-r from-accent to-accent-2 text-[#06121a] font-semibold hover:brightness-110 shadow-[0_0_24px_rgba(0,214,201,0.35)]",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40", styles, className)}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; icon?: IconName }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("flex gap-1 border-b border-line px-2", className)}>
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          data-testid={`tab-${it.id}`}
          onClick={() => onChange(it.id)}
          className={cx(
            "relative flex items-center gap-1.5 px-2 py-2 text-xs font-medium whitespace-nowrap transition-colors",
            value === it.id ? "text-text after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded after:bg-accent" : "text-muted hover:text-text",
          )}
        >
          {it.icon && <Icon name={it.icon} size={14} />}
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, actions }: { title: string; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line/70">
      <div className="flex items-center">
        <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1.5 px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-muted uppercase hover:text-text">
          <Icon name={open ? "chevronDown" : "chevronRight"} size={13} />
          {title}
        </button>
        {actions && <div className="pr-2">{actions}</div>}
      </div>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid grid-cols-[96px_1fr] items-center gap-2 text-xs" title={hint}>
      <span className="truncate text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </label>
  );
}

const inputCls = "w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-text outline-none focus:border-accent";

/** Campo numérico que confirma al presionar Enter o al salir. */
export function NumberField({ value, onCommit, step = 0.1, min, max, testId, decimals = 2 }: { value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; testId?: string; decimals?: number }) {
  const [text, setText] = useState(fmt(value, decimals));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value, decimals));
  }, [value, decimals]);
  const commit = () => {
    const v = Number(text.replace(",", "."));
    if (!Number.isFinite(v)) return setText(fmt(value, decimals));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (Math.abs(clamped - value) > 1e-9) onCommit(clamped);
    setText(fmt(clamped, decimals));
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      data-testid={testId}
      className={inputCls}
      value={text}
      step={step}
      min={min}
      max={max}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(fmt(value, decimals));
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

function fmt(v: number, d: number) {
  return String(Math.round(v * 10 ** d) / 10 ** d);
}

export function Vec3Field({ value, onCommit, step = 0.1, testId, decimals = 2 }: { value: readonly number[]; onCommit: (v: [number, number, number]) => void; step?: number; testId?: string; decimals?: number }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {[0, 1, 2].map((k) => (
        <div key={k} className="relative">
          <span className={cx("pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-[9px] font-bold", k === 0 ? "text-[#ff6b6b]" : k === 1 ? "text-[#5ee08a]" : "text-[#6ba8ff]")}>{"XYZ"[k]}</span>
          <NumberField
            testId={testId ? `${testId}-${"xyz"[k]}` : undefined}
            value={value[k]!}
            step={step}
            decimals={decimals}
            onCommit={(v) => {
              const next = [value[0]!, value[1]!, value[2]!] as [number, number, number];
              next[k] = v;
              onCommit(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function TextField({ value, onCommit, placeholder, testId }: { value: string; onCommit: (v: string) => void; placeholder?: string; testId?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={inputCls}
      data-testid={testId}
      value={text}
      placeholder={placeholder}
      maxLength={80}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Select<T extends string>({ value, options, onChange, testId }: { value: T; options: readonly (T | { value: T; label: string })[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <select className={inputCls} value={value} data-testid={testId} onChange={(e) => onChange(e.target.value as T)} onKeyDown={(e) => e.stopPropagation()}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

/** Deslizador: `onPreview` mientras se arrastra, `onCommit` al soltar. */
export function Slider({ value, min, max, step = 0.01, onPreview, onCommit, format, testId }: { value: number; min: number; max: number; step?: number; onPreview?: (v: number) => void; onCommit: (v: number) => void; format?: (v: number) => string; testId?: string }) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        className="min-w-0 flex-1"
        data-testid={testId}
        min={min}
        max={max}
        step={step}
        value={local}
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          if (dragging.current) onPreview?.(v);
          else onCommit(v);
        }}
        onPointerUp={() => {
          dragging.current = false;
          onCommit(local);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <span className="w-12 text-right font-mono text-[11px] text-muted tabular-nums">{format ? format(local) : local.toFixed(step < 1 ? 2 : 0)}</span>
    </div>
  );
}

export function ColorField({ value, onCommit, testId }: { value: string; onCommit: (v: string) => void; testId?: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="flex items-center gap-2">
      <input type="color" data-testid={testId} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent" value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => local !== value && onCommit(local)} />
      <span className="font-mono text-[11px] text-muted">{local}</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label?: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-xs text-muted"
    >
      <span className={cx("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-line")}>
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx("animate-fade-up max-h-[88vh] w-full overflow-auto rounded-t-2xl border border-line bg-panel shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-4xl" : "sm:max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton icon="x" label="Cerrar" onClick={onClose} size="sm" />
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "ok" | "danger" }) {
  const t = {
    neutral: "bg-surface-2 text-muted",
    accent: "bg-accent/15 text-accent",
    warn: "bg-warn/15 text-warn",
    ok: "bg-ok/15 text-ok",
    danger: "bg-danger/15 text-danger",
  }[tone];
  return <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase", t)}>{children}</span>;
}
