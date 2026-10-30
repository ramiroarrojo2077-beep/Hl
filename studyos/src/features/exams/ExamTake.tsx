import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, BookOpen, Check, Download, FileText, GraduationCap, Play, RotateCcw, Target, Timer, Trash } from 'lucide-react';
import { db, type ExamAttempt } from '@/lib/db';
import { newId } from '@/lib/ids';
import { ITEM_TYPE_LABEL, isAnswered } from '@/lib/items';
import { fmtDateTime } from '@/lib/format';
import { exportItemsPdf } from '@/lib/pdfExport';
import { saveFile } from '@/lib/platform';
import { Badge, Button, EmptyState, Notice, PageHeader, Panel, ProgressBar, Spinner, cx } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { ItemAnswer } from '@/components/items/ItemAnswer';
import { ItemMedia } from '@/components/items/ItemMedia';
import { ResultView } from '@/components/items/ResultView';
import { gradeItems } from '@/ai/agents/grader';
import { aiErrorMessage } from '@/ai/types';
import { toast } from '@/stores/toast';
import { difficultyLabel } from '@/ai/agents/common';
import { errorConcepts, gradeExam, overrideExamResult } from './service';

function fmtClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ExamTake() {
  const { id } = useParams();
  const nav = useNavigate();
  const exam = useLiveQuery(() => db.exams.get(id!), [id]);
  const attempts = useLiveQuery(() => db.examAttempts.where('examId').equals(id!).reverse().sortBy('startedAt'), [id]) ?? [];
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [idx, setIdx] = useState(0);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState<AbortController | null>(null);
  const [now, setNow] = useState(Date.now());
  const submitRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!exam || attempt) return;
    const open = attempts.find((a) => a.status === 'in_progress');
    if (open) setAttempt(open);
  }, [exam, attempts, attempt]);

  // Temporizador del simulacro
  const remaining = exam?.timeLimitMin && attempt?.status === 'in_progress' ? exam.timeLimitMin * 60 - (now - attempt.startedAt) / 1000 : null;
  useEffect(() => {
    if (remaining === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [remaining === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !submitting) {
      toast.info('Se terminó el tiempo: el examen se entregó automáticamente.');
      submitRef.current();
    }
  }, [remaining, submitting]);

  if (exam === undefined) return null;
  if (!exam) return <EmptyState icon={<FileText className="size-6" />} title="Examen no encontrado" text="Puede que se haya eliminado." />;

  const start = async () => {
    const a: ExamAttempt = { id: newId(), examId: exam.id, startedAt: Date.now(), answers: {}, results: {}, score: 0, maxScore: 0, status: 'in_progress' };
    await db.examAttempts.add(a);
    setAttempt(a);
    setIdx(0);
    setNow(Date.now());
  };

  const save = (a: ExamAttempt) => {
    setAttempt(a);
    db.examAttempts.put(a);
  };

  const submit = async () => {
    if (!attempt) return;
    const ctrl = new AbortController();
    setSubmitting(ctrl);
    try {
      const g = await gradeExam(exam, { ...attempt, finishedAt: Date.now() }, ctrl.signal);
      setAttempt(g);
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setSubmitting(null);
    }
  };
  submitRef.current = submit;

  const check = async () => {
    if (!attempt) return;
    const it = exam.items[idx];
    setChecking(true);
    try {
      const r = await gradeItems([it], attempt.answers);
      save({ ...attempt, results: { ...attempt.results, ...r } });
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  // ------- Pantalla inicial -------
  if (!attempt) {
    const graded = attempts.filter((a) => a.status === 'graded');
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader
          title={exam.title}
          subtitle={`${exam.items.length} preguntas · ${difficultyLabel(exam.difficulty)} · ${exam.mode === 'mock' ? 'Simulacro: la corrección aparece al final' : 'Práctica: podés comprobar cada respuesta'}${exam.timeLimitMin ? ` · ${exam.timeLimitMin} minutos` : ''}`}
          icon={<FileText className="size-5" />}
          actions={
            <>
              <Button size="sm" variant="outline" icon={<Download className="size-3.5" />} onClick={async () => toast.ok(`Guardado: ${await saveFile(exportItemsPdf({ title: exam.title, items: exam.items }, { solutions: false }), `${exam.title}.pdf`)}`)}>
                PDF
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash className="size-3.5" />}
                onClick={async () => {
                  if (!confirm('¿Eliminar el examen y sus intentos?')) return;
                  await db.examAttempts.where('examId').equals(exam.id).delete();
                  await db.exams.delete(exam.id);
                  nav('/exams');
                }}
              >
                Eliminar
              </Button>
            </>
          }
        />
        <Panel className="p-6 text-center">
          <Button variant="primary" size="lg" icon={<Play className="size-4" />} onClick={start}>
            {graded.length ? 'Hacer otro intento' : 'Empezar examen'}
          </Button>
          <div className="flex flex-wrap justify-center gap-1.5 mt-4">
            {[...new Set(exam.items.map((i) => ITEM_TYPE_LABEL[i.type]))].map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        </Panel>
        {graded.length > 0 && (
          <Panel className="p-4 mt-4">
            <h3 className="font-display font-semibold text-sm mb-2">Intentos anteriores</h3>
            <ul className="space-y-1">
              {graded.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setAttempt(a)} className="w-full flex justify-between text-sm rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <span>{fmtDateTime(a.startedAt)}</span>
                    <span className="font-mono">
                      {a.score}/{a.maxScore} ({a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0}%)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    );
  }

  // ------- Resultados -------
  if (attempt.status === 'graded') {
    const pct = attempt.maxScore ? attempt.score / attempt.maxScore : 0;
    const errs = errorConcepts(exam, attempt.results);
    const doc = exam.docId;
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title={`Resultado: ${exam.title}`} subtitle={`${fmtDateTime(attempt.startedAt)} · duración ${attempt.finishedAt ? Math.round((attempt.finishedAt - attempt.startedAt) / 60000) : '?'} min`} icon={<Target className="size-5" />} />
        <Panel className="p-5 mb-4 flex flex-wrap items-center gap-6">
          <div className="text-center">
            <div className={cx('font-display font-bold text-5xl', pct >= 0.6 ? 'text-ok' : 'text-warn')}>{Math.round(pct * 100)}%</div>
            <div className="text-sm text-muted">
              {attempt.score}/{attempt.maxScore} puntos · nota {(pct * 10).toFixed(1).replace('.', ',')}/10
            </div>
          </div>
          <div className="flex-1 min-w-64">
            <h3 className="text-sm font-medium mb-2">Errores frecuentes y temas para repasar</h3>
            {errs.length === 0 ? (
              <p className="text-sm text-ok">¡Sin errores!</p>
            ) : (
              <ul className="space-y-1.5">
                {errs.slice(0, 6).map((e) => (
                  <li key={e.concept} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {e.concept} <span className="text-xs text-muted">({e.wrong} con errores)</span>
                    </span>
                    <Link to={`/tasks?reinforce=${encodeURIComponent(e.concept)}${exam.subjectId ? `&subject=${exam.subjectId}` : ''}`} className="text-xs text-[#8ea2ff] shrink-0">
                      Practicar →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
        {Object.values(attempt.results).some((r) => r.gradedBy === 'ai' || r.gradedBy === 'pending') && (
          <div className="mb-4">
            <Notice>Las respuestas abiertas se evaluaron con criterios explícitos{Object.values(attempt.results).some((r) => r.gradedBy === 'pending') ? ' (algunas quedaron pendientes de revisión manual)' : ' por IA, que puede equivocarse'}. Revisá cualquier corrección que no te parezca justa.</Notice>
          </div>
        )}
        <div className="space-y-3">
          {exam.items.map((it, i) => (
            <Panel key={it.id} className="p-4">
              <div className="text-xs text-muted mb-2 flex flex-wrap gap-2 items-center">
                <span className="font-semibold text-ink">{i + 1}.</span> {ITEM_TYPE_LABEL[it.type]} · {it.concept}
                {it.sourcePage && doc && (
                  <Link to={`/library/${doc}?page=${it.sourcePage}`} className="inline-flex items-center gap-1 text-cyan">
                    <BookOpen className="size-3" /> p. {it.sourcePage}
                  </Link>
                )}
              </div>
              <Markdown className="mb-2">{it.prompt}</Markdown>
              <ItemAnswer item={it} value={attempt.answers[it.id]} onChange={() => {}} disabled result={attempt.results[it.id]} />
              {attempt.results[it.id] && (
                <div className="mt-3">
                  <ResultView
                    item={it}
                    result={attempt.results[it.id]}
                    onOverride={async (r) => {
                      await overrideExamResult(exam, attempt, it.id, r);
                      const fresh = await db.examAttempts.get(attempt.id);
                      if (fresh) setAttempt(fresh);
                    }}
                  />
                </div>
              )}
            </Panel>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-5">
          <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={start}>
            Nuevo intento
          </Button>
          <Button icon={<GraduationCap className="size-4" />} onClick={() => nav(`/tutor?q=${encodeURIComponent(`Explicame mis errores del examen «${exam.title}» en: ${errs.map((e) => e.concept).join(', ')}`)}${exam.subjectId ? `&subject=${exam.subjectId}` : ''}`)}>
            Repasar con el profesor
          </Button>
          <Button icon={<Download className="size-4" />} onClick={async () => toast.ok(`Guardado: ${await saveFile(exportItemsPdf({ title: exam.title, items: exam.items }, { solutions: true, answers: attempt.answers, results: attempt.results }), `${exam.title} (corrección).pdf`)}`)}>
            Descargar corrección
          </Button>
          <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setAttempt(null)}>
            Volver
          </Button>
        </div>
      </div>
    );
  }

  // ------- Resolviendo -------
  const it = exam.items[idx];
  const answered = exam.items.filter((x) => isAnswered(x, attempt.answers[x.id])).length;
  const practiceResult = exam.mode === 'practice' ? attempt.results[it.id] : undefined;
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h1 className="font-display font-semibold truncate">{exam.title}</h1>
          <div className="text-xs text-muted">
            Pregunta {idx + 1} de {exam.items.length} · {answered} respondidas
          </div>
        </div>
        {remaining !== null && (
          <Badge tone={remaining < 60 ? 'bad' : remaining < 300 ? 'warn' : 'neutral'} className="text-sm px-3 py-1">
            <Timer className="size-3.5" /> {fmtClock(Math.max(0, remaining))}
          </Badge>
        )}
      </div>
      <ProgressBar value={answered / exam.items.length} className="mb-4" />
      <Panel className="p-5">
        <div className="text-xs text-muted mb-2">
          {ITEM_TYPE_LABEL[it.type]} · {it.points} pt{it.points === 1 ? '' : 's'}
        </div>
        {it.type !== 'fill' && <Markdown className="mb-3">{it.prompt}</Markdown>}
        {it.media && (
          <div className="mb-3">
            <ItemMedia media={it.media} />
          </div>
        )}
        <ItemAnswer item={it} value={attempt.answers[it.id]} disabled={!!practiceResult} result={practiceResult} onChange={(v) => save({ ...attempt, answers: { ...attempt.answers, [it.id]: v } })} />
        {exam.mode === 'practice' && !practiceResult && (
          <Button className="mt-3" size="sm" loading={checking} disabled={!isAnswered(it, attempt.answers[it.id])} icon={<Check className="size-4" />} onClick={check}>
            Comprobar
          </Button>
        )}
        {practiceResult && (
          <div className="mt-3">
            <ResultView item={it} result={practiceResult} />
          </div>
        )}
      </Panel>
      <div className="flex items-center justify-between gap-2 mt-4">
        <Button variant="ghost" disabled={idx === 0} icon={<ArrowLeft className="size-4" />} onClick={() => setIdx(idx - 1)}>
          Anterior
        </Button>
        <div className="hidden sm:flex flex-wrap gap-1 justify-center">
          {exam.items.map((x, i) => (
            <button key={x.id} onClick={() => setIdx(i)} aria-label={`Ir a la pregunta ${i + 1}`} className={cx('size-7 rounded-md text-[11px]', i === idx ? 'bg-primary text-white' : isAnswered(x, attempt.answers[x.id]) ? 'bg-white/15' : 'bg-white/5 text-muted')}>
              {i + 1}
            </button>
          ))}
        </div>
        {idx < exam.items.length - 1 ? (
          <Button variant="primary" icon={<ArrowRight className="size-4" />} onClick={() => setIdx(idx + 1)}>
            Siguiente
          </Button>
        ) : submitting ? (
          <Button variant="danger" onClick={() => submitting.abort()}>
            <Spinner className="text-white" /> Cancelar corrección
          </Button>
        ) : (
          <Button variant="primary" icon={<Check className="size-4" />} onClick={() => (answered < exam.items.length && !confirm(`Te faltan ${exam.items.length - answered} preguntas. ¿Entregar igual?`) ? null : submit())}>
            Entregar
          </Button>
        )}
      </div>
    </div>
  );
}
