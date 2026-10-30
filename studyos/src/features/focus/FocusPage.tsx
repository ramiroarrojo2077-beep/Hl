import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Coffee, Pause, Play, Plus, SkipForward, Square, Timer, Trash, X } from 'lucide-react';
import { db, logActivity } from '@/lib/db';
import { newId } from '@/lib/ids';
import { addDays, fmtMinutes, startOfDay, timeAgo } from '@/lib/format';
import { chime, playAmbient, setAmbientVolume, stopAmbient } from '@/lib/ambient';
import { Button, Field, IconButton, Input, PageHeader, Panel, Select, Slider, Stat, cx } from '@/components/ui';
import { useSettings, type AmbientSound } from '@/stores/settings';
import { toast } from '@/stores/toast';

type Phase = 'work' | 'short' | 'long';
const PHASE_LABEL: Record<Phase, string> = { work: 'Concentración', short: 'Pausa corta', long: 'Pausa larga' };
const MAX_POMODOROS = 8;

interface Draft {
  goal: string;
  subjectId?: string;
  tasks: { text: string; done: boolean }[];
}

const draftKey = 'studyos:focusDraft';

function loadDraft(): Draft {
  try {
    return JSON.parse(sessionStorage.getItem(draftKey) ?? '') as Draft;
  } catch {
    return { goal: '', tasks: [] };
  }
}

