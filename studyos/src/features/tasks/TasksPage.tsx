import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, ClipboardList, History, Sparkles, Target, WandSparkles } from 'lucide-react';
import { db, type Task, type TaskStatus } from '@/lib/db';
import { ITEM_TYPE_LABEL, ITEM_TYPES, type ItemType } from '@/lib/items';
import { DifficultyDots, SubjectIconTile, subjectStyle } from '@/lib/subjects';
import { fmtDate, relativeDay, startOfDay, toDateInput, fromDateTimeInputs, timeAgo } from '@/lib/format';
import { weakConcepts } from '@/lib/mastery';
import { Badge, Button, EmptyState, Field, Input, Modal, Notice, PageHeader, Panel, ProgressBar, Select, Slider, Tabs, Textarea, Toggle, cx } from '@/components/ui';
import { runJob } from '@/stores/jobs';
import { aiConfigured, useSettings } from '@/stores/settings';
import { difficultyLabel } from '@/ai/agents/common';
import { STATUS_LABEL, createTask } from './service';

const EXAMPLES = [
  'Creame una tarea de matemática sobre fracciones para segundo año',
  'Haceme 15 ejercicios de ecuaciones, de menor a mayor dificultad',
  'Creá una tarea de historia con preguntas de desarrollo',
  'Generame una tarea que incluya ejercicios, imágenes y gráficos',
  'Creá una tarea de física sobre el sistema solar donde tenga que observar un modelo 3D y responder preguntas',
];

export function statusTone(s: TaskStatus) {
  return s === 'graded' ? 'ok' : s === 'needs_review' ? 'warn' : s === 'in_progress' ? 'cyan' : s === 'completed' ? 'violet' : 'neutral';
}

