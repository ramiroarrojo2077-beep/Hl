import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, BookOpen, ClipboardList, Download, Eye, GraduationCap, Lightbulb, PenTool, Pencil, RotateCcw, Send, Sparkles, Square, Trash, Volume2, X } from 'lucide-react';
import { db, type Task, type TaskAttempt } from '@/lib/db';
import { ITEM_TYPE_LABEL, answerText, isAnswered, type Item } from '@/lib/items';
import { fmtDateTime, fromDateTimeInputs, relativeDay, toDateInput } from '@/lib/format';
import { improvementSince } from '@/lib/mastery';
import { exportItemsPdf } from '@/lib/pdfExport';
import { saveFile } from '@/lib/platform';
import { subjectStyle } from '@/lib/subjects';
import { Badge, Button, EmptyState, Field, IconButton, Input, Modal, Notice, Panel, ProgressBar, Spinner, Textarea, cx } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { ItemAnswer } from '@/components/items/ItemAnswer';
import { ItemMedia } from '@/components/items/ItemMedia';
import { ResultView } from '@/components/items/ResultView';
import { aiConfigured, useSettings } from '@/stores/settings';
import { runJob } from '@/stores/jobs';
import { toast } from '@/stores/toast';
import { aiErrorMessage } from '@/ai/types';
import { tutorReply } from '@/ai/agents/tutor';
import { difficultyLabel } from '@/ai/agents/common';
import { speak, stopSpeaking } from '@/voice/tts';
import { useVoice } from '@/voice/bus';
import { STATUS_LABEL, createTask, failedConcepts, getDraft, overrideResult, submitAttempt, syncDueEvent } from './service';
import { statusTone } from './TasksPage';

