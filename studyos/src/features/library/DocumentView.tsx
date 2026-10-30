import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Brain, ChevronLeft, ChevronRight, ClipboardList, Clapperboard, ExternalLink, FileText, GraduationCap, Layers, Network, Pencil, Sigma, Sparkles, Table, Image as ImageIcon, TriangleAlert } from 'lucide-react';
import { db, logActivity, type DocumentRec, type SummaryMode } from '@/lib/db';
import { newId } from '@/lib/ids';
import { fmtDate, timeAgo } from '@/lib/format';
import { subjectStyle } from '@/lib/subjects';
import { saveFile } from '@/lib/platform';
import { updatePageText } from '@/import';
import { renderPdfPage } from '@/import/pdf';
import { Badge, Button, EmptyState, Field, Input, Modal, Notice, PageHeader, Panel, Segmented, Select, Slider, Spinner, Tabs, Textarea } from '@/components/ui';
import { runJob } from '@/stores/jobs';
import { aiConfigured, useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { SUMMARY_MODES, summarizeDocument } from '@/ai/agents/summary';
import { analyzeConcepts } from '@/ai/agents/document';
import { buildStudyPack } from './studyPack';
import { StatusBadge } from './LibraryPage';

type Tab = 'original' | 'text' | 'structure' | 'summaries' | 'study';

function OriginalViewer({ doc, page, setPage }: { doc: DocumentRec; page: number; setPage: (n: number) => void }) {
  const file = useLiveQuery(() => db.docFiles.get(doc.id), [doc.id]);
  const pageRec = useLiveQuery(() => db.pages.get(`${doc.id}:${page}`), [doc.id, page]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  useEffect(() => {
    if (doc.kind !== 'pdf' || !file?.blob || !canvas.current) return;
    let alive = true;
    setBusy(true);
    setErr('');
    file.blob
      .arrayBuffer()
      .then((buf) => renderPdfPage(buf, page, canvas.current!, Math.min(900, (box.current?.clientWidth ?? 700) - 2)))
      .catch((e) => alive && setErr(`No se pudo mostrar la página: ${e.message}`))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [doc.kind, file, page]);
  useEffect(() => {
    if (doc.kind !== 'image' || !file?.blob) return;
    const u = URL.createObjectURL(file.blob);
    setImgUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [doc.kind, file]);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm text-muted">
            {doc.unitLabel} {page} de {doc.pageCount}
          </span>
          <Button size="sm" variant="ghost" disabled={page >= doc.pageCount} onClick={() => setPage(page + 1)} aria-label="Siguiente">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {file?.blob && (
          <Button size="sm" variant="outline" icon={<ExternalLink className="size-3.5" />} onClick={() => saveFile(file.blob, doc.fileName)}>
            Abrir/guardar original
          </Button>
        )}
      </div>
      <div ref={box} className="rounded-2xl border border-line bg-[#0a0f1f] p-2 overflow-auto grid place-items-center min-h-60">
        {doc.kind === 'pdf' ? (
          <>
            {busy && <Spinner className="my-10" />}
            {err && <p className="text-sm text-bad p-6">{err}</p>}
            <canvas ref={canvas} className="max-w-full rounded bg-white" style={{ display: busy || err ? 'none' : 'block' }} />
          </>
        ) : doc.kind === 'image' && imgUrl ? (
          <img src={imgUrl} alt={doc.title} className="max-w-full max-h-[75dvh] rounded" />
        ) : (
          <div className="w-full max-w-3xl p-4 text-sm whitespace-pre-wrap leading-relaxed text-[#dbe2f5]">
            <div className="text-xs text-muted mb-3">Vista del texto extraído ({doc.kind.toUpperCase()}). Para ver el formato original, abrí el archivo con otra app.</div>
            {pageRec?.text || <span className="text-muted">Sin texto en esta sección.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function TextTab({ doc }: { doc: DocumentRec }) {
  const pages = useLiveQuery(() => db.pages.where('[docId+index]').between([doc.id, -Infinity], [doc.id, Infinity]).toArray(), [doc.id]) ?? [];
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  return (
    <div className="space-y-3">
      {doc.warnings.length > 0 && (
        <Notice tone="warn" title="Avisos de la importación">
          <ul className="list-disc pl-4">
            {doc.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
      {pages.map((p) => (
        <Panel key={p.id} className="p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="font-medium text-ink">
                {doc.unitLabel} {p.index}
              </span>
              {p.ocr && <Badge tone={(p.ocrConfidence ?? 100) < 60 ? 'warn' : 'violet'}>OCR {p.ocrConfidence ? `${Math.round(p.ocrConfidence)}%` : ''}</Badge>}
              {!p.text.trim() && <Badge tone="bad">Sin texto</Badge>}
            </div>
            <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing({ index: p.index, text: p.text })}>
              Corregir
            </Button>
          </div>
          <p className="text-sm whitespace-pre-wrap leading-relaxed text-[#d4dbef] max-h-80 overflow-y-auto scroll-thin">{p.text || '—'}</p>
        </Panel>
      ))}
      <Modal
        open={!!editing}
        wide
        onClose={() => setEditing(null)}
        title={`Corregir ${doc.unitLabel.toLowerCase()} ${editing?.index}`}
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              await updatePageText(doc.id, editing!.index, editing!.text);
              setEditing(null);
              toast.ok('Texto actualizado');
            }}
          >
            Guardar
          </Button>
        }
      >
        <Textarea value={editing?.text ?? ''} onChange={(e) => setEditing((x) => x && { ...x, text: e.target.value })} className="min-h-[50dvh]" />
      </Modal>
    </div>
  );
}

function StructureTab({ doc, goPage }: { doc: DocumentRec; goPage: (n: number) => void }) {
  const s = useSettings((x) => x.s);
  const st = doc.structure;
  const analyze = () =>
    runJob(`Analizando conceptos de «${doc.title}»`, async ({ signal, progress }) => {
      progress(null, 'El Document Agent está leyendo el material');
      const concepts = await analyzeConcepts(doc.id, signal);
      await db.documents.update(doc.id, { structure: { ...doc.structure, aiConcepts: concepts } });
      return concepts;
    });
  const Section = ({ icon, title, children, count }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) => (
    <Panel className="p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="font-display font-semibold text-sm">{title}</h3>
        <span className="text-xs text-faint">{count}</span>
      </div>
      {count === 0 ? <p className="text-sm text-muted">No se detectaron.</p> : children}
    </Panel>
  );
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Section icon={<BookOpen className="size-4 text-[#8ea2ff]" />} title="Títulos y subtítulos" count={st.headings.length}>
        <ul className="space-y-1 max-h-80 overflow-y-auto scroll-thin">
          {st.headings.map((h, i) => (
            <li key={i} style={{ paddingLeft: (h.level - 1) * 14 }}>
              <button onClick={() => goPage(h.page)} className="text-left text-sm hover:text-[#b9c6ff]">
                {h.text} <span className="text-[11px] text-faint">· {doc.unitLabel.slice(0, 4).toLowerCase()}. {h.page}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section icon={<Brain className="size-4 text-violet" />} title="Conceptos importantes" count={(st.aiConcepts ?? st.keywords).length}>
        {st.aiConcepts ? (
          <ul className="space-y-2 max-h-80 overflow-y-auto scroll-thin">
            {st.aiConcepts.map((c, i) => (
              <li key={i} className="text-sm">
                <button onClick={() => c.page && goPage(c.page)} className="font-medium hover:text-[#b9c6ff]">
                  {c.name}
                </button>
                {c.page && <span className="text-[11px] text-faint"> · p. {c.page}</span>}
                {c.definition && <div className="text-xs text-muted">{c.definition}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {st.keywords.map((k) => (
              <Badge key={k}>{k}</Badge>
            ))}
          </div>
        )}
        <div className="mt-3">
          {!st.aiConcepts && <p className="text-[11px] text-faint mb-2">Palabras clave calculadas en el dispositivo por frecuencia.</p>}
          <Button size="sm" variant="outline" icon={<Sparkles className="size-3.5" />} onClick={analyze} disabled={!aiConfigured(s)}>
            {st.aiConcepts ? 'Volver a analizar con IA' : 'Identificar conceptos con IA'}
          </Button>
        </div>
      </Section>
      <Section icon={<Sigma className="size-4 text-cyan" />} title="Fórmulas detectadas" count={st.formulas.length}>
        <ul className="space-y-1 max-h-60 overflow-y-auto scroll-thin font-mono text-xs">
          {st.formulas.map((f, i) => (
            <li key={i}>
              <button onClick={() => goPage(f.page)} className="text-left hover:text-[#b9c6ff]">
                {f.text} <span className="text-faint">· p. {f.page}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section icon={<Table className="size-4 text-ok" />} title="Tablas e imágenes" count={st.tables.length + st.images.length}>
        <ul className="text-sm space-y-1">
          {st.tables.map((t, i) => (
            <li key={`t${i}`}>
              <button onClick={() => goPage(t.page)} className="hover:text-[#b9c6ff]">
                Tabla ({t.rows} filas) · {doc.unitLabel.toLowerCase()} {t.page}
              </button>
            </li>
          ))}
          {st.images.map((t, i) => (
            <li key={`i${i}`} className="flex items-center gap-1.5">
              <ImageIcon className="size-3.5 text-faint" />
              <button onClick={() => goPage(t.page)} className="hover:text-[#b9c6ff]">
                {t.count} imagen(es) · {doc.unitLabel.toLowerCase()} {t.page}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-faint mt-2">Las imágenes y diagramas se detectan y referencian; su contenido visual solo se interpreta con OCR por IA.</p>
      </Section>
    </div>
  );
}

function SummariesTab({ doc }: { doc: DocumentRec }) {
  const s = useSettings((x) => x.s);
  const nav = useNavigate();
  const summaries = useLiveQuery(() => db.summaries.where('docId').equals(doc.id).reverse().sortBy('createdAt'), [doc.id]) ?? [];
  const [mode, setMode] = useState<SummaryMode>('exam');
  const [depth, setDepth] = useState(3);
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [focus, setFocus] = useState('');
  const go = () =>
    runJob(
      `Resumen ${SUMMARY_MODES[mode].label.toLowerCase()} de «${doc.title}»`,
      async ({ signal, progress }) => {
        const r = await summarizeDocument({ docId: doc.id, mode, depth, length, focus, signal, onProgress: progress });
        const id = newId();
        await db.summaries.add({ id, docId: doc.id, subjectId: doc.subjectId, title: `${SUMMARY_MODES[mode].label}${focus ? ` · ${focus}` : ''} — ${doc.title}`, mode, depth, length, content: r.content, invalidCitations: r.invalid, review: r.review ? { ...r.review, at: Date.now() } : undefined, provider: r.provider, model: r.model, createdAt: Date.now() });
        await logActivity({ type: 'summary', title: `Resumen de «${doc.title}»`, refId: id, route: `/summaries/${id}`, subjectId: doc.subjectId });
        return id;
      },
      { route: (id) => `/summaries/${id}` },
    ).then((id) => id && nav(`/summaries/${id}`));
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="p-4 space-y-4">
        <h3 className="font-display font-semibold">Generar resumen</h3>
        {!aiConfigured(s) && <Notice tone="warn">Configurá un proveedor de IA en Configuración para generar resúmenes.</Notice>}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(Object.keys(SUMMARY_MODES) as SummaryMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-xl border p-2.5 text-left ${mode === m ? 'nav-active' : 'border-line hover:border-line-strong'}`}>
              <div className="text-sm font-medium">{SUMMARY_MODES[m].label}</div>
              <div className="text-[11px] text-muted">{SUMMARY_MODES[m].hint}</div>
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Slider label="Profundidad" value={depth} min={1} max={5} onChange={setDepth} format={(v) => ['', 'Superficial', 'Básica', 'Media', 'Detallada', 'Muy detallada'][v]} />
          <div>
            <div className="text-xs text-muted mb-1.5">Extensión</div>
            <Segmented size="sm" value={length} onChange={setLength} options={[{ value: 'short', label: 'Breve' }, { value: 'medium', label: 'Media' }, { value: 'long', label: 'Extensa' }]} />
          </div>
        </div>
        <Field label="Enfocar en un tema (opcional)">
          <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Ej.: enlaces covalentes" />
        </Field>
        <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={go} disabled={!aiConfigured(s) || doc.status === 'error'}>
          Generar resumen
        </Button>
        <p className="text-[11px] text-faint">Los documentos largos se leen por partes (map-reduce) para cubrir todo el material. Cada dato lleva su cita a la página; las citas a páginas inexistentes se marcan como no verificadas{s.ai.reviewer ? ' y un revisor de calidad compara el resumen con el original' : ''}.</p>
      </Panel>
      <div className="space-y-2">
        <h3 className="font-display font-semibold text-sm">Resúmenes guardados</h3>
        {summaries.length === 0 && <p className="text-sm text-muted">Todavía no hay resúmenes de este documento.</p>}
        {summaries.map((x) => (
          <Link key={x.id} to={`/summaries/${x.id}`} className="panel p-3 block hover:border-line-strong">
            <div className="text-sm truncate">{x.title}</div>
            <div className="text-[11px] text-muted mt-0.5 flex items-center gap-2">
              {fmtDate(x.createdAt)} {x.review && (x.review.ok ? <Badge tone="ok">Revisado</Badge> : <Badge tone="warn">{x.review.issues.length} observaciones</Badge>)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StudyTab({ doc }: { doc: DocumentRec }) {
  const nav = useNavigate();
  const s = useSettings((x) => x.s);
  const res = useLiveQuery(async () => {
    const [sums, tasks, exams, decks, videos, maps] = await Promise.all([
      db.summaries.where('docId').equals(doc.id).toArray(),
      db.tasks.filter((t) => t.sourceDocId === doc.id).toArray(),
      db.exams.where('docId').equals(doc.id).toArray(),
      db.decks.where('docId').equals(doc.id).toArray(),
      db.videos.filter((v) => v.docId === doc.id).toArray(),
      db.maps.where('docId').equals(doc.id).toArray(),
    ]);
    return { sums, tasks, exams, decks, videos, maps };
  }, [doc.id]);
  const pack = () =>
    runJob(
      `Paquete de estudio de «${doc.title}»`,
      async (ctx) => {
        const r = await buildStudyPack(doc.id, ctx);
        if (r.failed.length) toast.error(`Algunos pasos fallaron: ${r.failed.join(' · ')}`);
        return r;
      },
      { route: (r) => `/tutor/${r.sessionId}?send=${encodeURIComponent(`Explicame todo el tema de «${doc.title}» paso a paso, usando el material.`)}` },
    );
  const ai = aiConfigured(s);
  const actions = [
    { icon: GraduationCap, label: 'Clase con el profesor', to: `/tutor?doc=${doc.id}` },
    { icon: ClipboardList, label: 'Crear tarea desde este documento', to: `/tasks?new=1&doc=${doc.id}` },
    { icon: FileText, label: 'Crear examen', to: `/exams?new=1&doc=${doc.id}` },
    { icon: Layers, label: 'Generar flashcards', to: `/flashcards?new=1&doc=${doc.id}` },
    { icon: Network, label: 'Mapa conceptual', to: `/maps?new=1&doc=${doc.id}` },
    { icon: Clapperboard, label: 'Video animado', to: `/video?doc=${doc.id}` },
  ];
  const List = ({ title, items }: { title: string; items: { id: string; label: string; to: string }[] }) =>
    items.length ? (
      <div>
        <div className="text-xs text-muted mb-1">{title}</div>
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id}>
              <Link to={i.to} className="text-sm hover:text-[#b9c6ff]">
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="space-y-4">
      <Panel className="p-5 relative overflow-hidden">
        <div className="absolute -right-10 -top-10 size-40 rounded-full bg-violet/20 blur-3xl" />
        <h3 className="font-display font-semibold text-lg">Explicame todo este tema</h3>
        <p className="text-sm text-muted mt-1 max-w-2xl">Genera con este material un resumen para examen, una tarea de 10 ejercicios, un examen de práctica, flashcards y el guion de un video animado, y abre una clase con el profesor virtual. Todo queda guardado y podés cancelar en cualquier momento.</p>
        <Button variant="primary" className="mt-4" icon={<Sparkles className="size-4" />} onClick={pack} disabled={!ai || doc.status === 'error'}>
          Crear paquete de estudio
        </Button>
        {!ai && <p className="text-xs text-warn mt-2">Requiere configurar un proveedor de IA.</p>}
      </Panel>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
        {actions.map((a) => (
          <button key={a.label} onClick={() => nav(a.to)} className="tile flex items-center gap-3 p-3 text-left text-sm hover:border-line-strong">
            <a.icon className="size-5 text-[#8ea2ff] shrink-0" />
            {a.label}
          </button>
        ))}
      </div>
      {res && (
        <Panel className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <List title="Resúmenes" items={res.sums.map((x) => ({ id: x.id, label: x.title, to: `/summaries/${x.id}` }))} />
          <List title="Tareas" items={res.tasks.map((x) => ({ id: x.id, label: x.title, to: `/tasks/${x.id}` }))} />
          <List title="Exámenes" items={res.exams.map((x) => ({ id: x.id, label: x.title, to: `/exams/${x.id}` }))} />
          <List title="Flashcards" items={res.decks.map((x) => ({ id: x.id, label: x.name, to: `/flashcards/${x.id}` }))} />
          <List title="Videos" items={res.videos.map((x) => ({ id: x.id, label: x.title, to: `/video?id=${x.id}` }))} />
          <List title="Mapas" items={res.maps.map((x) => ({ id: x.id, label: x.title, to: `/maps/${x.id}` }))} />
          {!res.sums.length && !res.tasks.length && !res.exams.length && !res.decks.length && !res.videos.length && !res.maps.length && <p className="text-sm text-muted">Todavía no generaste recursos a partir de este documento.</p>}
        </Panel>
      )}
    </div>
  );
}

export default function DocumentView() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const doc = useLiveQuery(() => db.documents.get(id!), [id]);
  const subject = useLiveQuery(() => (doc?.subjectId ? db.subjects.get(doc.subjectId) : undefined), [doc?.subjectId]);
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const tab = (params.get('tab') as Tab) || (params.get('page') ? 'original' : 'original');
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const setTab = (t: Tab) => setParams((p) => {
    p.set('tab', t);
    return p;
  });
  const setPage = (n: number) => setParams((p) => {
    p.set('page', String(n));
    p.set('tab', 'original');
    return p;
  });
  if (doc === undefined) return null;
  if (!doc) return <EmptyState icon={<FileText className="size-6" />} title="Documento no encontrado" text="Puede que se haya eliminado." />;
  return (
    <div>
      <PageHeader
        title={doc.title}
        subtitle={`${doc.fileName} · ${doc.pageCount} ${doc.unitLabel.toLowerCase()}${doc.pageCount === 1 ? '' : 's'} · ${doc.charCount.toLocaleString('es-AR')} caracteres · importado ${timeAgo(doc.createdAt)}`}
        icon={<FileText className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge d={doc} />
            <Select
              aria-label="Materia"
              value={doc.subjectId ?? ''}
              onChange={(e) => db.documents.update(doc.id, { subjectId: e.target.value || undefined, folderId: undefined })}
              className="w-auto h-9 text-xs"
              style={subject ? { color: subjectStyle(subject.color).text } : undefined}
            >
              <option value="">Sin materia</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      {doc.status === 'processing' && (
        <div className="mb-4">
          <Notice>Procesando el documento… podés ver el progreso abajo a la derecha.</Notice>
        </div>
      )}
      {doc.status === 'error' && (
        <div className="mb-4">
          <Notice tone="bad" title="No se pudo interpretar el documento">
            <span className="inline-flex items-start gap-1.5">
              <TriangleAlert className="size-4 shrink-0 mt-0.5" /> {doc.error} StudyOS no genera contenido a partir de material ilegible.
            </span>
          </Notice>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'original', label: 'Original' },
          { value: 'text', label: 'Texto extraído' },
          { value: 'structure', label: 'Estructura' },
          { value: 'summaries', label: 'Resúmenes' },
          { value: 'study', label: 'Estudiar' },
        ]}
      />
      {tab === 'original' && <OriginalViewer doc={doc} page={Math.min(page, Math.max(1, doc.pageCount))} setPage={setPage} />}
      {tab === 'text' && <TextTab doc={doc} />}
      {tab === 'structure' && <StructureTab doc={doc} goPage={setPage} />}
      {tab === 'summaries' && <SummariesTab doc={doc} />}
      {tab === 'study' && <StudyTab doc={doc} />}
    </div>
  );
}