function CreateTaskDialog({ open, onClose, preset }: { open: boolean; onClose: () => void; preset: { subjectId?: string; docId?: string; summaryId?: string; fromTutor?: boolean; reinforce?: string } }) {
  const nav = useNavigate();
  const s = useSettings((x) => x.s);
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const docs = useLiveQuery(() => db.documents.orderBy('createdAt').reverse().filter((d) => d.status !== 'error' && d.status !== 'processing').toArray(), []) ?? [];
  const summary = useLiveQuery(() => (preset.summaryId ? db.summaries.get(preset.summaryId) : undefined), [preset.summaryId]);
  const [instruction, setInstruction] = useState('');
  const [subjectId, setSubjectId] = useState(preset.subjectId ?? '');
  const [docId, setDocId] = useState(preset.docId ?? '');
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState(s.profile.level);
  const [difficulty, setDifficulty] = useState(preset.reinforce ? 6 : 3);
  const [count, setCount] = useState(10);
  const [autoCount, setAutoCount] = useState(true);
  const [types, setTypes] = useState<ItemType[] | 'auto'>('auto');
  const [minutes, setMinutes] = useState(30);
  const [objectives, setObjectives] = useState('');
  const [modality, setModality] = useState<'individual' | 'grupal'>('individual');
  const [multimedia, setMultimedia] = useState(true);
  const [progressive, setProgressive] = useState(true);
  const [due, setDue] = useState('');
  useEffect(() => {
    if (!open) return;
    setSubjectId(preset.subjectId ?? '');
    setDocId(preset.docId ?? '');
    if (preset.reinforce) {
      setInstruction(`Preparame actividades para reforzar «${preset.reinforce}», enfocadas en los errores que cometí`);
      setDifficulty(6);
    } else if (preset.fromTutor) setInstruction('Creame una tarea para practicar lo que vimos con el profesor');
    else if (preset.summaryId) setInstruction('Creame una tarea a partir de este resumen');
    else if (preset.docId) setInstruction('Preparame una tarea utilizando este documento');
  }, [open, preset.subjectId, preset.docId, preset.reinforce, preset.fromTutor, preset.summaryId]);

  const go = () => {
    const extraContext = preset.fromTutor ? `CONVERSACIÓN CON EL PROFESOR:\n${sessionStorage.getItem('studyos:taskContext') ?? ''}` : summary ? `RESUMEN «${summary.title}»:\n${summary.content}` : undefined;
    const input = {
      instruction: instruction.trim(),
      subjectId: subjectId || undefined,
      topic: topic.trim() || undefined,
      level,
      difficulty,
      count: autoCount ? undefined : count,
      types,
      estimatedMinutes: minutes,
      objectives: objectives.split('\n').map((x) => x.trim()).filter(Boolean),
      docId: docId || summary?.docId || undefined,
      extraContext,
      modality,
      multimedia,
      progressive,
      dueDate: due ? fromDateTimeInputs(due, '23:59') : undefined,
      origin: (preset.reinforce ? 'errors' : preset.fromTutor ? 'tutor' : preset.summaryId ? 'summary' : docId ? 'document' : 'prompt') as Task['origin'],
      focusConcepts: preset.reinforce ? [preset.reinforce] : undefined,
    };
    onClose();
    runJob(`Creando tarea: ${input.instruction.slice(0, 50)}`, (ctx) => createTask(input, ctx), { route: (t) => `/tasks/${t.id}` }).then((t) => t && nav(`/tasks/${t.id}`));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Crear tarea con IA"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon={<WandSparkles className="size-4" />} disabled={!instruction.trim() || !aiConfigured(s)} onClick={go}>
            Generar tarea
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!aiConfigured(s) && <Notice tone="warn">Configurá un proveedor de IA en Configuración para generar tareas.</Notice>}
        {preset.reinforce && <Notice title="Refuerzo adaptativo">La IA va a recibir tus respuestas incorrectas reales en «{preset.reinforce}» para diseñar ejercicios que ataquen esos errores.</Notice>}
        <Field label="¿Qué tarea necesitás?">
          <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Ej.: Haceme 15 ejercicios de ecuaciones, de menor a mayor dificultad" className="min-h-20" />
        </Field>
        {!instruction && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => (
              <button key={e} onClick={() => setInstruction(e)} className="text-[11px] rounded-full border border-line px-2.5 py-1 text-muted hover:text-ink text-left">
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Materia">
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Sin materia</option>
              {subjects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tema">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ej.: fracciones" />
          </Field>
          <Field label="Año o nivel">
            <Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Ej.: 2.º año" />
          </Field>
        </div>
        <Field label="Material de referencia">
          <Select value={docId} onChange={(e) => setDocId(e.target.value)}>
            <option value="">{summary ? `Resumen: ${summary.title}` : preset.fromTutor ? 'Conversación con el profesor' : 'Ninguno (conocimiento general)'}</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Slider label="Dificultad" value={difficulty} min={1} max={6} onChange={setDifficulty} format={(v) => difficultyLabel(v)} />
          <div>
            <Slider label="Cantidad de ejercicios" value={count} min={3} max={25} onChange={(v) => { setCount(v); setAutoCount(false); }} format={(v) => (autoCount ? 'según la instrucción' : String(v))} />
            <label className="flex items-center gap-2 text-[11px] text-muted mt-1">
              <input type="checkbox" className="accent-primary" checked={autoCount} onChange={(e) => setAutoCount(e.target.checked)} /> Tomar la cantidad de la instrucción
            </label>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted mb-1.5">Tipos de actividades</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setTypes('auto')} className={cx('h-8 px-3 rounded-full border text-xs', types === 'auto' ? 'nav-active' : 'border-line text-muted')}>
              Que elija la IA
            </button>
            {ITEM_TYPES.map((t) => {
              const on = types !== 'auto' && types.includes(t);
              return (
                <button key={t} onClick={() => setTypes((v) => (v === 'auto' ? [t] : on ? (v.filter((x) => x !== t).length ? v.filter((x) => x !== t) : 'auto') : [...v, t]))} className={cx('h-8 px-3 rounded-full border text-xs', on ? 'nav-active' : 'border-line text-muted')}>
                  {ITEM_TYPE_LABEL[t]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Duración estimada (min)">
            <Input type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </Field>
          <Field label="Modalidad">
            <Select value={modality} onChange={(e) => setModality(e.target.value as 'individual' | 'grupal')}>
              <option value="individual">Individual</option>
              <option value="grupal">Grupal</option>
            </Select>
          </Field>
          <Field label="Fecha de entrega (opcional)">
            <Input type="date" value={due} min={toDateInput(Date.now())} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Objetivos de aprendizaje (uno por línea, opcional)">
          <Textarea value={objectives} onChange={(e) => setObjectives(e.target.value)} className="min-h-16" />
        </Field>
        <div className="grid sm:grid-cols-2 gap-2">
          <Toggle label="Actividades multimedia" hint="Gráficos, tablas, diagramas y simulaciones 3D" checked={multimedia} onChange={setMultimedia} />
          <Toggle label="De menor a mayor dificultad" checked={progressive} onChange={setProgressive} />
        </div>
      </div>
    </Modal>
  );
}

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'pending' | 'done' | 'review' | 'history'>('pending');
  const [open, setOpen] = useState(params.get('new') === '1' || !!params.get('reinforce'));
  const preset = useMemo(
    () => ({ subjectId: params.get('subject') ?? undefined, docId: params.get('doc') ?? undefined, summaryId: params.get('summary') ?? undefined, fromTutor: params.get('from') === 'tutor', reinforce: params.get('reinforce') ?? undefined }),
    [params],
  );
  const tasks = useLiveQuery(() => db.tasks.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const attempts = useLiveQuery(() => db.taskAttempts.where('status').equals('graded').reverse().sortBy('submittedAt'), []) ?? [];
  const weak = useLiveQuery(() => weakConcepts(undefined, 6), [attempts.length]) ?? [];
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const done = tasks.filter((t) => t.status === 'graded' || t.status === 'completed');
  const review = tasks.filter((t) => t.status === 'needs_review');
  const list = tab === 'pending' ? pending : tab === 'done' ? done : review;
  const upcoming = pending.filter((t) => t.dueDate).sort((a, b) => a.dueDate! - b.dueDate!);
  const perSubject = useMemo(() => {
    const m = new Map<string, { sum: number; n: number }>();
    for (const t of tasks) {
      if (t.lastScore === undefined) continue;
      const k = t.subjectId ?? '_';
      const c = m.get(k) ?? { sum: 0, n: 0 };
      c.sum += t.lastScore;
      c.n++;
      m.set(k, c);
    }
    return [...m.entries()].map(([k, v]) => ({ subject: byId.get(k), avg: v.sum / v.n, n: v.n }));
  }, [tasks, subjects]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setOpen(false);
    if (params.toString()) setParams({}, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Mis tareas"
        subtitle="SmartTasks AI: tareas personalizadas que se corrigen con criterios explícitos y se adaptan a tus resultados."
        icon={<ClipboardList className="size-5" />}
        actions={
          <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => setOpen(true)}>
            Crear tarea con IA
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'pending', label: 'Pendientes', count: pending.length },
              { value: 'review', label: 'Necesita repaso', count: review.length },
              { value: 'done', label: 'Completadas', count: done.length },
              { value: 'history', label: 'Historial de correcciones', count: attempts.length },
            ]}
          />
          {tab !== 'history' ? (
            list.length === 0 ? (
              <EmptyState icon={<ClipboardList className="size-6" />} title={tab === 'pending' ? 'No hay tareas pendientes' : 'Nada por acá'} text="Pedí una tarea en lenguaje natural, desde un PDF, un resumen o una clase con el profesor." action={<Button variant="primary" onClick={() => setOpen(true)}>Crear tarea con IA</Button>} />
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {list.map((t) => {
                  const s = t.subjectId ? byId.get(t.subjectId) : undefined;
                  return (
                    <Link key={t.id} to={`/tasks/${t.id}`} className="panel relative overflow-hidden p-3.5 sm:p-4 flex gap-3 hover:border-line-strong active:scale-[.99] transition">
                      <span className="absolute left-0 inset-y-0 w-[3px]" style={{ background: s ? subjectStyle(s.color).bar : '#5b6b95' }} aria-hidden="true" />
                      <SubjectIconTile subject={s} fallback="pen" />
                      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium leading-snug line-clamp-2">{t.title}</div>
                          <Badge tone={statusTone(t.status)} className="shrink-0">{STATUS_LABEL[t.status]}</Badge>
                        </div>
                        <div className="text-xs text-muted">
                          {s ? <span style={{ color: subjectStyle(s.color).text }}>{s.name}</span> : 'General'} · {t.items.length} {t.items.length === 1 ? 'ejercicio' : 'ejercicios'} · ~{t.estimatedMinutes} min
                          {t.modality === 'grupal' ? ' · grupal' : ''}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
                          <span className="inline-flex items-center gap-1.5" title={difficultyLabel(t.difficulty)}>
                            <DifficultyDots value={t.difficulty === 6 ? 3 : t.difficulty} color={s ? subjectStyle(s.color).bar : undefined} />
                            {t.difficulty === 6 ? 'Adaptativa' : difficultyLabel(t.difficulty)}
                          </span>
                          {t.dueDate && <span className={cx('inline-flex items-center gap-1', t.dueDate < startOfDay() ? 'text-bad' : '')}><CalendarDays className="size-3.5" />Entrega {relativeDay(t.dueDate)}</span>}
                          {t.lastScore !== undefined && (
                            <span className="flex items-center gap-2 min-w-36">
                              <ProgressBar value={t.lastScore} className="w-20" tone={t.lastScore >= 0.6 ? 'ok' : 'warn'} /> {Math.round(t.lastScore * 100)}%
                            </span>
                          )}
                          {t.origin === 'errors' && <Badge tone="warn">Refuerzo</Badge>}
                          {t.origin === 'document' && <Badge tone="cyan">Desde documento</Badge>}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )
          ) : attempts.length === 0 ? (
            <EmptyState icon={<History className="size-6" />} title="Sin correcciones todavía" text="Cuando entregues una tarea, sus correcciones aparecen acá." />
          ) : (
            <div className="grid gap-2">
              {attempts.map((a) => {
                const t = taskById.get(a.taskId);
                if (!t) return null;
                return (
                  <Link key={a.id} to={`/tasks/${t.id}?attempt=${a.id}`} className="panel p-3 flex items-center justify-between gap-3 hover:border-line-strong">
                    <span className="min-w-0">
                      <span className="block text-sm truncate">{t.title}</span>
                      <span className="text-xs text-muted">{a.submittedAt ? timeAgo(a.submittedAt) : ''}</span>
                    </span>
                    <Badge tone={(a.score ?? 0) / (a.maxScore || 1) >= 0.6 ? 'ok' : 'warn'}>
                      {a.score}/{a.maxScore}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <aside className="space-y-3">
          <Panel className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="size-4 text-warn" />
              <h3 className="font-display font-semibold text-sm">Actividades recomendadas</h3>
            </div>
            {weak.length === 0 ? (
              <p className="text-xs text-muted">Cuando corrijas tareas o exámenes, acá vas a ver qué conceptos conviene reforzar (según tus resultados reales).</p>
            ) : (
              <ul className="space-y-2">
                {weak.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm truncate">{w.concept}</span>
                      <span className="text-[11px] text-muted">
                        Dominio {Math.round(w.score * 100)}% · {w.attempts} intentos
                      </span>
                    </span>
                    <Button size="sm" variant="outline" onClick={() => setParams({ reinforce: w.concept, ...(w.subjectId ? { subject: w.subjectId } : {}) })}>
                      Reforzar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CalendarDays className="size-4 text-cyan" />
              <h3 className="font-display font-semibold text-sm">Calendario de entregas</h3>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-xs text-muted">Sin entregas con fecha.</p>
            ) : (
              <ul className="space-y-1.5">
                {upcoming.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <Link to={`/tasks/${t.id}`} className="flex justify-between gap-2 text-sm">
                      <span className="truncate">{t.title}</span>
                      <span className={cx('text-xs shrink-0', t.dueDate! < startOfDay() ? 'text-bad' : 'text-muted')}>{fmtDate(t.dueDate!)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel className="p-4">
            <h3 className="font-display font-semibold text-sm mb-2">Progreso por materia</h3>
            {perSubject.length === 0 ? (
              <p className="text-xs text-muted">Sin tareas corregidas.</p>
            ) : (
              <ul className="space-y-2.5">
                {perSubject.map((p, i) => (
                  <li key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span>{p.subject?.name ?? 'General'}</span>
                      <span className="text-muted">
                        {Math.round(p.avg * 100)}% · {p.n} tareas
                      </span>
                    </div>
                    <ProgressBar value={p.avg} tone={p.avg >= 0.6 ? 'ok' : 'warn'} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
      <CreateTaskDialog open={open} onClose={close} preset={preset} />
    </div>
  );
}
