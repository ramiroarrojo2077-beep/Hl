import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardList, Download, FileText, Layers, Trash, Volume2, Square, Network } from 'lucide-react';
import { db } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { exportMarkdownPdf } from '@/lib/pdfExport';
import { saveFile } from '@/lib/platform';
import { Badge, Button, EmptyState, Notice, PageHeader, Panel } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { SUMMARY_MODES } from '@/ai/agents/summary';
import { speak, stopSpeaking } from '@/voice/tts';
import { useVoice } from '@/voice/bus';
import { toast } from '@/stores/toast';

export default function SummaryView() {
  const { id } = useParams();
  const nav = useNavigate();
  const s = useLiveQuery(() => db.summaries.get(id!), [id]);
  const doc = useLiveQuery(() => (s?.docId ? db.documents.get(s.docId) : undefined), [s?.docId]);
  const speaking = useVoice((v) => v.state === 'speaking');
  if (s === undefined) return null;
  if (!s) return <EmptyState icon={<FileText className="size-6" />} title="Resumen no encontrado" text="Puede que se haya eliminado." />;
  const onCite = doc ? (page: number) => nav(`/library/${doc.id}?page=${page}`) : undefined;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title={s.title}
        subtitle={`${SUMMARY_MODES[s.mode].label} · profundidad ${s.depth}/5 · ${fmtDateTime(s.createdAt)} · ${s.provider} ${s.model}`}
        icon={<FileText className="size-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" icon={speaking ? <Square className="size-3.5" /> : <Volume2 className="size-3.5" />} onClick={() => (speaking ? stopSpeaking() : speak(s.content))}>
              {speaking ? 'Detener' : 'Escuchar'}
            </Button>
            <Button size="sm" variant="outline" icon={<Download className="size-3.5" />} onClick={async () => toast.ok(`Guardado en ${await saveFile(exportMarkdownPdf(s.title, s.content), `${s.title}.pdf`)}`)}>
              PDF
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash className="size-3.5" />}
              onClick={async () => {
                if (!confirm('¿Eliminar este resumen?')) return;
                await db.summaries.delete(s.id);
                nav(doc ? `/library/${doc.id}?tab=summaries` : '/library');
              }}
            >
              Eliminar
            </Button>
          </>
        }
      />
      {doc && (
        <p className="text-sm text-muted -mt-3 mb-4">
          Fuente: <Link to={`/library/${doc.id}`} className="text-[#8ea2ff]">{doc.title}</Link>. Tocá una cita <Badge tone="cyan">p. N</Badge> para abrir la página original.
        </p>
      )}
      {s.invalidCitations.length > 0 && (
        <div className="mb-3">
          <Notice tone="warn">La IA citó páginas que no existen en el documento ({s.invalidCitations.join(', ')}); esas citas se marcaron como «no verificadas».</Notice>
        </div>
      )}
      {s.review && !s.review.ok && (
        <div className="mb-3">
          <Notice tone="warn" title="Observaciones del revisor de calidad">
            <ul className="list-disc pl-4">
              {s.review.issues.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      {s.review?.ok && (
        <div className="mb-3">
          <Notice tone="ok">El revisor de calidad comparó el resumen con el material y no encontró afirmaciones sin respaldo.</Notice>
        </div>
      )}
      <Panel className="p-5 sm:p-7">
        <Markdown onCite={onCite}>{s.content}</Markdown>
      </Panel>
      <div className="flex flex-wrap gap-2 mt-4">
        <Button icon={<ClipboardList className="size-4" />} onClick={() => nav(`/tasks?new=1&summary=${s.id}`)}>
          Crear tarea desde este resumen
        </Button>
        <Button icon={<Layers className="size-4" />} onClick={() => nav(`/flashcards?new=1&summary=${s.id}`)}>
          Flashcards
        </Button>
        <Button icon={<Network className="size-4" />} onClick={() => nav(`/maps?new=1&summary=${s.id}`)}>
          Mapa conceptual
        </Button>
      </div>
    </div>
  );
}
