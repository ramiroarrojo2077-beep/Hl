import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, ImagePlus, Layers, Pencil, Play, Plus, Trash, Volume2 } from 'lucide-react';
import { db, logActivity, type Card } from '@/lib/db';
import { newId } from '@/lib/ids';
import { GRADE_BUTTONS, estimatedRetention, initialSrs, previewInterval, review } from '@/lib/srs';
import { recordMastery } from '@/lib/mastery';
import { fmtDate, startOfDay, addDays } from '@/lib/format';
import { fileToDataUrl } from '@/lib/platform';
import { Badge, Button, EmptyState, IconButton, Modal, PageHeader, Panel, ProgressBar, Stat, Tabs, Textarea } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { speak } from '@/voice/tts';
import { toast } from '@/stores/toast';

function CardEditor({ card, deckId, onClose }: { card?: Card; deckId: string; onClose: () => void }) {
  const [front, setFront] = useState(card?.front ?? '');
  const [back, setBack] = useState(card?.back ?? '');
  const [image, setImage] = useState(card?.image);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = async (another: boolean) => {
    const now = Date.now();
    if (card) await db.cards.update(card.id, { front, back, image, updatedAt: now });
    else await db.cards.add({ id: newId(), deckId, front, back, image, ...initialSrs(now), createdAt: now, updatedAt: now });
    if (another) {
      setFront('');
      setBack('');
      setImage(undefined);
      toast.ok('Tarjeta agregada');
    } else onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={card ? 'Editar tarjeta' : 'Nueva tarjeta'}
      footer={
        <>
          {!card && (
            <Button variant="ghost" disabled={!front.trim() || !back.trim()} onClick={() => save(true)}>
              Guardar y otra
            </Button>
          )}
          <Button variant="primary" disabled={!front.trim() || !back.trim()} onClick={() => save(false)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-muted">Frente (pregunta)</span>
          <Textarea value={front} onChange={(e) => setFront(e.target.value)} className="mt-1 min-h-20" placeholder="Admite Markdown y fórmulas $...$" autoFocus />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Dorso (respuesta)</span>
          <Textarea value={back} onChange={(e) => setBack(e.target.value)} className="mt-1 min-h-20" />
        </label>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" icon={<ImagePlus className="size-4" />} onClick={() => fileRef.current?.click()}>
            {image ? 'Cambiar imagen' : 'Agregar imagen'}
          </Button>
          {image && (
            <>
              <img src={image} alt="" className="h-12 rounded" />
              <button className="text-xs text-bad" onClick={() => setImage(undefined)}>
                Quitar
              </button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 3 * 1024 * 1024) return toast.error('La imagen supera 3 MB.');
              setImage(await fileToDataUrl(f));
            }}
          />
        </div>
      </div>
    </Modal>
  );
}

function Study({ cards, onExit, subjectId }: { cards: Card[]; onExit: () => void; subjectId?: string }) {
  const queue = useMemo(() => cards.slice().sort((a, b) => a.due - b.due), [cards]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ good: 0, again: 0 });
  const shownAt = useRef(performance.now());
  const card = queue[i];
  useEffect(() => {
    shownAt.current = performance.now();
    setFlipped(false);
  }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setFlipped(true);
      }
      if (flipped) {
        const b = GRADE_BUTTONS.find((g) => g.key === e.key);
        if (b) grade(b.q);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!card)
    return (
      <Panel className="p-8 text-center">
        <h2 className="font-display font-semibold text-xl">¡Sesión terminada!</h2>
        <p className="text-sm text-muted mt-1">
          Recordaste {stats.good} y repasarás {stats.again} de nuevo pronto.
        </p>
        <Button className="mt-4" variant="primary" onClick={onExit}>
          Volver al mazo
        </Button>
      </Panel>
    );
  async function grade(q: number) {
    const now = Date.now();
    const next = review(card, q, now);
    const elapsed = card.lastReview ? (now - card.lastReview) / 86_400_000 : 0;
    await db.cards.update(card.id, { ...next, updatedAt: now });
    await db.reviews.add({ id: newId(), cardId: card.id, deckId: card.deckId, grade: q, reviewedAt: now, intervalBefore: card.interval, intervalAfter: next.interval, elapsedDays: Math.round(elapsed * 10) / 10, durationMs: Math.min(120_000, Math.round(performance.now() - shownAt.current)) });
    if (card.concept) await recordMastery([{ subjectId, concept: card.concept, correct: q >= 4 ? 1 : q === 3 ? 0.6 : 0 }], 'flashcard', card.id);
    setStats((s) => (q >= 3 ? { ...s, good: s.good + 1 } : { ...s, again: s.again + 1 }));
    setI((x) => x + 1);
    if (i === queue.length - 1) await logActivity({ type: 'flashcards', title: `Repasaste ${queue.length} flashcards`, refId: card.deckId, route: `/flashcards/${card.deckId}`, subjectId });
  }
  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center justify-between text-xs text-muted mb-2">
        <span>
          {i + 1} / {queue.length}
        </span>
        <button onClick={onExit} className="text-[#8ea2ff]">
          Terminar
        </button>
      </div>
      <ProgressBar value={i / queue.length} className="mb-4" />
      <button onClick={() => setFlipped((f) => !f)} className="w-full [perspective:1200px]" aria-label={flipped ? 'Ver frente' : 'Ver respuesta'}>
        <motion.div animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: 0.45 }} className="relative h-72 [transform-style:preserve-3d]">
          <div className="absolute inset-0 rounded-3xl bg-[#f4f6ff] text-[#1a2140] p-6 grid place-items-center [backface-visibility:hidden] shadow-2xl">
            <div className="text-center">
              {card.image && <img src={card.image} alt="" className="max-h-28 mx-auto mb-3 rounded" />}
              <Markdown className="!text-[#1a2140] !text-lg">{card.front}</Markdown>
            </div>
            <span className="absolute bottom-3 text-[11px] text-[#5b6690]">Tocá para ver la respuesta (espacio)</span>
          </div>
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#2a2f7a] to-[#3b2fa8] p-6 grid place-items-center [backface-visibility:hidden] [transform:rotateY(180deg)] shadow-2xl">
            <Markdown className="!text-lg text-center">{card.back}</Markdown>
            {card.sourcePage && <span className="absolute bottom-3 text-[11px] text-[#c9d0ff]">Material p. {card.sourcePage}</span>}
          </div>
        </motion.div>
      </button>
      <div className="flex justify-center mt-3">
        <IconButton label="Escuchar" onClick={() => speak(flipped ? card.back : card.front)}>
          <Volume2 className="size-4" />
        </IconButton>
      </div>
      <AnimatePresence>
        {flipped && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-4 gap-2 mt-3">
            {GRADE_BUTTONS.map((g) => (
              <button key={g.q} onClick={() => grade(g.q)} className={`rounded-xl border py-2.5 text-sm ${g.q === 1 ? 'border-bad/40 bg-bad/10' : g.q === 3 ? 'border-warn/40 bg-warn/10' : g.q === 4 ? 'border-primary/40 bg-primary/10' : 'border-ok/40 bg-ok/10'}`}>
                <div className="font-medium">{g.label}</div>
                <div className="text-[11px] text-muted">{previewInterval(card, g.q)} d</div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function DeckPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const deck = useLiveQuery(() => db.decks.get(id!), [id]);
  const cards = useLiveQuery(() => db.cards.where('deckId').equals(id!).toArray(), [id]) ?? [];
  const reviews = useLiveQuery(() => db.reviews.where('deckId').equals(id!).toArray(), [id]) ?? [];
  const [tab, setTab] = useState<'overview' | 'cards'>(params.get('edit') ? 'cards' : 'overview');
  const [studying, setStudying] = useState<Card[] | null>(null);
  const [editing, setEditing] = useState<Card | 'new' | null>(params.get('edit') ? 'new' : null);
  const now = Date.now();
  if (deck === undefined) return null;
  if (!deck) return <EmptyState icon={<Layers className="size-6" />} title="Mazo no encontrado" text="Puede que se haya eliminado." />;
  const due = cards.filter((c) => c.due <= now);
  const reviewed = cards.filter((c) => c.lastReview);
  const retention = reviewed.length ? reviewed.reduce((s, c) => s + estimatedRetention(c, now), 0) / reviewed.length : null;
  const recall = reviews.length ? reviews.filter((r) => r.grade >= 3).length / reviews.length : null;
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(startOfDay(now), i);
    return { d, n: cards.filter((c) => c.due >= d && c.due < addDays(d, 1)).length + (i === 0 ? cards.filter((c) => c.due < d).length : 0) };
  });
  if (studying) return <Study cards={studying} subjectId={deck.subjectId} onExit={() => setStudying(null)} />;
  return (
    <div>
      <PageHeader
        title={deck.name}
        subtitle={`${cards.length} tarjetas · creado ${fmtDate(deck.createdAt)}`}
        icon={<Layers className="size-5" />}
        actions={
          <>
            <Button variant="primary" icon={<Play className="size-4" />} disabled={!due.length} onClick={() => setStudying(due)}>
              Repasar {due.length ? `(${due.length})` : ''}
            </Button>
            <Button icon={<BookOpen className="size-4" />} disabled={!cards.length} onClick={() => setStudying(cards)}>
              Repasar todo
            </Button>
            <Button
              variant="ghost"
              icon={<Trash className="size-4" />}
              onClick={async () => {
                if (!confirm('¿Eliminar el mazo y sus tarjetas?')) return;
                await db.cards.where('deckId').equals(deck.id).delete();
                await db.reviews.where('deckId').equals(deck.id).delete();
                await db.decks.delete(deck.id);
                nav('/flashcards');
              }}
            >
              Eliminar
            </Button>
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Resumen' }, { value: 'cards', label: 'Tarjetas', count: cards.length }]} />
      {tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Para repasar hoy" value={due.length} />
            <Stat label="Retención estimada" value={retention === null ? '—' : `${Math.round(retention * 100)}%`} hint="Modelo de olvido sobre tu historial" />
            <Stat label="Tasa real de aciertos" value={recall === null ? '—' : `${Math.round(recall * 100)}%`} hint={`${reviews.length} repasos registrados`} />
            <Stat label="Tarjetas nuevas" value={cards.filter((c) => !c.lastReview).length} />
          </div>
          <Panel className="p-4">
            <h3 className="font-display font-semibold text-sm mb-3">Próximos 7 días</h3>
            <div className="grid grid-cols-7 gap-2 items-end h-28">
              {upcoming.map((u) => (
                <div key={u.d} className="flex flex-col items-center gap-1 h-full justify-end">
                  <span className="text-[10px] text-muted">{u.n}</span>
                  <div className="w-full rounded-t bg-gradient-to-t from-primary to-violet" style={{ height: `${Math.max(2, (u.n / Math.max(1, ...upcoming.map((x) => x.n))) * 80)}%` }} />
                  <span className="text-[10px] text-faint">{fmtDate(u.d, { weekday: 'short' })}</span>
                </div>
              ))}
            </div>
          </Panel>
          <p className="text-[11px] text-faint">La retención estimada asume que cada intervalo se eligió para recordar ~90% al vencer y un olvido exponencial; la tasa real de aciertos sale de tus calificaciones. Detalle del algoritmo en docs/SRS.md.</p>
        </div>
      ) : (
        <div>
          <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} className="mb-3">
            Agregar tarjeta
          </Button>
          <div className="grid gap-2">
            {cards.map((c) => (
              <Panel key={c.id} className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-2 text-sm">
                  <div className="line-clamp-3">{c.front}</div>
                  <div className="line-clamp-3 text-muted">{c.back}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge>{c.lastReview ? `cada ${c.interval} d` : 'nueva'}</Badge>
                  <div className="flex">
                    <IconButton label="Editar" onClick={() => setEditing(c)}>
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton label="Eliminar" onClick={() => db.cards.delete(c.id)}>
                      <Trash className="size-3.5" />
                    </IconButton>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        </div>
      )}
      {editing && <CardEditor card={editing === 'new' ? undefined : editing} deckId={deck.id} onClose={() => setEditing(null)} />}
    </div>
  );
}
