import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, ClipboardList, FileText, Folder, FolderPlus, GraduationCap, Layers, Pencil, Plus, StickyNote, Trash, Upload } from 'lucide-react';
import { db, type Note } from '@/lib/db';
import { newId } from '@/lib/ids';
import { SubjectGlyph, subjectStyle } from '@/lib/subjects';
import { MASTERY_LABEL, masteryLevel } from '@/lib/mastery';
import { fmtDate, fmtDateTime, timeAgo } from '@/lib/format';
import { Badge, Button, EmptyState, IconButton, Input, Modal, Panel, ProgressBar, Tabs, Textarea, cx } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { ImportDialog } from '@/features/library/ImportDialog';
import { NewSubjectDialog } from './NewSubjectDialog';
import { toast } from '@/stores/toast';

type Tab = 'files' | 'notes' | 'classes' | 'tasks' | 'exams' | 'cards' | 'progress' | 'calendar';

function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(true);
  // Guardado automático a los 600 ms de dejar de escribir
  useEffect(() => {
    if (title === note.title && content === note.content) return;
    setSaved(false);
    const t = setTimeout(async () => {
      await db.notes.update(note.id, { title: title.trim() || 'Sin título', content, updatedAt: Date.now() });
      setSaved(true);
    }, 600);
    return () => clearTimeout(t);
  }, [title, content, note]);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Apunte"
      footer={
        <>
          <span className="mr-auto text-xs text-muted self-center">{saved ? 'Guardado' : 'Guardando…'}</span>
          <Button variant="ghost" onClick={() => setPreview((v) => !v)}>
            {preview ? 'Editar' : 'Vista previa'}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Listo
          </Button>
        </>
      }
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mb-3 font-display text-base" aria-label="Título" />
      {preview ? <Markdown>{content || '_Vacío_'}</Markdown> : <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[50dvh] font-mono text-[13px]" placeholder="Escribí en Markdown. Fórmulas con $E = mc^2$." />}
    </Modal>
  );
}

