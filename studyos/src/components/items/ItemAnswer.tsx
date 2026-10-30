import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Check, X } from 'lucide-react';
import { seededShuffle, type Item } from '@/lib/items';
import type { ItemResult } from '@/lib/db';
import { cx } from '../ui';
import { Markdown } from '../Markdown';

// Interfaz para responder cada tipo de ítem. Las claves de corrección no se
// muestran acá: solo se usan después de entregar.

export function ItemAnswer({ item, value, onChange, disabled, result }: { item: Item; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; result?: ItemResult }) {
  const inputCls = 'w-full rounded-xl bg-[#0a102a] border border-line-strong px-3 h-11 text-sm outline-none focus:border-primary/70 disabled:opacity-80';
  switch (item.type) {
    case 'mcq':
      return (
        <div className="grid gap-2" role="radiogroup">
          {item.options!.map((o, i) => {
            const picked = value === i;
            const showCorrect = !!result && i === item.correctIndex;
            const showWrong = !!result && picked && i !== item.correctIndex;
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={picked}
                disabled={disabled}
                onClick={() => onChange(i)}
                className={cx('flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition', picked ? 'nav-active' : 'border-line hover:border-line-strong', showCorrect && 'border-ok/60 bg-ok/10', showWrong && 'border-bad/60 bg-bad/10')}
              >
                <span className={cx('grid place-items-center size-6 rounded-full border text-[11px] shrink-0', picked ? 'bg-primary border-primary text-white' : 'border-line-strong text-muted')}>{String.fromCharCode(65 + i)}</span>
                <span className="flex-1">
                  <Markdown className="!text-sm">{o}</Markdown>
                </span>
                {showCorrect && <Check className="size-4 text-ok shrink-0" />}
                {showWrong && <X className="size-4 text-bad shrink-0" />}
              </button>
            );
          })}
        </div>
      );
    case 'tf':
      return (
        <div className="flex gap-2">
          {[true, false].map((b) => (
            <button key={String(b)} type="button" disabled={disabled} onClick={() => onChange(b)} className={cx('flex-1 h-11 rounded-xl border text-sm font-medium', value === b ? 'nav-active' : 'border-line hover:border-line-strong', result && b === item.correctBool && 'border-ok/60 bg-ok/10')}>
              {b ? 'Verdadero' : 'Falso'}
            </button>
          ))}
        </div>
      );
    case 'short':
      return <input className={inputCls} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Tu respuesta" aria-label="Respuesta" />;
    case 'numeric':
      return (
        <div className="flex items-center gap-2">
          <input className={cx(inputCls, 'max-w-60 font-mono')} disabled={disabled} inputMode="decimal" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Ej.: 3,5 o 7/2" aria-label="Respuesta numérica" />
          {item.unit && <span className="text-sm text-muted">{item.unit}</span>}
        </div>
      );
    case 'fill':
      return <FillBlanks item={item} value={(value as string[]) ?? []} onChange={onChange} disabled={disabled} />;
    case 'match':
      return <Match item={item} value={(value as Record<string, number>) ?? {}} onChange={onChange} disabled={disabled} />;
    case 'order':
      return <Order item={item} value={value as string[] | undefined} onChange={onChange} disabled={disabled} />;
    case 'essay':
      return <textarea className={cx(inputCls, 'h-auto min-h-40 py-2.5 leading-relaxed')} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Desarrollá tu respuesta…" aria-label="Respuesta de desarrollo" />;
    case 'problem': {
      const v = (value as { work?: string; final?: string }) ?? {};
      return (
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs text-muted">Procedimiento</span>
            <textarea className={cx(inputCls, 'h-auto min-h-32 py-2.5 font-mono text-[13px] mt-1')} disabled={disabled} value={v.work ?? ''} onChange={(e) => onChange({ ...v, work: e.target.value })} placeholder="Escribí los pasos que seguiste…" />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Resultado final{item.unit ? ` (${item.unit})` : ''}</span>
            <input className={cx(inputCls, 'mt-1 font-mono max-w-80')} disabled={disabled} value={v.final ?? ''} onChange={(e) => onChange({ ...v, final: e.target.value })} />
          </label>
        </div>
      );
    }
  }
}

function FillBlanks({ item, value, onChange, disabled }: { item: Item; value: string[]; onChange: (v: unknown) => void; disabled?: boolean }) {
  const parts = item.prompt.split(/_{3,}/);
  return (
    <div className="text-sm leading-[2.4]">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <input
              aria-label={`Espacio ${i + 1}`}
              disabled={disabled}
              value={value[i] ?? ''}
              onChange={(e) => {
                const next = [...value];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="mx-1 inline-block w-36 h-9 rounded-lg bg-[#0a102a] border border-line-strong px-2 text-sm align-middle outline-none focus:border-primary/70"
            />
          )}
        </span>
      ))}
    </div>
  );
}

function Match({ item, value, onChange, disabled }: { item: Item; value: Record<string, number>; onChange: (v: unknown) => void; disabled?: boolean }) {
  const order = useMemo(() => seededShuffle(item.pairs!.map((_, i) => i), item.id), [item]);
  return (
    <div className="grid gap-2">
      {item.pairs!.map((p, i) => (
        <div key={i} className="grid sm:grid-cols-[1fr_1fr] gap-2 items-center">
          <span className="text-sm rounded-lg bg-white/[.03] border border-line px-3 py-2">{p.left}</span>
          <select
            aria-label={`Relacionar ${p.left}`}
            disabled={disabled}
            value={value[String(i)] ?? ''}
            onChange={(e) => onChange({ ...value, [String(i)]: e.target.value === '' ? undefined : Number(e.target.value) })}
            className="h-10 rounded-lg bg-[#0a102a] border border-line-strong px-2 text-sm"
          >
            <option value="">Elegí…</option>
            {order.map((j) => (
              <option key={j} value={j}>
                {item.pairs![j].right}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function Order({ item, value, onChange, disabled }: { item: Item; value: string[] | undefined; onChange: (v: unknown) => void; disabled?: boolean }) {
  const initial = useMemo(() => seededShuffle(item.sequence!, item.id), [item]);
  const list = value?.length ? value : initial;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <ol className="space-y-1.5">
      {list.map((x, i) => (
        <li key={x} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
          <span className="text-xs text-muted w-5">{i + 1}.</span>
          <span className="flex-1">{x}</span>
          <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Subir" className="size-9 grid place-items-center rounded-lg hover:bg-white/5 disabled:opacity-30">
            <ArrowUp className="size-4" />
          </button>
          <button type="button" disabled={disabled || i === list.length - 1} onClick={() => move(i, 1)} aria-label="Bajar" className="size-9 grid place-items-center rounded-lg hover:bg-white/5 disabled:opacity-30">
            <ArrowDown className="size-4" />
          </button>
        </li>
      ))}
      {!value?.length && !disabled && (
        <li>
          <button type="button" className="text-xs text-[#8ea2ff]" onClick={() => onChange(initial)}>
            Confirmar este orden
          </button>
        </li>
      )}
    </ol>
  );
}
