import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Plus } from 'lucide-react';
import { db } from '@/lib/db';
import { subjectProgress } from '@/lib/stats';
import { SubjectGlyph, subjectStyle } from '@/lib/subjects';
import { Button, EmptyState, PageHeader } from '@/components/ui';
import { NewSubjectDialog } from './NewSubjectDialog';

export default function SubjectsPage() {
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const counts = useLiveQuery(async () => {
    const [docs, tasks, exams, decks] = await Promise.all([db.documents.toArray(), db.tasks.toArray(), db.exams.toArray(), db.decks.toArray()]);
    const m = new Map<string, { docs: number; tasks: number; exams: number; decks: number }>();
    const inc = (id: string | undefined, k: 'docs' | 'tasks' | 'exams' | 'decks') => {
      if (!id) return;
      const c = m.get(id) ?? { docs: 0, tasks: 0, exams: 0, decks: 0 };
      c[k]++;
      m.set(id, c);
    };
    docs.forEach((d) => inc(d.subjectId, 'docs'));
    tasks.forEach((d) => inc(d.subjectId, 'tasks'));
    exams.forEach((d) => inc(d.subjectId, 'exams'));
    decks.forEach((d) => inc(d.subjectId, 'decks'));
    return m;
  }, []);
  const [progress, setProgress] = useState<Map<string, { score: number; concepts: number }>>(new Map());
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<string>('all');
  useEffect(() => {
    subjectProgress().then(setProgress);
  }, [subjects.length]);
  const cats = useMemo(() => [...new Set(subjects.map((s) => s.category).filter(Boolean))], [subjects]);
  const shown = cat === 'all' ? subjects : subjects.filter((s) => s.category === cat);
  return (
    <div>
      <PageHeader
        title="Materias"
        subtitle="Organizá apuntes, archivos, clases, ejercicios, evaluaciones y flashcards por materia."
        icon={<BookOpen className="size-5" />}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Nueva materia
          </Button>
        }
      />
      {cats.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {['all', ...cats].map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`h-8 px-3 rounded-full border text-xs ${cat === c ? 'nav-active text-white' : 'border-line text-muted'}`}>
              {c === 'all' ? 'Todas' : c}
            </button>
          ))}
        </div>
      )}
      {subjects.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-6" />} title="Todavía no tenés materias" text="Creá tu primera materia para organizar tu material de estudio." action={<Button variant="primary" onClick={() => setOpen(true)}>Crear materia</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {shown.map((s) => {
            const st = subjectStyle(s.color);
            const p = progress.get(s.id);
            const c = counts?.get(s.id);
            return (
              <Link key={s.id} to={`/subjects/${s.id}`} className="rounded-2xl p-4 text-white transition hover:brightness-110 flex flex-col gap-3 min-h-[150px]" style={{ background: st.bg, border: `1px solid ${st.border}` }}>
                <div className="flex items-start justify-between">
                  <SubjectGlyph icon={s.icon} className="size-8" />
                  {s.category && <span className="text-[11px] rounded-full bg-black/20 px-2 py-0.5" style={{ color: st.soft }}>{s.category}</span>}
                </div>
                <div className="font-display font-semibold text-lg">{s.name}</div>
                <div className="text-xs flex gap-3" style={{ color: st.soft }}>
                  <span>{c?.docs ?? 0} archivos</span>
                  <span>{c?.tasks ?? 0} tareas</span>
                  <span>{c?.exams ?? 0} exámenes</span>
                </div>
                <div className="mt-auto">
                  <div className="flex justify-between text-[11px] mb-1" style={{ color: st.soft }}>
                    <span>Dominio</span>
                    <span>{p ? `${Math.round(p.score * 100)}% · ${p.concepts} conceptos` : 'Sin datos todavía'}</span>
                  </div>
                  <div className="h-1.5 rounded bg-white/20">
                    <div className="h-1.5 rounded" style={{ width: `${p ? p.score * 100 : 0}%`, background: st.bar }} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <NewSubjectDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