function Session({ draft, onEnd }: { draft: Draft; onEnd: () => void }) {
  const { s, update } = useSettings();
  const f = s.focus;
  const [phase, setPhase] = useState<Phase>('work');
  const [left, setLeft] = useState(f.work * 60);
  const [running, setRunning] = useState(true);
  const [pomos, setPomos] = useState(0);
  const [tasks, setTasks] = useState(draft.tasks);
  const [focused, setFocused] = useState(0); // segundos reales de concentración
  const [interruptions, setInterruptions] = useState(0);
  const startedAt = useRef(Date.now());
  const last = useRef(performance.now());
  const total = (phase === 'work' ? f.work : phase === 'short' ? f.short : f.long) * 60;

  useEffect(() => {
    if (!running) return;
    last.current = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      const dt = (now - last.current) / 1000;
      last.current = now;
      setLeft((l) => Math.max(0, l - dt));
      if (phase === 'work') setFocused((x) => x + dt);
    }, 250);
    return () => clearInterval(t);
  }, [running, phase]);

  useEffect(() => {
    if (left > 0) return;
    chime();
    if (phase === 'work') {
      const n = pomos + 1;
      setPomos(n);
      if (n >= MAX_POMODOROS) {
        toast.info('Llegaste a 8 pomodoros: es un buen momento para terminar y descansar.');
        setRunning(false);
      }
      const next: Phase = n % f.every === 0 ? 'long' : 'short';
      setPhase(next);
      setLeft((next === 'long' ? f.long : f.short) * 60);
    } else {
      setPhase('work');
      setLeft(f.work * 60);
    }
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  // Distracciones: salir de la app durante la concentración cuenta como interrupción.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && phase === 'work' && running) setInterruptions((x) => x + 1);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase, running]);

  useEffect(() => {
    if (f.sound !== 'none') playAmbient(f.sound, f.volume);
    return () => stopAmbient();
  }, [f.sound]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async () => {
    const minutes = Math.round(focused / 60);
    if (focused >= 60) {
      await db.focus.add({ id: newId(), subjectId: draft.subjectId, goal: draft.goal, startedAt: startedAt.current, endedAt: Date.now(), plannedMinutes: f.work * Math.max(1, pomos), focusedMinutes: minutes, pomodoros: pomos, interruptions, completed: pomos > 0 });
      await logActivity({ type: 'focus', title: `Sesión Focus: ${fmtMinutes(minutes)}`, subjectId: draft.subjectId, route: '/focus' });
      toast.ok(`Sesión guardada: ${fmtMinutes(minutes)} de concentración`);
    } else toast.info('La sesión duró menos de un minuto y no se guardó.');
    stopAmbient();
    onEnd();
  };

  const r = 120;
  const c = 2 * Math.PI * r;
  const prog = 1 - left / total;
  return (
    <div className="app-backdrop min-h-dvh flex flex-col items-center justify-center p-6 pt-[calc(var(--safe-top)+24px)] gap-6">
      <div className="text-center">
        <div className={cx('text-xs uppercase tracking-[.2em]', phase === 'work' ? 'text-[#8ea2ff]' : 'text-ok')}>{PHASE_LABEL[phase]}</div>
        {draft.goal && <div className="font-display text-lg mt-1">{draft.goal}</div>}
      </div>
      <div className="relative">
        <svg width="280" height="280" viewBox="0 0 280 280" aria-hidden="true">
          <circle cx="140" cy="140" r={r} fill="none" stroke="rgba(120,140,255,.14)" strokeWidth="12" />
          <circle cx="140" cy="140" r={r} fill="none" stroke={phase === 'work' ? 'url(#fg)' : '#34d399'} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${c * prog} ${c}`} transform="rotate(-90 140 140)" />
          <defs>
            <linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#22d3ee" />
              <stop offset="1" stopColor="#5b5cff" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center" role="timer" aria-live="off">
            <div className="font-display text-6xl font-semibold tabular-nums">{`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`}</div>
            <div className="text-xs text-muted mt-1">
              {pomos} pomodoro{pomos === 1 ? '' : 's'} · {fmtMinutes(focused / 60)}
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-3">
        <Button size="lg" variant="primary" icon={running ? <Pause className="size-5" /> : <Play className="size-5" />} onClick={() => setRunning((x) => !x)}>
          {running ? 'Pausar' : 'Seguir'}
        </Button>
        <Button size="lg" icon={<SkipForward className="size-5" />} onClick={() => setLeft(0)}>
          {phase === 'work' ? 'Ir a la pausa' : 'Saltar pausa'}
        </Button>
        <Button size="lg" variant="danger" icon={<Square className="size-5" />} onClick={() => confirm('¿Terminar la sesión?') && finish()}>
          Terminar
        </Button>
      </div>
      {tasks.length > 0 && (
        <Panel className="w-full max-w-md p-4">
          <div className="text-xs text-muted mb-2">Tareas de la sesión</div>
          <ul className="space-y-1.5">
            {tasks.map((t, i) => (
              <li key={i}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={t.done} onChange={(e) => setTasks((v) => v.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
                  <span className={t.done ? 'line-through text-muted' : ''}>{t.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>Sonido</span>
        <Select value={f.sound} onChange={(e) => update((x) => void (x.focus.sound = e.target.value as AmbientSound))} className="h-8 w-32 text-xs">
          <option value="none">Silencio</option>
          <option value="rain">Lluvia</option>
          <option value="pink">Ruido rosa</option>
          <option value="brown">Ruido marrón</option>
          <option value="white">Ruido blanco</option>
        </Select>
        <input type="range" min={0} max={1} step={0.05} value={f.volume} onChange={(e) => {
            const v = Number(e.target.value);
            setAmbientVolume(v);
            update((x) => void (x.focus.volume = v));
          }} aria-label="Volumen" className="w-24" />
      </div>
      {phase !== 'work' && (
        <p className="text-sm text-ok flex items-center gap-2">
          <Coffee className="size-4" /> Levantate, tomá agua y descansá la vista.
        </p>
      )}
      <p className="text-[11px] text-faint">Modo sin distracciones: la navegación está oculta. Salir de la app cuenta como interrupción ({interruptions}).</p>
    </div>
  );
}

export default function FocusPage() {
  const loc = useLocation();
  const nav = useNavigate();
  const { s, update } = useSettings();
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.focus.orderBy('startedAt').reverse().limit(20).toArray(), []) ?? [];
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [task, setTask] = useState('');
  useEffect(() => {
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
  }, [draft]);
  if (loc.pathname === '/focus/session') return <Session draft={draft} onEnd={() => nav('/focus', { replace: true })} />;
  const today = sessions.filter((x) => x.startedAt >= startOfDay()).reduce((a, x) => a + x.focusedMinutes, 0);
  const week = sessions.filter((x) => x.startedAt >= addDays(startOfDay(), -6)).reduce((a, x) => a + x.focusedMinutes, 0);
  return (
    <div>
      <PageHeader title="Modo Focus" subtitle="Pomodoro, objetivos de sesión y pausas programadas. Sin presiones: el modo te sugiere parar después de 8 pomodoros." icon={<Timer className="size-5" />} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="p-5 space-y-4">
          <Field label="Objetivo de la sesión">
            <Input value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} placeholder="Ej.: terminar la guía de estequiometría" />
          </Field>
          <Field label="Materia">
            <Select value={draft.subjectId ?? ''} onChange={(e) => setDraft({ ...draft, subjectId: e.target.value || undefined })}>
              <option value="">—</option>
              {subjects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <div className="text-xs text-muted mb-1.5">Lista de tareas</div>
            <form
              className="flex gap-2 mb-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!task.trim()) return;
                setDraft({ ...draft, tasks: [...draft.tasks, { text: task.trim(), done: false }] });
                setTask('');
              }}
            >
              <Input value={task} onChange={(e) => setTask(e.target.value)} placeholder="Agregar tarea" />
              <Button type="submit" icon={<Plus className="size-4" />}>
                Agregar
              </Button>
            </form>
            <ul className="space-y-1">
              {draft.tasks.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm tile px-3 py-1.5">
                  {t.text}
                  <IconButton label="Quitar" onClick={() => setDraft({ ...draft, tasks: draft.tasks.filter((_, j) => j !== i) })}>
                    <X className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Slider label="Concentración" value={s.focus.work} min={10} max={60} step={5} onChange={(v) => update((x) => void (x.focus.work = v))} format={(v) => `${v} min`} />
            <Slider label="Pausa corta" value={s.focus.short} min={3} max={15} onChange={(v) => update((x) => void (x.focus.short = v))} format={(v) => `${v} min`} />
            <Slider label="Pausa larga" value={s.focus.long} min={10} max={40} step={5} onChange={(v) => update((x) => void (x.focus.long = v))} format={(v) => `${v} min`} />
            <Slider label="Pausa larga cada" value={s.focus.every} min={2} max={6} onChange={(v) => update((x) => void (x.focus.every = v))} format={(v) => `${v} pomodoros`} />
          </div>
          <Button size="lg" variant="primary" icon={<Play className="size-5" />} onClick={() => nav('/focus/session')}>
            Empezar sesión
          </Button>
        </Panel>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Hoy" value={fmtMinutes(today)} />
            <Stat label="Últimos 7 días" value={fmtMinutes(week)} />
          </div>
          <Panel className="p-4">
            <h3 className="font-display font-semibold text-sm mb-2">Sesiones recientes</h3>
            {sessions.length === 0 ? (
              <p className="text-sm text-muted">Todavía no hiciste sesiones.</p>
            ) : (
              <ul className="space-y-1.5">
                {sessions.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{x.goal || 'Sesión'}</span>
                      <span className="text-[11px] text-muted">
                        {timeAgo(x.startedAt)} · {x.pomodoros} pomodoros · {x.interruptions} interrupciones
                      </span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="font-mono text-xs">{fmtMinutes(x.focusedMinutes)}</span>
                      <IconButton label="Eliminar" onClick={() => db.focus.delete(x.id)}>
                        <Trash className="size-3.5" />
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
