import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bell, Calendar, ChevronLeft, ChevronRight, Plus, Sparkles, Trash, WandSparkles } from 'lucide-react';
import { db, type CalendarEvent, type EventType } from '@/lib/db';
import { newId } from '@/lib/ids';
import { addDays, fmtDate, fmtTime, fromDateTimeInputs, startOfDay, toDateInput, toTimeInput } from '@/lib/format';
import { buildPlan, type PlannedSession } from '@/lib/planner';
import { scheduleReminder, cancelReminder, restoreWebReminders } from '@/lib/reminders';
import { isNative } from '@/lib/platform';
import { subjectStyle } from '@/lib/subjects';
import { Badge, Button, Field, IconButton, Input, Modal, Notice, PageHeader, Panel, Select, Slider, Textarea, cx } from '@/components/ui';
import { parsePlanRequest } from '@/ai/agents/planner';
import { aiConfigured, useSettings } from '@/stores/settings';
import { aiErrorMessage } from '@/ai/types';
import { toast } from '@/stores/toast';

const TYPE_LABEL: Record<EventType, string> = { exam: 'Examen', study: 'Estudio', review: 'Repaso', task: 'Entrega', focus: 'Focus', other: 'Otro' };
const TYPE_COLOR: Record<EventType, string> = { exam: 'bg-bad/80', study: 'bg-primary', review: 'bg-violet', task: 'bg-warn/90', focus: 'bg-cyan/80', other: 'bg-slate-500' };
const WEEK = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function EventModal({ ev, onClose, defaultDate, defaultType = 'study' }: { ev?: CalendarEvent; onClose: () => void; defaultDate: number; defaultType?: EventType }) {
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const [title, setTitle] = useState(ev?.title ?? '');
  const [type, setType] = useState<EventType>(ev?.type ?? defaultType);
  const [date, setDate] = useState(toDateInput(ev?.start ?? defaultDate));
  const [time, setTime] = useState(ev ? toTimeInput(ev.start) : '17:00');
  const [dur, setDur] = useState(ev?.end ? Math.round((ev.end - ev.start) / 60000) : 45);
  const [subjectId, setSubjectId] = useState(ev?.subjectId ?? '');
  const [reminder, setReminder] = useState<string>(ev?.reminderMinutes === undefined ? 'none' : String(ev.reminderMinutes));
  const [notes, setNotes] = useState(ev?.notes ?? '');
  const save = async () => {
    const start = fromDateTimeInputs(date, time);
    const rec: CalendarEvent = { id: ev?.id ?? newId(), title: title.trim(), type, start, end: start + dur * 60000, allDay: false, subjectId: subjectId || undefined, notes: notes.trim() || undefined, done: ev?.done ?? false, planId: ev?.planId, taskId: ev?.taskId, reminderMinutes: reminder === 'none' ? undefined : Number(reminder), notificationId: ev?.notificationId };
    await db.events.put(rec);
    if (rec.reminderMinutes !== undefined) {
      const ok = await scheduleReminder(rec);
      if (!ok) toast.info('No se pudo programar el recordatorio (permiso de notificaciones o fecha pasada).');
    } else await cancelReminder(rec);
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={ev ? 'Editar evento' : 'Nuevo evento'}
      footer={
        <>
          {ev && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={async () => {
                await cancelReminder(ev);
                await db.events.delete(ev.id);
                onClose();
              }}
            >
              Eliminar
            </Button>
          )}
          <Button variant="primary" disabled={!title.trim()} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Título">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Examen de Química" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <Select value={type} onChange={(e) => setType(e.target.value as EventType)}>
              {(Object.keys(TYPE_LABEL) as EventType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Materia">
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">—</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Hora">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Slider label="Duración" value={dur} min={10} max={240} step={5} onChange={setDur} format={(v) => `${v} min`} />
        <Field label="Recordatorio" hint={isNative ? 'Notificación del sistema, aunque la app esté cerrada.' : 'En el navegador solo funciona con StudyOS abierto.'}>
          <Select value={reminder} onChange={(e) => setReminder(e.target.value)}>
            <option value="none">Sin recordatorio</option>
            <option value="0">A la hora</option>
            <option value="10">10 minutos antes</option>
            <option value="30">30 minutos antes</option>
            <option value="60">1 hora antes</option>
            <option value="1440">1 día antes</option>
          </Select>
        </Field>
        <Field label="Notas">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
        </Field>
      </div>
    </Modal>
  );
}

function PlanModal({ onClose }: { onClose: () => void }) {
  const s = useSettings((x) => x.s);
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const [request, setRequest] = useState('');
  const [parsing, setParsing] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const [examDate, setExamDate] = useState(toDateInput(addDays(Date.now(), 7)));
  const [topics, setTopics] = useState('');
  const [minutes, setMinutes] = useState(90);
  const [startHour, setStartHour] = useState(17);
  const [rest, setRest] = useState<number[]>([]);
  const [preview, setPreview] = useState<PlannedSession[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const interpret = async () => {
    setParsing(true);
    try {
      const r = await parsePlanRequest(request, subjects.map((x) => x.name));
      const sub = subjects.find((x) => x.name.toLowerCase() === r.subjectName.toLowerCase());
      if (sub) setSubjectId(sub.id);
      if (r.examDate) setExamDate(r.examDate);
      if (r.topics.length) setTopics(r.topics.join('\n'));
      if (r.minutesPerDay) setMinutes(Math.min(300, Math.max(15, r.minutesPerDay)));
      setNotes([r.topicsUnnamed ? 'Nombrá los temas para que el plan sea más útil.' : '', r.notes].filter(Boolean).join(' '));
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setParsing(false);
    }
  };
  const generate = () => {
    const [y, m, d] = examDate.split('-').map(Number);
    const r = buildPlan({ examDate: new Date(y, m - 1, d).getTime(), topics: topics.split('\n'), minutesPerDay: minutes, restDays: rest, startHour });
    setPreview(r.sessions);
    setWarnings(r.warnings);
  };
  const save = async () => {
    if (!preview) return;
    const sub = subjects.find((x) => x.id === subjectId);
    const planId = newId();
    const [y, m, d] = examDate.split('-').map(Number);
    const exam = new Date(y, m - 1, d, 9, 0).getTime();
    await db.plans.add({ id: planId, subjectId: subjectId || undefined, title: `Plan: ${sub?.name ?? 'examen'}`, examDate: exam, topics: topics.split('\n').filter((t) => t.trim()), minutesPerDay: minutes, createdAt: Date.now() });
    const events: CalendarEvent[] = [
      { id: newId(), title: `Examen${sub ? ` de ${sub.name}` : ''}`, type: 'exam', start: exam, allDay: true, subjectId: subjectId || undefined, done: false, planId, reminderMinutes: 1440 },
      ...preview.map((p) => ({ id: newId(), title: p.title, type: (p.kind === 'learn' ? 'study' : 'review') as EventType, start: p.start, end: p.start + p.minutes * 60000, allDay: false, subjectId: subjectId || undefined, done: false, planId, reminderMinutes: 10 })),
    ];
    await db.events.bulkAdd(events);
    let scheduled = 0;
    for (const e of events) if (await scheduleReminder(e)) scheduled++;
    toast.ok(`Plan guardado: ${preview.length} sesiones${scheduled ? `, ${scheduled} recordatorios` : ''}`);
    onClose();
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Planificar estudio"
      footer={
        preview ? (
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Volver a editar
            </Button>
            <Button variant="primary" onClick={save} disabled={!preview.length}>
              Guardar en el calendario
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={generate} disabled={!topics.trim()}>
            Armar plan
          </Button>
        )
      }
    >
      {!preview ? (
        <div className="space-y-4">
          <Field label="Contame qué necesitás" hint={aiConfigured(s) ? 'La IA completa los campos de abajo; el calendario lo arma StudyOS y lo podés editar.' : 'Sin IA: completá los campos de abajo.'}>
            <div className="flex gap-2">
              <Input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Tengo un examen de química dentro de siete días y necesito estudiar cinco temas" />
              <Button icon={<Sparkles className="size-4" />} loading={parsing} disabled={!request.trim() || !aiConfigured(s)} onClick={interpret}>
                Interpretar
              </Button>
            </div>
          </Field>
          {notes && <Notice>{notes}</Notice>}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Materia">
              <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">—</option>
                {subjects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha del examen">
              <Input type="date" value={examDate} min={toDateInput(addDays(Date.now(), 1))} onChange={(e) => setExamDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Temas (uno por línea)">
            <Textarea value={topics} onChange={(e) => setTopics(e.target.value)} className="min-h-28" placeholder={'Estequiometría\nEnlaces químicos\n…'} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Slider label="Tiempo máximo por día" value={minutes} min={20} max={300} step={10} onChange={setMinutes} format={(v) => `${v} min`} />
            <Slider label="Hora de inicio" value={startHour} min={6} max={22} onChange={setStartHour} format={(v) => `${v}:00`} />
          </div>
          <div>
            <div className="text-xs text-muted mb-1.5">Días de descanso</div>
            <div className="flex gap-1.5">
              {['D', 'L', 'M', 'X', 'J', 'V', 'S'].map((d, i) => (
                <button key={d} onClick={() => setRest((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i]))} className={cx('size-10 rounded-xl border text-sm', rest.includes(i) ? 'nav-active' : 'border-line text-muted')}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-faint">El plan respeta el máximo diario, deja repasos espaciados (≈1 y 3 días después de cada tema) y un repaso general antes del examen. No agenda más tiempo del que indicás.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {warnings.map((w, i) => (
            <Notice key={i} tone="warn">
              {w}
            </Notice>
          ))}
          <ul className="space-y-1.5">
            {preview.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 tile px-3 py-2 text-sm">
                <Badge tone={p.kind === 'learn' ? 'primary' : p.kind === 'final' ? 'warn' : 'violet'}>{p.kind === 'learn' ? 'Estudio' : p.kind === 'final' ? 'Repaso final' : 'Repaso'}</Badge>
                <span className="flex-1 min-w-40">{p.title}</span>
                <input
                  type="date"
                  aria-label="Fecha"
                  value={toDateInput(p.start)}
                  onChange={(e) => setPreview((v) => v!.map((x, j) => (j === i ? { ...x, start: fromDateTimeInputs(e.target.value, toTimeInput(x.start)), day: startOfDay(fromDateTimeInputs(e.target.value)) } : x)))}
                  className="h-8 rounded-lg bg-[#0a102a] border border-line px-2 text-xs"
                />
                <input type="time" aria-label="Hora" value={toTimeInput(p.start)} onChange={(e) => setPreview((v) => v!.map((x, j) => (j === i ? { ...x, start: fromDateTimeInputs(toDateInput(x.start), e.target.value) } : x)))} className="h-8 rounded-lg bg-[#0a102a] border border-line px-2 text-xs" />
                <span className="text-xs text-muted w-14 text-right">{p.minutes} min</span>
                <IconButton label="Quitar sesión" onClick={() => setPreview((v) => v!.filter((_, j) => j !== i))}>
                  <Trash className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [selected, setSelected] = useState(startOfDay());
  const [editing, setEditing] = useState<CalendarEvent | 'new' | null>(params.get('new') ? 'new' : null);
  const [planning, setPlanning] = useState(false);
  const from = addDays(month, -7);
  const to = addDays(month, 45);
  const events = useLiveQuery(() => db.events.where('start').between(from, to).toArray(), [month]) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  useEffect(() => {
    restoreWebReminders();
  }, []);
  const days = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = addDays(month, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);
  const byDay = useMemo(() => {
    const m = new Map<number, CalendarEvent[]>();
    for (const e of events) {
      const d = startOfDay(e.start);
      m.set(d, [...(m.get(d) ?? []), e].sort((a, b) => a.start - b.start));
    }
    return m;
  }, [events]);
  const dayEvents = byDay.get(selected) ?? [];
  const mDate = new Date(month);
  return (
    <div>
      <PageHeader
        title="Calendario"
        subtitle="Exámenes, sesiones de estudio, repasos y entregas. Armá planes realistas y editables."
        icon={<Calendar className="size-5" />}
        actions={
          <>
            <Button icon={<WandSparkles className="size-4" />} onClick={() => setPlanning(true)}>
              Planificar estudio
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Evento
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3">
            <IconButton label="Mes anterior" onClick={() => setMonth(new Date(mDate.getFullYear(), mDate.getMonth() - 1, 1).getTime())}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <h2 className="font-display font-semibold first-letter:uppercase">{mDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</h2>
            <IconButton label="Mes siguiente" onClick={() => setMonth(new Date(mDate.getFullYear(), mDate.getMonth() + 1, 1).getTime())}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-faint mb-1">
            {WEEK.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const evs = byDay.get(d) ?? [];
              const inMonth = new Date(d).getMonth() === mDate.getMonth();
              const today = d === startOfDay();
              return (
                <button key={d} onClick={() => setSelected(d)} className={cx('min-h-[64px] sm:min-h-[84px] rounded-xl border p-1.5 text-left flex flex-col gap-1 transition', selected === d ? 'nav-active' : 'border-line hover:border-line-strong', !inMonth && 'opacity-40')}>
                  <span className={cx('text-xs grid place-items-center size-6 rounded-full', today && 'bg-primary text-white')}>{new Date(d).getDate()}</span>
                  <span className="hidden sm:flex flex-col gap-0.5">
                    {evs.slice(0, 3).map((e) => (
                      <span key={e.id} className={cx('truncate rounded px-1 text-[10px] text-white', TYPE_COLOR[e.type], e.done && 'opacity-50 line-through')}>
                        {e.title}
                      </span>
                    ))}
                    {evs.length > 3 && <span className="text-[10px] text-muted">+{evs.length - 3}</span>}
                  </span>
                  <span className="flex sm:hidden gap-0.5 flex-wrap">
                    {evs.slice(0, 4).map((e) => (
                      <span key={e.id} className={cx('size-1.5 rounded-full', TYPE_COLOR[e.type])} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>
        <Panel className="p-4">
          <h3 className="font-display font-semibold first-letter:uppercase mb-3">{fmtDate(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          {dayEvents.length === 0 ? (
            <p className="text-sm text-muted">Sin eventos. Tocá «Evento» o «Planificar estudio».</p>
          ) : (
            <ul className="space-y-2">
              {dayEvents.map((e) => {
                const sub = subjects.find((x) => x.id === e.subjectId);
                return (
                  <li key={e.id} className="flex items-start gap-2.5">
                    <input type="checkbox" checked={e.done} onChange={(ev) => db.events.update(e.id, { done: ev.target.checked })} aria-label={`Marcar "${e.title}" como hecho`} className="mt-1 size-4 accent-primary" />
                    <button onClick={() => setEditing(e)} className="flex-1 text-left min-w-0">
                      <div className={cx('text-sm', e.done && 'line-through text-muted')}>{e.title}</div>
                      <div className="text-[11px] text-muted flex flex-wrap gap-x-2">
                        <span>{e.allDay ? 'Todo el día' : `${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ''}`}</span>
                        <span>{TYPE_LABEL[e.type]}</span>
                        {sub && <span style={{ color: subjectStyle(sub.color).text }}>{sub.name}</span>}
                        {e.reminderMinutes !== undefined && (
                          <span className="inline-flex items-center gap-0.5">
                            <Bell className="size-3" /> {e.reminderMinutes} min
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
      {editing && (
        <EventModal
          ev={editing === 'new' ? undefined : editing}
          defaultDate={selected + 17 * 3600_000}
          defaultType={params.get('new') === 'exam' ? 'exam' : 'study'}
          onClose={() => {
            setEditing(null);
            if (params.toString()) setParams({}, { replace: true });
          }}
        />
      )}
      {planning && <PlanModal onClose={() => setPlanning(false)} />}
    </div>
  );
}
