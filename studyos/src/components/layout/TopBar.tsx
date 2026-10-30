import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, BookOpen, ChevronDown, ClipboardList, FileText, Layers, Search, Sparkles, X } from 'lucide-react';
import { db } from '@/lib/db';
import { normalizeText } from '@/lib/items';
import { addDays, relativeDay, startOfDay } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { Brand } from './Brand';
import { cx } from '../ui';

interface Hit {
  kind: 'subject' | 'doc' | 'task' | 'exam' | 'deck' | 'page';
  title: string;
  sub: string;
  to: string;
}

function useSearch(q: string): Hit[] {
  return (
    useLiveQuery(async () => {
      const nq = normalizeText(q);
      if (nq.length < 2) return [];
      const m = (s: string) => normalizeText(s).includes(nq);
      const [subjects, docs, tasks, exams, decks] = await Promise.all([db.subjects.toArray(), db.documents.toArray(), db.tasks.toArray(), db.exams.toArray(), db.decks.toArray()]);
      const hits: Hit[] = [
        ...subjects.filter((s) => m(s.name)).map((s) => ({ kind: 'subject' as const, title: s.name, sub: 'Materia', to: `/subjects/${s.id}` })),
        ...docs.filter((d) => m(d.title) || m(d.fileName)).map((d) => ({ kind: 'doc' as const, title: d.title, sub: `Documento · ${d.pageCount} ${d.unitLabel.toLowerCase()}s`, to: `/library/${d.id}` })),
        ...tasks.filter((t) => m(t.title) || m(t.topic)).map((t) => ({ kind: 'task' as const, title: t.title, sub: 'Tarea', to: `/tasks/${t.id}` })),
        ...exams.filter((e) => m(e.title) || m(e.topic)).map((e) => ({ kind: 'exam' as const, title: e.title, sub: 'Examen', to: `/exams/${e.id}` })),
        ...decks.filter((d) => m(d.name)).map((d) => ({ kind: 'deck' as const, title: d.name, sub: 'Mazo de flashcards', to: `/flashcards/${d.id}` })),
      ];
      // Búsqueda en el texto de los apuntes (primeras coincidencias)
      if (nq.length >= 3) {
        const pages = await db.pages.filter((p) => normalizeText(p.text).includes(nq)).limit(6).toArray();
        const titles = new Map(docs.map((d) => [d.id, d]));
        for (const p of pages) {
          const d = titles.get(p.docId);
          if (!d) continue;
          const idx = normalizeText(p.text).indexOf(nq);
          hits.push({ kind: 'page', title: `${d.title} · ${d.unitLabel} ${p.index}`, sub: `…${p.text.slice(Math.max(0, idx - 30), idx + 60).replace(/\s+/g, ' ')}…`, to: `/library/${d.id}?page=${p.index}` });
        }
      }
      return hits.slice(0, 14);
    }, [q]) ?? []
  );
}

const HIT_ICON = { subject: BookOpen, doc: FileText, task: ClipboardList, exam: FileText, deck: Layers, page: FileText };