export default function SubjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const subject = useLiveQuery(() => db.subjects.get(id!), [id]);
  const [tab, setTab] = useState<Tab>('files');
  const [folder, setFolder] = useState<string>('all');
  const [importOpen, setImportOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const folders = useLiveQuery(() => db.folders.where('subjectId').equals(id!).toArray(), [id]) ?? [];
  const docs = useLiveQuery(() => db.documents.where('subjectId').equals(id!).reverse().sortBy('createdAt'), [id]) ?? [];
  const notes = useLiveQuery(() => db.notes.where('subjectId').equals(id!).reverse().sortBy('updatedAt'), [id]) ?? [];
  const sessions = useLiveQuery(() => db.tutorSessions.where('subjectId').equals(id!).reverse().sortBy('updatedAt'), [id]) ?? [];
  const tasks = useLiveQuery(() => db.tasks.where('subjectId').equals(id!).reverse().sortBy('createdAt'), [id]) ?? [];
  const exams = useLiveQuery(() => db.exams.where('subjectId').equals(id!).reverse().sortBy('createdAt'), [id]) ?? [];
  const decks = useLiveQuery(() => db.decks.where('subjectId').equals(id!).toArray(), [id]) ?? [];
  const mastery = useLiveQuery(() => db.mastery.where('subjectId').equals(id!).toArray(), [id]) ?? [];
  const events = useLiveQuery(() => db.events.where('subjectId').equals(id!).sortBy('start'), [id]) ?? [];
  const note = notes.find((n) => n.id === noteId);

  if (subject === undefined) return null;
  if (!subject) return <EmptyState icon={<FileText className="size-6" />} title="Materia no encontrada" text="Puede que se haya eliminado." action={<Button onClick={() => nav('/subjects')}>Volver</Button>} />;
  const st = subjectStyle(subject.color);
  const inFolder = <T extends { folderId?: string }>(x: T[]) => (folder === 'all' ? x : x.filter((i) => (folder === 'none' ? !i.folderId : i.folderId === folder)));

  const remove = async () => {
    if (!confirm(`¿Eliminar la materia «${subject.name}»? Sus documentos, tareas y exámenes se conservan sin materia.`)) return;
    await db.transaction('rw', [db.subjects, db.documents, db.tasks, db.exams, db.decks, db.notes, db.folders, db.events, db.tutorSessions], async () => {
      await db.documents.where('subjectId').equals(subject.id).modify({ subjectId: undefined, folderId: undefined });
      await db.tasks.where('subjectId').equals(subject.id).modify({ subjectId: undefined });
      await db.exams.where('subjectId').equals(subject.id).modify({ subjectId: undefined });
      await db.decks.where('subjectId').equals(subject.id).modify({ subjectId: undefined });
      await db.notes.where('subjectId').equals(subject.id).modify({ subjectId: undefined, folderId: undefined });
      await db.events.where('subjectId').equals(subject.id).modify({ subjectId: undefined });
      await db.tutorSessions.where('subjectId').equals(subject.id).modify({ subjectId: undefined });
      await db.folders.where('subjectId').equals(subject.id).delete();
      await db.subjects.delete(subject.id);
    });
    toast.ok('Materia eliminada');
    nav('/subjects');
  };

  const addNote = async () => {
    const n: Note = { id: newId(), subjectId: subject.id, folderId: folder !== 'all' && folder !== 'none' ? folder : undefined, title: 'Nuevo apunte', content: '', createdAt: Date.now(), updatedAt: Date.now() };
    await db.notes.add(n);
    setNoteId(n.id);
  };

  const avg = mastery.filter((m) => m.attempts).reduce((s, m, _, a) => s + m.score / a.length, 0);

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl p-5 mb-5 text-white" style={{ background: st.bg, border: `1px solid ${st.border}` }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-4">
            <SubjectGlyph icon={subject.icon} className="size-10" />
            <div>
              <h1 className="font-display font-bold text-2xl">{subject.name}</h1>
              <p className="text-sm" style={{ color: st.soft }}>
                {subject.category || 'Sin categoría'} · {docs.length} archivos · {tasks.length} tareas · {exams.length} exámenes
              </p>
            </div>
          </div>
          <div className="flex gap-1">
            <IconButton label="Editar materia" onClick={() => setEdit(true)} className="text-white/80 hover:text-white">
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Eliminar materia" onClick={remove} className="text-white/80 hover:text-white">
              <Trash className="size-4" />
            </IconButton>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" className="bg-white/15 text-white border-white/20" icon={<Upload className="size-3.5" />} onClick={() => setImportOpen(true)}>
            Subir material
          </Button>
          <Button size="sm" className="bg-white/15 text-white border-white/20" icon={<GraduationCap className="size-3.5" />} onClick={() => nav(`/tutor?subject=${subject.id}`)}>
            Clase con el profesor
          </Button>
          <Button size="sm" className="bg-white/15 text-white border-white/20" icon={<ClipboardList className="size-3.5" />} onClick={() => nav(`/tasks?new=1&subject=${subject.id}`)}>
            Crear tarea
          </Button>
          <Button size="sm" className="bg-white/15 text-white border-white/20" icon={<FileText className="size-3.5" />} onClick={() => nav(`/exams?new=1&subject=${subject.id}`)}>
            Crear examen
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'files', label: 'Archivos', count: docs.length },
          { value: 'notes', label: 'Apuntes', count: notes.length },
          { value: 'classes', label: 'Clases', count: sessions.length },
          { value: 'tasks', label: 'Ejercicios', count: tasks.length },
          { value: 'exams', label: 'Evaluaciones', count: exams.length },
          { value: 'cards', label: 'Flashcards', count: decks.length },
          { value: 'progress', label: 'Progreso' },
          { value: 'calendar', label: 'Calendario', count: events.length },
        ]}
      />

      {(tab === 'files' || tab === 'notes') && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {[{ id: 'all', name: 'Todo' }, ...folders, { id: 'none', name: 'Sin carpeta' }].map((f) => (
            <button key={f.id} onClick={() => setFolder(f.id)} className={cx('inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs', folder === f.id ? 'nav-active text-white' : 'border-line text-muted')}>
              {f.id !== 'all' && f.id !== 'none' && <Folder className="size-3.5" />}
              {f.name}
            </button>
          ))}
          <button onClick={() => setNewFolder('')} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-dashed border-line-strong text-xs text-muted hover:text-ink">
            <FolderPlus className="size-3.5" /> Carpeta
          </button>
          {folder !== 'all' && folder !== 'none' && (
            <button
              className="text-xs text-bad ml-1"
              onClick={async () => {
                await db.documents.where('folderId').equals(folder).modify({ folderId: undefined });
                await db.notes.where('folderId').equals(folder).modify({ folderId: undefined });
                await db.folders.delete(folder);
                setFolder('all');
              }}
            >
              Eliminar carpeta
            </button>
          )}
        </div>
      )}

      {tab === 'files' &&
        (docs.length === 0 ? (
          <EmptyState icon={<Upload className="size-6" />} title="Sin archivos" text="Subí PDF, Word, PowerPoint, fotos o texto." action={<Button variant="primary" onClick={() => setImportOpen(true)}>Subir material</Button>} />
        ) : (
          <div className="grid gap-2">
            {inFolder(docs).map((d) => (
              <Panel key={d.id} className="flex items-center gap-3 p-3">
                <FileText className="size-5 text-[#8ea2ff] shrink-0" />
                <Link to={`/library/${d.id}`} className="flex-1 min-w-0">
                  <div className="text-sm truncate">{d.title}</div>
                  <div className="text-xs text-muted">
                    {d.pageCount} {d.unitLabel.toLowerCase()}s · {timeAgo(d.createdAt)} {d.status !== 'ready' && <Badge tone={d.status === 'error' ? 'bad' : 'warn'}>{d.status === 'processing' ? 'Procesando' : d.status === 'error' ? 'Error' : 'Con avisos'}</Badge>}
                  </div>
                </Link>
                {folders.length > 0 && (
                  <select aria-label="Carpeta" value={d.folderId ?? ''} onChange={(e) => db.documents.update(d.id, { folderId: e.target.value || undefined })} className="h-8 rounded-lg bg-[#0d1322] border border-line text-xs px-2">
                    <option value="">Sin carpeta</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                )}
              </Panel>
            ))}
          </div>
        ))}

      {tab === 'notes' && (
        <div>
          <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={addNote} className="mb-3">
            Nuevo apunte
          </Button>
          {inFolder(notes).length === 0 ? (
            <EmptyState icon={<StickyNote className="size-6" />} title="Sin apuntes" text="Escribí apuntes propios en Markdown, con fórmulas." />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {inFolder(notes).map((n) => (
                <button key={n.id} onClick={() => setNoteId(n.id)} className="panel p-4 text-left hover:border-line-strong">
                  <div className="font-medium truncate">{n.title}</div>
                  <div className="text-xs text-muted mt-1 line-clamp-3 whitespace-pre-line">{n.content.slice(0, 220) || 'Vacío'}</div>
                  <div className="text-[11px] text-faint mt-2">Editado {timeAgo(n.updatedAt)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'classes' &&
        (sessions.length === 0 ? (
          <EmptyState icon={<GraduationCap className="size-6" />} title="Sin clases todavía" text="Empezá una clase con el profesor virtual sobre esta materia." action={<Button variant="primary" onClick={() => nav(`/tutor?subject=${subject.id}`)}>Nueva clase</Button>} />
        ) : (
          <div className="grid gap-2">
            {sessions.map((s) => (
              <Link key={s.id} to={`/tutor/${s.id}`} className="panel p-3 flex justify-between gap-3 hover:border-line-strong">
                <span className="truncate">{s.title}</span>
                <span className="text-xs text-muted shrink-0">{timeAgo(s.updatedAt)}</span>
              </Link>
            ))}
          </div>
        ))}

      {tab === 'tasks' &&
        (tasks.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-6" />} title="Sin ejercicios" text="Generá tareas personalizadas con IA para esta materia." action={<Button variant="primary" onClick={() => nav(`/tasks?new=1&subject=${subject.id}`)}>Crear tarea</Button>} />
        ) : (
          <div className="grid gap-2">
            {tasks.map((t) => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="panel p-3 flex items-center justify-between gap-3 hover:border-line-strong">
                <span className="min-w-0">
                  <span className="block truncate">{t.title}</span>
                  <span className="text-xs text-muted">{t.items.length} ejercicios · {fmtDate(t.createdAt)}</span>
                </span>
                {t.lastScore !== undefined && <Badge tone={t.lastScore >= 0.6 ? 'ok' : 'warn'}>{Math.round(t.lastScore * 100)}%</Badge>}
              </Link>
            ))}
          </div>
        ))}

      {tab === 'exams' &&
        (exams.length === 0 ? (
          <EmptyState icon={<FileText className="size-6" />} title="Sin evaluaciones" text="Creá exámenes de práctica o simulacros." action={<Button variant="primary" onClick={() => nav(`/exams?new=1&subject=${subject.id}`)}>Crear examen</Button>} />
        ) : (
          <div className="grid gap-2">
            {exams.map((e) => (
              <Link key={e.id} to={`/exams/${e.id}`} className="panel p-3 flex justify-between gap-3 hover:border-line-strong">
                <span className="truncate">{e.title}</span>
                <span className="text-xs text-muted shrink-0">{e.items.length} preguntas</span>
              </Link>
            ))}
          </div>
        ))}

      {tab === 'cards' &&
        (decks.length === 0 ? (
          <EmptyState icon={<Layers className="size-6" />} title="Sin mazos" text="Creá flashcards a mano o generalas desde tus documentos." action={<Button variant="primary" onClick={() => nav(`/flashcards?new=1&subject=${subject.id}`)}>Crear mazo</Button>} />
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {decks.map((d) => (
              <Link key={d.id} to={`/flashcards/${d.id}`} className="panel p-3 hover:border-line-strong">
                {d.name}
              </Link>
            ))}
          </div>
        ))}

      {tab === 'progress' && (
        <div>
          {mastery.filter((m) => m.attempts).length === 0 ? (
            <EmptyState icon={<GraduationCap className="size-6" />} title="Todavía no hay datos" text="El progreso se calcula con tus respuestas reales en tareas, exámenes y flashcards de esta materia." />
          ) : (
            <>
              <Panel className="p-4 mb-3">
                <div className="flex justify-between text-sm mb-2">
                  <span>Dominio promedio</span>
                  <span className="font-mono">{Math.round(avg * 100)}%</span>
                </div>
                <ProgressBar value={avg} />
              </Panel>
              <div className="grid gap-2">
                {mastery
                  .filter((m) => m.attempts)
                  .sort((a, b) => a.score - b.score)
                  .map((m) => {
                    const lv = masteryLevel(m);
                    return (
                      <Panel key={m.id} className="p-3">
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <span className="text-sm truncate">{m.concept}</span>
                          <Badge tone={lv === 'mastered' ? 'ok' : lv === 'weak' ? 'bad' : 'warn'}>{MASTERY_LABEL[lv]}</Badge>
                        </div>
                        <ProgressBar value={m.score} tone={lv === 'mastered' ? 'ok' : lv === 'weak' ? 'bad' : 'warn'} />
                        <div className="text-[11px] text-faint mt-1">
                          {m.attempts} intentos · último {timeAgo(m.lastSeen)}
                        </div>
                      </Panel>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'calendar' &&
        (events.length === 0 ? (
          <EmptyState icon={<CalendarDays className="size-6" />} title="Sin fechas" text="Registrá exámenes o armá un plan de estudio desde el calendario." action={<Button variant="primary" onClick={() => nav('/calendar')}>Ir al calendario</Button>} />
        ) : (
          <div className="grid gap-2">
            {events.map((e) => (
              <Panel key={e.id} className="p-3 flex justify-between gap-3">
                <span className={cx('truncate', e.done && 'line-through text-muted')}>{e.title}</span>
                <span className="text-xs text-muted shrink-0">{fmtDateTime(e.start)}</span>
              </Panel>
            ))}
          </div>
        ))}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} subjectId={subject.id} />
      <NewSubjectDialog open={edit} onClose={() => setEdit(false)} edit={subject} />
      {note && <NoteEditor key={note.id} note={note} onClose={() => setNoteId(null)} />}
      <Modal
        open={newFolder !== null}
        onClose={() => setNewFolder(null)}
        title="Nueva carpeta"
        footer={
          <Button
            variant="primary"
            disabled={!newFolder?.trim()}
            onClick={async () => {
              await db.folders.add({ id: newId(), subjectId: subject.id, name: newFolder!.trim(), createdAt: Date.now() });
              setNewFolder(null);
            }}
          >
            Crear
          </Button>
        }
      >
        <Input autoFocus value={newFolder ?? ''} onChange={(e) => setNewFolder(e.target.value)} placeholder="Ej.: Unidad 2 — Termodinámica" />
      </Modal>
    </div>
  );
}
