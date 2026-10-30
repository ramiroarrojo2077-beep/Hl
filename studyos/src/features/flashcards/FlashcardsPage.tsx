import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Layers, Plus, Sparkles } from 'lucide-react';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { initialSrs, estimatedRetention } from '@/lib/srs';
import { Badge, Button, EmptyState, Field, Input, Modal, Notice, PageHeader, Segmented, Select, Slider } from '@/components/ui';
import { runJob } from '@/stores/jobs';
import { aiConfigured, useSettings } from '@/stores/settings';
import { generateFlashcards } from '@/ai/agents/flashcards';

function NewDeck({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const s = useSettings((x) => x.s);
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const docs = useLiveQuery(() => db.documents.filter((d) => d.status !== 'error' && d.status !== 'processing').toArray(), []) ?? [];
  const summary = useLiveQuery(() => (params.get('summary') ? db.summaries.get(params.get('summary')!) : undefined), [params]);
  const [mode, setMode] = useState<'manual' | 'ai'>(params.get('doc') || params.get('summary') ? 'ai' : 'manual');
  const [name, setName] = useState('');
  const [subjectId, setSubjectId] = useState(params.get('subject') ?? '');
  const [docId, setDocId] = useState(params.get('doc') ?? '');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(15);
  const [difficulty, setDifficulty] = useState(3);
  const create = async () => {
    onClose();
    const now = Date.now();
    const doc = docs.find((d) => d.id === (docId || summary?.docId));
    const deckName = name.trim() || (doc ? `Flashcards — ${doc.title}` : topic ? `Flashcards — ${topic}` : 'Nuevo mazo');
    const deckId = newId();
    const sid = subjectId || doc?.subjectId || undefined;
    if (mode === 'manual') {
      await db.decks.add({ id: deckId, name: deckName, subjectId: sid, createdAt: now });
      nav(`/flashcards/${deckId}?edit=1`);
      return;
    }
    runJob(
      `Generando flashcards: ${deckName}`,
      async ({ signal, progress }) => {
        progress(null, 'Creando tarjetas');
        const cards = await generateFlashcards({ docId: doc?.id, topic: topic || (summary ? summary.title : undefined), count, difficulty, signal });
        await db.decks.add({ id: deckId, name: deckName, subjectId: sid, docId: doc?.id, createdAt: now });
        await db.cards.bulkAdd(cards.map((c) => ({ id: newId(), deckId, front: c.front, back: c.back, concept: c.concept, sourcePage: c.sourcePage ?? undefined, ...initialSrs(now), createdAt: now, updatedAt: now })));
        return deckId;
      },
      { route: (id) => `/flashcards/${id}` },
    ).then((id) => id && nav(`/flashcards/${id}`));
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo mazo"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={create} disabled={mode === 'ai' && (!aiConfigured(s) || (!docId && !topic.trim() && !summary))}>
            {mode === 'ai' ? 'Generar' : 'Crear mazo'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'manual', label: 'Crear a mano' }, { value: 'ai', label: 'Generar con IA' }]} />
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Tabla periódica" />
        </Field>
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
        {mode === 'ai' && (
          <>
            {!aiConfigured(s) && <Notice tone="warn">Configurá un proveedor de IA para generar tarjetas.</Notice>}
            {summary && <Notice>Basado en el resumen «{summary.title}».</Notice>}
            <Field label="Documento">
              <Select value={docId} onChange={(e) => setDocId(e.target.value)}>
                <option value="">Ninguno</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tema (opcional)">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ej.: enlaces químicos" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Slider label="Cantidad" value={count} min={5} max={40} onChange={setCount} />
              <Slider label="Dificultad" value={difficulty} min={1} max={5} onChange={setDifficulty} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function FlashcardsPage() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const decks = useLiveQuery(() => db.decks.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const cards = useLiveQuery(() => db.cards.toArray(), []) ?? [];
  const now = Date.now();
  return (
    <div>
      <PageHeader
        title="Flashcards"
        subtitle="Repetición espaciada (algoritmo SM-2): cada tarjeta vuelve justo antes de que la olvides."
        icon={<Layers className="size-5" />}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Nuevo mazo
          </Button>
        }
      />
      {decks.length === 0 ? (
        <EmptyState icon={<Layers className="size-6" />} title="Sin mazos" text="Creá tarjetas a mano o generalas desde un documento, un resumen o un tema." action={<Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => setOpen(true)}>Crear mazo</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {decks.map((d) => {
            const dc = cards.filter((c) => c.deckId === d.id);
            const due = dc.filter((c) => c.due <= now).length;
            const reviewed = dc.filter((c) => c.lastReview);
            const ret = reviewed.length ? reviewed.reduce((s, c) => s + estimatedRetention(c, now), 0) / reviewed.length : null;
            return (
              <Link key={d.id} to={`/flashcards/${d.id}`} className="panel p-4 hover:border-line-strong flex flex-col gap-2 relative overflow-hidden">
                <div className="absolute -right-6 -top-6 size-24 rounded-2xl bg-gradient-to-br from-[#8577f0] to-[#3b2fa8] rotate-12 opacity-30" />
                <div className="font-medium relative">{d.name}</div>
                <div className="text-xs text-muted relative">{dc.length} tarjetas</div>
                <div className="flex flex-wrap gap-1.5 relative">
                  {due > 0 ? <Badge tone="primary">{due} para repasar</Badge> : <Badge tone="ok">Al día</Badge>}
                  {ret !== null && <Badge>Retención estimada {Math.round(ret * 100)}%</Badge>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <NewDeck
        open={open}
        onClose={() => {
          setOpen(false);
          if (params.toString()) setParams({}, { replace: true });
        }}
      />
    </div>
  );
}