function SearchResults({ q, hits, go }: { q: string; hits: Hit[]; go: (to: string) => void }) {
  return (
    <>
      {hits.map((h, i) => {
        const I = HIT_ICON[h.kind];
        return (
          <button key={i} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h.to)} className="w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5 active:bg-white/5">
            <I className="size-4 mt-0.5 text-[#8ea2ff] shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm truncate">{h.title}</span>
              <span className="block text-[11px] text-muted truncate">{h.sub}</span>
            </span>
          </button>
        );
      })}
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/tutor?q=${encodeURIComponent(q.trim())}`)} className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/5 border-t border-line mt-1">
        <Sparkles className="size-4 text-violet shrink-0" />
        <span className="text-sm">
          Preguntar al profesor: <span className="text-[#b9c6ff]">“{q.trim()}”</span>
        </span>
      </button>
    </>
  );
}

/** Búsqueda a pantalla completa para celulares. */
function MobileSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const hits = useSearch(q);
  const go = (to: string) => {
    onClose();
    nav(to);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <motion.div role="dialog" aria-label="Buscar" className="fixed inset-0 z-50 bg-[#060913]/97 backdrop-blur-md pt-[var(--safe-top)] flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <form
        className="flex items-center gap-2 px-3.5 pt-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(hits[0]?.to ?? `/tutor?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <label className="flex-1 flex items-center gap-2.5 h-12 pl-3.5 pr-2 rounded-2xl bg-[#0d1430] border border-primary/50">
          <Search className="size-[18px] text-[#9aa6cc] shrink-0" />
          <span className="sr-only">Buscar</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" placeholder="Materias, apuntes, tareas…" className="flex-1 min-w-0 bg-transparent outline-none text-base placeholder:text-[#7f8db0]" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Limpiar búsqueda" className="grid place-items-center size-9 text-faint">
              <X className="size-4" />
            </button>
          )}
        </label>
        <button type="button" onClick={onClose} className="h-12 px-2 text-sm text-[#b9c6ff]">
          Cancelar
        </button>
      </form>
      <div className="flex-1 overflow-y-auto px-2 pb-[calc(1rem+var(--safe-bottom))]">
        {q.trim().length >= 2 ? (
          <SearchResults q={q} hits={hits} go={go} />
        ) : (
          <p className="px-4 py-6 text-sm text-muted leading-relaxed">Buscá en tus materias, documentos, tareas, exámenes, mazos y en el texto de tus apuntes. Si no hay coincidencias, podés preguntarle al profesor.</p>
        )}
      </div>
    </motion.div>
  );
}