function Helper({ task, item, answer, onClose }: { task: Task; item: Item; answer: unknown; onClose: () => void }) {
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const attempted = isAnswered(item, answer);
  const ask = async (q: string) => {
    const history = [...msgs, { role: 'user' as const, content: q }];
    setMsgs(history);
    setText('');
    ctrl.current = new AbortController();
    setBusy('');
    try {
      const r = await tutorReply({
        mode: 'socratic',
        level: Math.min(5, Math.max(1, item.difficulty)),
        history,
        docIds: task.sourceDocId ? [task.sourceDocId] : [],
        voice: false,
        extraContext: `El estudiante está resolviendo este ejercicio de la tarea «${task.title}» (concepto: ${item.concept}).\nCONSIGNA: ${item.prompt}\nRESPUESTA ACTUAL DEL ESTUDIANTE: ${answerText(item, answer)}\n${attempted ? 'El estudiante ya intentó responder: podés señalar el error concreto.' : 'Todavía no intentó: NO des la respuesta; guiá con pistas y preguntas.'}\nNunca reveles la respuesta final salvo que el estudiante ya haya entregado o lo pida explícitamente después de intentarlo.`,
        signal: ctrl.current.signal,
        onText: (full) => setBusy(full),
      });
      setMsgs((m) => [...m, { role: 'assistant', content: r.text }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${aiErrorMessage(e)}` }]);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open onClose={() => { ctrl.current?.abort(); stopSpeaking(); onClose(); }} title="Ayuda del profesor" wide>
      <div className="space-y-3">
        <div className="text-xs text-muted">Ejercicio: {item.prompt.slice(0, 160)}</div>
        <div className="flex flex-wrap gap-1.5">
          {['No sé por dónde empezar', 'Explicame el concepto', 'Mostrame un ejemplo similar resuelto', ...(attempted ? ['¿Dónde está mi error?'] : [])].map((q) => (
            <button key={q} disabled={busy !== null} onClick={() => ask(q)} className="text-xs rounded-full border border-line-strong px-3 py-1.5 hover:bg-white/5 disabled:opacity-40">
              {q}
            </button>
          ))}
        </div>
        <div className="space-y-3 max-h-[45dvh] overflow-y-auto scroll-thin">
          {msgs.map((m, i) => (
            <div key={i} className={cx('rounded-xl px-3.5 py-2.5 text-sm', m.role === 'user' ? 'bg-primary/20 ml-10' : 'bg-[#141d42] border border-line mr-6')}>
              {m.role === 'assistant' ? (
                <>
                  <Markdown>{m.content}</Markdown>
                  <button className="mt-1 text-[11px] text-[#8ea2ff] inline-flex items-center gap-1" onClick={() => speak(m.content)}>
                    <Volume2 className="size-3" /> Escuchar
                  </button>
                </>
              ) : (
                m.content
              )}
            </div>
          ))}
          {busy !== null && <div className="rounded-xl px-3.5 py-2.5 text-sm bg-[#141d42] border border-line mr-6">{busy ? <Markdown>{busy}</Markdown> : <Spinner />}</div>}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) ask(text.trim());
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Preguntale al profesor…" />
          {busy !== null ? (
            <Button type="button" variant="danger" onClick={() => ctrl.current?.abort()}>
              Detener
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!text.trim()}>
              <Send className="size-4" />
            </Button>
          )}
        </form>
      </div>
    </Modal>
  );
}

function EditTask({ task, onClose }: { task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [due, setDue] = useState(task.dueDate ? toDateInput(task.dueDate) : '');
  const [items, setItems] = useState(task.items);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Editar tarea"
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            const next = { ...task, title: title.trim() || task.title, description, dueDate: due ? fromDateTimeInputs(due, '23:59') : undefined, items, updatedAt: Date.now() };
            await db.tasks.put(next);
            await syncDueEvent(next);
            toast.ok('Tarea actualizada');
            onClose();
          }}
        >
          Guardar
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="Título">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Descripción">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-16" />
        </Field>
        <Field label="Fecha de entrega">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="text-xs text-muted">Consignas</div>
        {items.map((it, i) => (
          <div key={it.id} className="flex gap-2 items-start">
            <span className="text-xs text-muted mt-3 w-5">{i + 1}.</span>
            <Textarea value={it.prompt} onChange={(e) => setItems((v) => v.map((x) => (x.id === it.id ? { ...x, prompt: e.target.value } : x)))} className="min-h-14 text-[13px]" />
            <IconButton label="Quitar ejercicio" disabled={items.length <= 1} onClick={() => setItems((v) => v.filter((x) => x.id !== it.id))}>
              <Trash className="size-4" />
            </IconButton>
          </div>
        ))}
        <p className="text-[11px] text-faint">Si cambiás una consigna, revisá que la clave de corrección siga siendo válida.</p>
      </div>
    </Modal>
  );
}

export default function TaskSolve() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const s = useSettings((x) => x.s);
  const task = useLiveQuery(() => db.tasks.get(id!), [id]);
  const subject = useLiveQuery(() => (task?.subjectId ? db.subjects.get(task.subjectId) : undefined), [task?.subjectId]);
  const parent = useLiveQuery(() => (task?.parentTaskId ? db.tasks.get(task.parentTaskId) : undefined), [task?.parentTaskId]);
  const attempts = useLiveQuery(() => db.taskAttempts.where('taskId').equals(id!).reverse().sortBy('updatedAt'), [id]) ?? [];
  const mastery = useLiveQuery(() => db.mastery.toArray(), []) ?? [];
  const [attempt, setAttempt] = useState<TaskAttempt | null>(null);
  const [grading, setGrading] = useState<AbortController | null>(null);
  const [helpFor, setHelpFor] = useState<Item | null>(null);
  const [editing, setEditing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const speakingState = useVoice((v) => v.state);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Intento a mostrar: el pedido por parámetro, el último corregido o un borrador.
  useEffect(() => {
    if (!task) return;
    const wanted = params.get('attempt');
    if (wanted) {
      db.taskAttempts.get(wanted).then((a) => a && setAttempt(a));
      return;
    }
    if (attempt && attempt.taskId === task.id) return;
    db.taskAttempts
      .where('taskId')
      .equals(task.id)
      .toArray()
      .then(async (all) => {
        const draft = all.filter((a) => a.status === 'draft').sort((a, b) => b.updatedAt - a.updatedAt)[0];
        const graded = all.filter((a) => a.status === 'graded').sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))[0];
        setAttempt(draft ?? graded ?? (await getDraft(task.id)));
      });
  }, [task?.id, params]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (a: TaskAttempt) => {
    setAttempt(a);
    setSaved(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await db.taskAttempts.put({ ...a, updatedAt: Date.now() });
      if (task && task.status === 'pending') await db.tasks.update(task.id, { status: 'in_progress', updatedAt: Date.now() });
      setSaved(true);
    }, 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const graded = attempt?.status === 'graded';
  const answeredCount = useMemo(() => (task && attempt ? task.items.filter((it) => isAnswered(it, attempt.answers[it.id])).length : 0), [task, attempt]);

  if (task === undefined) return null;
  if (!task) return <EmptyState icon={<ClipboardList className="size-6" />} title="Tarea no encontrada" text="Puede que se haya eliminado." action={<Button onClick={() => nav('/tasks')}>Volver</Button>} />;
  if (!attempt) return <Spinner className="m-10" />;

  const submit = async () => {
    const missing = task.items.length - answeredCount;
    if (missing > 0 && !confirm(`Te faltan ${missing} ejercicio(s) sin responder. ¿Entregar igual?`)) return;
    clearTimeout(saveTimer.current);
    await db.taskAttempts.put({ ...attempt, updatedAt: Date.now() });
    const ctrl = new AbortController();
    setGrading(ctrl);
    try {
      const g = await submitAttempt(task, attempt, ctrl.signal);
      setAttempt(g);
      toast.ok(`Corregida: ${g.score}/${g.maxScore}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setGrading(null);
    }
  };

  const retry = async () => {
    const now = Date.now();
    const a: TaskAttempt = { id: crypto.randomUUID(), taskId: task.id, startedAt: now, updatedAt: now, answers: {}, hintsUsed: {}, revealed: {}, status: 'draft' };
    await db.taskAttempts.add(a);
    setAttempt(a);
    nav(`/tasks/${task.id}`, { replace: true });
  };

  const reinforce = () => {
    const concepts = failedConcepts(task, attempt);
    if (!concepts.length) return toast.info('No hubo errores para reforzar en este intento.');
    runJob(
      'Creando refuerzo de tus errores',
      (ctx) =>
        createTask(
          {
            instruction: `Preparame actividades sobre los temas que respondí mal en «${task.title}»: ${concepts.join(', ')}. Explicá el procedimiento.`,
            subjectId: task.subjectId,
            topic: task.topic,
            level: task.level,
            difficulty: 6,
            types: 'auto',
            count: Math.min(10, Math.max(5, concepts.length * 3)),
            docId: task.sourceDocId,
            modality: task.modality,
            multimedia: true,
            progressive: true,
            origin: 'reinforcement',
            focusConcepts: concepts,
            parentTaskId: task.id,
          },
          ctx,
        ),
      { route: (t) => `/tasks/${t.id}` },
    ).then((t) => t && nav(`/tasks/${t.id}`));
  };

  const explainErrors = () => {
    const wrong = task.items.filter((it) => {
      const r = attempt.results?.[it.id];
      return r && r.score < r.max;
    });
    const text = `${attempt.feedback ?? ''}\n\n${wrong.map((it) => `Ejercicio ${task.items.indexOf(it) + 1}. ${attempt.results![it.id].feedback} ${it.explanation}`).slice(0, 6).join('\n\n')}`;
    speak(text || 'No hubo errores en esta entrega. ¡Muy bien!');
  };

  const doExport = async (kind: 'blank' | 'solutions' | 'mine') => {
    const blob = exportItemsPdf(
      { title: task.title, subtitle: `${subject?.name ?? 'General'} · ${task.level} · ${difficultyLabel(task.difficulty)}`, description: task.description, objectives: task.objectives, items: task.items },
      { solutions: kind === 'solutions', answers: kind === 'mine' ? attempt.answers : undefined, results: kind === 'mine' ? attempt.results : undefined },
    );
    const where = await saveFile(blob, `${task.title}${kind === 'solutions' ? ' (soluciones)' : kind === 'mine' ? ' (mis respuestas)' : ''}.pdf`);
    toast.ok(`PDF guardado: ${where}`);
    setExportOpen(false);
  };

  const pct = graded && attempt.maxScore ? (attempt.score ?? 0) / attempt.maxScore : null;
  const st = subjectStyle(subject?.color);

  return (
    <div className="max-w-4xl mx-auto">
      <Panel className="p-5 mb-4 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1" style={{ background: st.bar }} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Badge tone={statusTone(task.status)}>{STATUS_LABEL[task.status]}</Badge>
              {subject && <span className="text-xs" style={{ color: st.text }}>{subject.name}</span>}
              <span className="text-xs text-muted">
                {task.items.length} ejercicios · ~{task.estimatedMinutes} min · {difficultyLabel(task.difficulty)} · {task.modality}
              </span>
            </div>
            <h1 className="font-display font-semibold text-xl">{task.title}</h1>
            {task.description && <p className="text-sm text-muted mt-1">{task.description}</p>}
            {task.dueDate && <p className="text-xs mt-1 text-[#ffb3b3]">Entrega {relativeDay(task.dueDate)}</p>}
          </div>
          <div className="flex gap-1">
            <IconButton label="Editar tarea" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Exportar o imprimir" onClick={() => setExportOpen(true)}>
              <Download className="size-4" />
            </IconButton>
            <IconButton
              label="Eliminar tarea"
              onClick={async () => {
                if (!confirm('¿Eliminar esta tarea y sus intentos?')) return;
                await db.taskAttempts.where('taskId').equals(task.id).delete();
                await db.events.where('taskId').equals(task.id).delete();
                await db.tasks.delete(task.id);
                nav('/tasks');
              }}
            >
              <Trash className="size-4" />
            </IconButton>
          </div>
        </div>
        {task.objectives.length > 0 && (
          <ul className="mt-3 text-sm list-disc pl-5 text-[#cdd5f0] space-y-0.5">
            {task.objectives.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        )}
        {task.aiComment && <p className="text-[11px] text-faint mt-2">{task.aiComment}</p>}
        {!graded && (
          <div className="mt-4 flex items-center gap-3">
            <ProgressBar value={answeredCount / task.items.length} className="flex-1" />
            <span className="text-xs text-muted shrink-0">
              {answeredCount}/{task.items.length} · {saved ? 'Guardado' : 'Guardando…'}
            </span>
          </div>
        )}
      </Panel>

      {parent && (
        <div className="mb-4">
          <Notice title={`Refuerzo de «${parent.title}»`}>
            {task.focusConcepts.map((c) => {
              const m = mastery.find((x) => x.concept.toLowerCase() === c.toLowerCase() && x.subjectId === task.subjectId);
              if (!m) return null;
              const imp = improvementSince(m, task.createdAt);
              return (
                <span key={c} className="block">
                  {c}: {imp.before === null ? '—' : `${Math.round(imp.before * 100)}%`} → <b>{Math.round(imp.after * 100)}%</b>
                  {imp.before !== null && imp.after > imp.before ? ' (mejoró)' : ''}
                </span>
              );
            })}
          </Notice>
        </div>
      )}

      {graded && pct !== null && (
        <Panel className="p-5 mb-4">
          <div className="flex flex-wrap items-center gap-5">
            <div className="text-center">
              <div className={cx('font-display font-bold text-4xl', pct >= 0.6 ? 'text-ok' : 'text-warn')}>{Math.round(pct * 100)}%</div>
              <div className="text-xs text-muted">
                {attempt.score}/{attempt.maxScore} puntos
              </div>
            </div>
            <div className="flex-1 min-w-60">
              {attempt.feedback ? <Markdown className="!text-sm">{attempt.feedback}</Markdown> : <p className="text-sm text-muted">Corrección registrada {attempt.submittedAt ? fmtDateTime(attempt.submittedAt) : ''}.</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={reinforce} disabled={!aiConfigured(s)}>
              Generar ejercicios de refuerzo
            </Button>
            <Button icon={speakingState === 'speaking' ? <Square className="size-4" /> : <Volume2 className="size-4" />} onClick={() => (speakingState === 'speaking' ? stopSpeaking() : explainErrors())}>
              {speakingState === 'speaking' ? 'Detener' : 'Explicar mis errores en voz alta'}
            </Button>
            <Button icon={<RotateCcw className="size-4" />} onClick={retry}>
              Intentar de nuevo
            </Button>
          </div>
          <p className="text-[11px] text-faint mt-3">Las respuestas abiertas se evaluaron con criterios explícitos. Si una corrección te parece injusta, revisala en el ejercicio.</p>
        </Panel>
      )}

      <div className="space-y-4">
        {task.items.map((it, i) => {
          const hints = attempt.hintsUsed[it.id] ?? 0;
          const revealed = attempt.revealed[it.id];
          const result = attempt.results?.[it.id];
          return (
            <Panel key={it.id} className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
                  <span className="grid place-items-center size-7 rounded-lg bg-primary/20 text-ink font-semibold text-sm">{i + 1}</span>
                  <span>{ITEM_TYPE_LABEL[it.type]}</span>·<span>{it.concept}</span>·<span>{it.points} pt{it.points === 1 ? '' : 's'}</span>·<span>nivel {it.difficulty}</span>
                  {it.sourcePage && task.sourceDocId && (
                    <button className="inline-flex items-center gap-1 text-cyan" onClick={() => nav(`/library/${task.sourceDocId}?page=${it.sourcePage}`)}>
                      <BookOpen className="size-3" /> p. {it.sourcePage}
                    </button>
                  )}
                </div>
                <IconButton label="Leer consigna" onClick={() => speak(it.prompt)}>
                  <Volume2 className="size-4" />
                </IconButton>
              </div>
              {it.type !== 'fill' && <Markdown className="mb-3">{it.prompt}</Markdown>}
              {it.media && (
                <div className="mb-3">
                  <ItemMedia media={it.media} />
                </div>
              )}
              <ItemAnswer item={it} value={attempt.answers[it.id]} disabled={graded} result={result} onChange={(v) => persist({ ...attempt, answers: { ...attempt.answers, [it.id]: v } })} />
              {!graded && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {it.hints.length > 0 && (
                    <Button size="sm" variant="ghost" icon={<Lightbulb className="size-3.5" />} disabled={hints >= it.hints.length} onClick={() => persist({ ...attempt, hintsUsed: { ...attempt.hintsUsed, [it.id]: hints + 1 } })}>
                      {hints >= it.hints.length ? 'Sin más pistas' : `Pista ${hints + 1} de ${it.hints.length}`}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<GraduationCap className="size-3.5" />} disabled={!aiConfigured(s)} onClick={() => setHelpFor(it)}>
                    Ayuda del profesor
                  </Button>
                  <Button size="sm" variant="ghost" icon={<PenTool className="size-3.5" />} onClick={() => nav(`/board?problem=${encodeURIComponent(it.prompt)}`)}>
                    Pizarra
                  </Button>
                  {!revealed && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Eye className="size-3.5" />}
                      disabled={!isAnswered(it, attempt.answers[it.id])}
                      title={isAnswered(it, attempt.answers[it.id]) ? undefined : 'Primero intentá responder'}
                      onClick={() => confirm('Ver la solución cuenta como ayuda en tu registro de dominio. ¿Continuar?') && persist({ ...attempt, revealed: { ...attempt.revealed, [it.id]: true }, hintsUsed: { ...attempt.hintsUsed, [it.id]: Math.max(hints, 3) } })}
                    >
                      Ver solución
                    </Button>
                  )}
                </div>
              )}
              {!graded && hints > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {it.hints.slice(0, hints).map((h, j) => (
                    <li key={j} className="flex gap-2 text-sm rounded-lg bg-warn/10 border border-warn/25 px-3 py-2">
                      <Lightbulb className="size-4 text-warn shrink-0 mt-0.5" />
                      <Markdown className="!text-sm">{h}</Markdown>
                    </li>
                  ))}
                </ul>
              )}
              {!graded && revealed && (
                <div className="mt-3 rounded-xl bg-black/20 p-3 text-sm">
                  <div className="text-xs text-muted mb-1">Solución paso a paso</div>
                  <ol className="list-decimal pl-5 space-y-1">
                    {it.solutionSteps.map((x, j) => (
                      <li key={j}>
                        <Markdown className="!text-sm">{x}</Markdown>
                      </li>
                    ))}
                  </ol>
                  {it.explanation && <Markdown className="!text-[13px] text-muted mt-2">{it.explanation}</Markdown>}
                </div>
              )}
              {graded && result && (
                <div className="mt-3">
                  <ResultView
                    item={it}
                    result={result}
                    onOverride={async (r) => {
                      await overrideResult(task, attempt, it.id, r);
                      const fresh = await db.taskAttempts.get(attempt.id);
                      if (fresh) setAttempt(fresh);
                      toast.ok('Corrección revisada');
                    }}
                  />
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      {!graded && (
        <div className="sticky bottom-20 lg:bottom-4 mt-5 flex justify-end gap-2">
          {grading ? (
            <Panel className="flex items-center gap-3 px-4 py-2.5">
              <Spinner /> <span className="text-sm">Corrigiendo con criterios…</span>
              <Button size="sm" variant="danger" onClick={() => grading.abort()}>
                <X className="size-4" /> Cancelar
              </Button>
            </Panel>
          ) : (
            <Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />} onClick={submit} className="shadow-2xl">
              Entregar para corregir
            </Button>
          )}
        </div>
      )}

      {attempts.filter((a) => a.status === 'graded').length > 0 && (
        <Panel className="p-4 mt-6">
          <h3 className="font-display font-semibold text-sm mb-2">Historial de intentos</h3>
          <ul className="space-y-1.5">
            {attempts
              .filter((a) => a.status === 'graded')
              .map((a) => (
                <li key={a.id}>
                  <button onClick={() => setAttempt(a)} className={cx('w-full flex justify-between text-sm rounded-lg px-2 py-1.5 hover:bg-white/5', a.id === attempt.id && 'bg-white/5')}>
                    <span>{a.submittedAt ? fmtDateTime(a.submittedAt) : ''}</span>
                    <span className="font-mono">
                      {a.score}/{a.maxScore}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </Panel>
      )}

      {helpFor && <Helper task={task} item={helpFor} answer={attempt.answers[helpFor.id]} onClose={() => setHelpFor(null)} />}
      {editing && <EditTask task={task} onClose={() => setEditing(false)} />}
      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="Exportar tarea">
        <div className="grid gap-2">
          <Button onClick={() => doExport('blank')} icon={<Download className="size-4" />}>
            PDF para imprimir (sin soluciones)
          </Button>
          <Button onClick={() => doExport('solutions')} icon={<Download className="size-4" />}>
            PDF con soluciones
          </Button>
          <Button onClick={() => doExport('mine')} icon={<Download className="size-4" />} disabled={!answeredCount}>
            Mis respuestas {graded ? 'y correcciones' : ''}
          </Button>
          <p className="text-[11px] text-faint">En Android el archivo se guarda en Documentos/StudyOS y se abre el menú para compartir o imprimir.</p>
        </div>
      </Modal>
    </div>
  );
}
