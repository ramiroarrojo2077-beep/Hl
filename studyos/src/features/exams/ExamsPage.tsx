import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Layers, Plus, Sparkles, Timer } from 'lucide-react';
import { db, type Exam } from '@/lib/db';
import { newId } from '@/lib/ids';
import { ITEM_TYPE_LABEL, ITEM_TYPES, type Item, type ItemType } from '@/lib/items';
import { fmtDate } from '@/lib/format';
import { DifficultyDots, SubjectIconTile, subjectStyle } from '@/lib/subjects';
import { Badge, Button, EmptyState, Field, Input, Modal, Notice, PageHeader, Segmented, Select, Slider, cx } from '@/components/ui';
import { runJob } from '@/stores/jobs';
import { aiConfigured, useSettings } from '@/stores/settings';
import { generateExamItems } from '@/ai/agents/exam';
import { difficultyLabel } from '@/ai/agents/common';
import { previousPrompts } from '@/features/tasks/service';

function CreateExam({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const s = useSettings((x) => x.s);
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const docs = useLiveQuery(() => db.documents.filter((d) => d.status !== 'error' && d.status !== 'processing').toArray(), []) ?? [];
  const decks = useLiveQuery(() => db.decks.toArray(), []) ?? [];
  const [source, setSource] = useState<'ai' | 'deck'>('ai');
  const [subjectId, setSubjectId] = useState(params.get('subject') ?? '');
  const [docId, setDocId] = useState(params.get('doc') ?? '');
  const [deckId, setDeckId] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState(3);
  const [count, setCount] = useState(10);
  const [types, setTypes] = useState<ItemType[]>(['mcq', 'tf', 'short', 'fill', 'problem']);
  const [mode, setMode] = useState<'practice' | 'mock'>('practice');
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (!aiConfigured(s)) setSource('deck');
  }, [s]);

  const create = async () => {
    onClose();
    if (source === 'deck') {
      const deck = await db.decks.get(deckId);
      const cards = (await db.cards.where('deckId').equals(deckId).toArray()).sort(() => Math.random() - 0.5).slice(0, count);
      const items: Item[] = cards.map((c) => ({ id: newId(), type: 'short', prompt: c.front, concept: c.concept || deck?.name || 'General', difficulty: 3, points: 1, hints: [], solutionSteps: [], explanation: '', acceptedAnswers: [c.back], sourcePage: c.sourcePage }));
      const ex: Exam = { id: newId(), subjectId: deck?.subjectId, docId: deck?.docId, title: `Examen de «${deck?.name}»`, topic: deck?.name ?? '', difficulty: 3, mode, timeLimitMin: time || undefined, items, provider: 'flashcards', model: '-', createdAt: Date.now() };
      await db.exams.add(ex);
      nav(`/exams/${ex.id}`);
      return;
    }
    const subject = subjects.find((x) => x.id === subjectId);
    runJob(
      `Generando examen${topic ? ` de ${topic}` : ''}`,
      async ({ signal, progress }) => {
        const g = await generateExamItems({ subjectName: subject?.name, topic, docId: docId || undefined, difficulty, count, types, avoid: await previousPrompts(subjectId || undefined), signal, onProgress: progress });
        const ex: Exam = { id: newId(), subjectId: subjectId || undefined, docId: docId || undefined, title: g.title, topic, difficulty, mode, timeLimitMin: time || undefined, items: g.items, provider: g.provider, model: g.model, createdAt: Date.now() };
        await db.exams.add(ex);
        return ex;
      },
      { route: (e) => `/exams/${e.id}` },
    ).then((e) => e && nav(`/exams/${e.id}`));
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Nuevo examen"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={source === 'ai' ? !aiConfigured(s) || (!topic.trim() && !docId) || !types.length : !deckId} onClick={create}>
            Crear examen
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented value={source} onChange={setSource} options={[{ value: 'ai', label: 'Generar con IA' }, { value: 'deck', label: 'Desde mis flashcards' }]} />
        {source === 'ai' ? (
          <>
            {!aiConfigured(s) && <Notice tone="warn">Configurá un proveedor de IA para generar exámenes, o armalo desde tus flashcards.</Notice>}
            <div className="grid sm:grid-cols-2 gap-3">
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
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ej.: estequiometría" />
              </Field>
            </div>
            <Field label="Basado en el documento (opcional)">
              <Select value={docId} onChange={(e) => setDocId(e.target.value)}>
                <option value="">Ninguno</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Slider label="Dificultad" value={difficulty} min={1} max={5} onChange={setDifficulty} format={difficultyLabel} />
              <Slider label="Cantidad de preguntas" value={count} min={3} max={30} onChange={setCount} />
            </div>
            <div>
              <div className="text-xs text-muted mb-1.5">Tipos de preguntas</div>
              <div className="flex flex-wrap gap-1.5">
                {ITEM_TYPES.filter((t) => t !== 'order' && t !== 'numeric').map((t) => (
                  <button key={t} onClick={() => setTypes((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]))} className={cx('h-8 px-3 rounded-full border text-xs', types.includes(t) ? 'nav-active' : 'border-line text-muted')}>
                    {ITEM_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <Field label="Mazo">
              <Select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                <option value="">Elegí un mazo</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Slider label="Cantidad de preguntas" value={count} min={3} max={40} onChange={setCount} />
            <p className="text-[11px] text-faint">Cada tarjeta se convierte en una pregunta de respuesta corta; la corrección compara con el dorso (tolera errores de tipeo) y, si hay IA, evalúa formulaciones distintas.</p>
          </>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted mb-1.5">Modo</div>
            <Segmented value={mode} onChange={setMode} options={[{ value: 'practice', label: 'Práctica (corrección al instante)' }, { value: 'mock', label: 'Simulacro' }]} size="sm" />
          </div>
          <Slider label="Tiempo límite" value={time} min={0} max={180} step={5} onChange={setTime} format={(v) => (v ? `${v} min` : 'Sin límite')} />
        </div>
      </div>
    </Modal>
  );
}

function ScoreRing({ value }: { value: number }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const color = value >= 0.6 ? '#34d399' : '#fbbf24';
  return (
    <span className="relative self-center grid place-items-center size-12 shrink-0" title="Mejor resultado">
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(150,165,220,.18)" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} />
      </svg>
      <span className="text-[11px] font-semibold" style={{ color }}>
        {Math.round(value * 100)}%
      </span>
      <span className="sr-only">Mejor resultado</span>
    </span>
  );
}

export default function ExamsPage() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const exams = useLiveQuery(() => db.exams.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const attempts = useLiveQuery(() => db.examAttempts.toArray(), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const best = (id: string) => attempts.filter((a) => a.examId === id && a.status === 'graded').reduce<number | null>((b, a) => Math.max(b ?? 0, a.maxScore ? a.score / a.maxScore : 0), null);
  return (
    <div>
      <PageHeader
        title="Exámenes"
        subtitle="Evaluaciones de práctica y simulacros con corrección explicada. Las respuestas abiertas se corrigen con criterios y podés revisarlas."
        icon={<FileText className="size-5" />}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Nuevo examen
          </Button>
        }
      />
      {exams.length === 0 ? (
        <EmptyState icon={<FileText className="size-6" />} title="Sin exámenes" text="Generá un examen sobre un tema o un documento, o armalo con tus flashcards." action={<Button variant="primary" onClick={() => setOpen(true)}>Crear examen</Button>} />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {exams.map((e) => {
            const b = best(e.id);
            const s = subjects.find((x) => x.id === e.subjectId);
            return (
              <Link key={e.id} to={`/exams/${e.id}`} className="panel relative overflow-hidden p-3.5 sm:p-4 hover:border-line-strong active:scale-[.99] transition flex gap-3">
                <span className="absolute left-0 inset-y-0 w-[3px]" style={{ background: s ? subjectStyle(s.color).bar : '#8b5cf6' }} aria-hidden="true" />
                <SubjectIconTile subject={s} fallback="pen" />
                <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                  <div className="font-medium leading-snug line-clamp-2">{e.title}</div>
                  <div className="text-xs text-muted">
                    {s ? <span style={{ color: subjectStyle(s.color).text }}>{s.name}</span> : 'General'} · {e.items.length} {e.items.length === 1 ? 'pregunta' : 'preguntas'} · {fmtDate(e.createdAt)}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={e.mode === 'mock' ? 'violet' : 'cyan'}>{e.mode === 'mock' ? 'Simulacro' : 'Práctica'}</Badge>
                    {e.timeLimitMin && (
                      <Badge>
                        <Timer className="size-3" /> {e.timeLimitMin} min
                      </Badge>
                    )}
                    {e.provider === 'flashcards' && (
                      <Badge>
                        <Layers className="size-3" /> Desde flashcards
                      </Badge>
                    )}
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted ml-0.5" title={difficultyLabel(e.difficulty)}>
                      <DifficultyDots value={e.difficulty} color={s ? subjectStyle(s.color).bar : undefined} />
                    </span>
                  </div>
                </div>
                {b !== null ? <ScoreRing value={b} /> : <span className="self-center text-[10.5px] text-faint text-center leading-tight w-12 shrink-0">Sin intentos</span>}
              </Link>
            );
          })}
        </div>
      )}
      <CreateExam
        open={open}
        onClose={() => {
          setOpen(false);
          if (params.toString()) setParams({}, { replace: true });
        }}
      />
    </div>
  );
}