function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const hits = useSearch(q);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    ref.current?.blur();
    nav(to);
  };
  return (
    <div className="relative flex-1 max-w-[534px] min-w-0">
      <label className="flex items-center gap-2.5 h-[38px] pl-3.5 pr-2 rounded-[10px] bg-[#0d1430] border border-line-strong/70 focus-within:border-primary/70">
        <Search className="size-[17px] text-[#9aa6cc] shrink-0" />
        <span className="sr-only">Buscar</span>
        <input
          ref={ref}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) go(hits[0]?.to ?? `/tutor?q=${encodeURIComponent(q.trim())}`);
            if (e.key === 'Escape') ref.current?.blur();
          }}
          placeholder="Buscar en tus materias, apuntes o preguntar a la IA..."
          className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] placeholder:text-[#7f8db0]"
        />
        {q ? (
          <button onClick={() => setQ('')} aria-label="Limpiar búsqueda" className="text-faint hover:text-ink p-1">
            <X className="size-4" />
          </button>
        ) : (
          <kbd className="hidden sm:inline text-[11px] text-[#b0bbdc] border border-[#a0afe6]/30 rounded-md px-1.5 py-0.5 font-sans">Ctrl + K</kbd>
        )}
      </label>
      <AnimatePresence>
        {open && q.trim().length >= 2 && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute z-50 left-0 right-0 mt-2 glass rounded-2xl p-1.5 shadow-2xl max-h-[60dvh] overflow-y-auto">
            <SearchResults q={q} hits={hits} go={go} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  // Cierre al tocar afuera (un overlay fixed quedaría confinado por el backdrop-filter del header)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const items =
    useLiveQuery(async () => {
      const now = Date.now();
      const soon = addDays(startOfDay(), 4);
      const [events, tasks, dueCards] = await Promise.all([
        db.events.where('start').between(now - 3600_000, soon).filter((e) => !e.done).toArray(),
        db.tasks.where('dueDate').between(startOfDay(), soon).filter((t) => t.status === 'pending' || t.status === 'in_progress').toArray(),
        db.cards.where('due').belowOrEqual(now).count(),
      ]);
      const out: { title: string; sub: string; to: string; at: number }[] = [
        ...events.map((e) => ({ title: e.title, sub: `${e.type === 'exam' ? 'Examen' : 'Sesión'} · ${relativeDay(e.start)}`, to: '/calendar', at: e.start })),
        ...tasks.map((t) => ({ title: t.title, sub: `Entrega ${relativeDay(t.dueDate!)}`, to: `/tasks/${t.id}`, at: t.dueDate! })),
      ].sort((a, b) => a.at - b.at);
      if (dueCards) out.unshift({ title: `${dueCards} flashcard${dueCards === 1 ? '' : 's'} para repasar`, sub: 'Repetición espaciada', to: '/flashcards', at: now });
      return out;
    }, []) ?? [];
  return (
    <div className="relative" ref={boxRef}>
      <button onClick={() => setOpen((v) => !v)} aria-label={`Notificaciones${items.length ? ` (${items.length})` : ''}`} className="relative grid place-items-center size-11 text-[#d7defa] hover:text-white">
        <Bell className="size-[22px]" strokeWidth={1.8} />
        {items.length > 0 && <span className="absolute top-2.5 right-[11px] size-2 rounded-full bg-[#ff4d5e] ring-2 ring-bg" />}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute z-50 right-0 mt-2 w-[min(340px,calc(100vw-24px))] glass rounded-2xl p-2 shadow-2xl">
              <div className="px-2 py-1.5 text-xs text-muted">Próximos días</div>
              {items.length === 0 && <div className="px-2 py-4 text-sm text-muted">No hay recordatorios pendientes.</div>}
              {items.slice(0, 8).map((it, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setOpen(false);
                    nav(it.to);
                  }}
                  className="w-full text-left rounded-xl px-2.5 py-2 hover:bg-white/5"
                >
                  <div className="text-sm">{it.title}</div>
                  <div className="text-[11px] text-muted">{it.sub}</div>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TopBar() {
  const name = useSettings((s) => s.s.profile.name);
  const level = useSettings((s) => s.s.profile.level);
  const nav = useNavigate();
  const [searching, setSearching] = useState(false);
  const initial = useMemo(() => (name.trim()[0] ?? 'E').toUpperCase(), [name]);
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-md border-b border-line/60 lg:border-0 lg:bg-transparent lg:backdrop-blur-0 lg:static pt-[var(--safe-top)]">
      <div className="flex items-center gap-2 sm:gap-3 h-14 lg:h-auto px-3.5 sm:px-4 lg:pl-4 lg:pr-3.5 lg:pt-3.5 lg:pb-1">
        <div className="lg:hidden shrink-0">
          <Brand compact />
        </div>
        <div className="hidden sm:flex flex-1 min-w-0">
          <SearchBox />
        </div>
        <div className="flex-1 sm:hidden" />
        <div className="flex items-center gap-0.5 sm:gap-4 shrink-0">
          <button onClick={() => setSearching(true)} aria-label="Buscar" className="sm:hidden grid place-items-center size-11 text-[#d7defa]">
            <Search className="size-[21px]" strokeWidth={1.8} />
          </button>
          <Notifications />
          <button onClick={() => nav('/settings')} className="flex items-center gap-3 min-h-11 pl-1" aria-label="Perfil y configuración">
            <span className="grid place-items-center size-9 sm:size-[38px] rounded-full bg-gradient-to-br from-primary to-violet font-display font-semibold text-sm text-white ring-2 ring-white/10">{initial}</span>
            <span className="hidden md:flex flex-col items-start leading-tight">
              <span className="text-[13px] font-medium">Hola, {name.trim() || 'estudiante'}</span>
              <span className="text-[11.5px] text-muted">{level || 'Estudiante'}</span>
            </span>
            <ChevronDown className={cx('hidden md:block size-4 text-[#c3cbea] ml-1')} />
          </button>
        </div>
      </div>
      {/* Portal: el header tiene backdrop-filter, que confina a los hijos position:fixed */}
      {createPortal(<AnimatePresence>{searching && <MobileSearch onClose={() => setSearching(false)} />}</AnimatePresence>, document.body)}
    </header>
  );
}
