import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, FileText, Image, Presentation, Search, Trash, Upload } from 'lucide-react';
import { db, type DocumentRec } from '@/lib/db';
import { fmtBytes, timeAgo } from '@/lib/format';
import { normalizeText } from '@/lib/items';
import { subjectStyle } from '@/lib/subjects';
import { deleteDocument } from '@/import';
import { Badge, Button, EmptyState, IconButton, Input, Notice, PageHeader, Select } from '@/components/ui';
import { ImportDialog } from './ImportDialog';
import { toast } from '@/stores/toast';

const KIND_ICON = { pdf: FileText, docx: FileText, pptx: Presentation, txt: FileText, image: Image, paste: FileText };

export function StatusBadge({ d }: { d: DocumentRec }) {
  if (d.status === 'processing') return <Badge tone="cyan">Procesando…</Badge>;
  if (d.status === 'error') return <Badge tone="bad">No se pudo leer</Badge>;
  if (d.status === 'partial') return <Badge tone="warn">Con avisos</Badge>;
  return d.ocrUsed ? <Badge tone="violet">OCR</Badge> : null;
}

export default function LibraryPage() {
  const [params] = useSearchParams();
  const pick = params.get('pick');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('all');
  const docs = useLiveQuery(() => db.documents.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const byId = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const shown = docs.filter((d) => (subject === 'all' || (subject === 'none' ? !d.subjectId : d.subjectId === subject)) && (!q.trim() || normalizeText(d.title + ' ' + d.fileName).includes(normalizeText(q))));
  return (
    <div>
      <PageHeader
        title="Biblioteca"
        subtitle="Todos tus documentos. El texto se extrae en el dispositivo y cada explicación generada puede abrir la página original."
        icon={<Copy className="size-5" />}
        actions={
          <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setOpen(true)}>
            Subir documento
          </Button>
        }
      />
      {pick === 'summary' && (
        <div className="mb-4">
          <Notice title="Elegí un documento para resumir">Abrilo y en la pestaña «Resúmenes» elegí el tipo de resumen. Si todavía no subiste el material, subilo primero.</Notice>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-4">
        <label className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
          <span className="sr-only">Buscar documentos</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…" className="pl-9" />
        </label>
        <Select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-auto" aria-label="Filtrar por materia">
          <option value="all">Todas las materias</option>
          <option value="none">Sin materia</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      {docs.length === 0 ? (
        <EmptyState icon={<Upload className="size-6" />} title="Tu biblioteca está vacía" text="Subí apuntes en PDF, Word, PowerPoint, fotos de la pizarra o pegá texto." action={<Button variant="primary" onClick={() => setOpen(true)}>Subir documento</Button>} />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((d) => {
            const I = KIND_ICON[d.kind];
            const s = d.subjectId ? byId.get(d.subjectId) : undefined;
            return (
              <div key={d.id} className="panel p-3.5 flex gap-3 hover:border-line-strong transition">
                <span className="grid place-items-center size-11 rounded-xl bg-primary/15 text-[#a9b8ff] shrink-0">
                  <I className="size-5" />
                </span>
                <Link to={`/library/${d.id}${pick === 'summary' ? '?tab=summaries' : ''}`} className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{d.title}</div>
                  <div className="text-xs text-muted mt-0.5">
                    {s ? <span style={{ color: subjectStyle(s.color).text }}>{s.name}</span> : 'Sin materia'} · {d.pageCount} {d.unitLabel.toLowerCase()}
                    {d.pageCount === 1 ? '' : 's'} · {fmtBytes(d.size)}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <StatusBadge d={d} />
                    <span className="text-[11px] text-faint">{timeAgo(d.createdAt)}</span>
                  </div>
                </Link>
                <IconButton
                  label="Eliminar documento"
                  onClick={async () => {
                    if (!confirm(`¿Eliminar «${d.title}»? Los resúmenes, tareas y exámenes generados se conservan.`)) return;
                    await deleteDocument(d.id);
                    toast.ok('Documento eliminado');
                  }}
                >
                  <Trash className="size-4" />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
      <ImportDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
