import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Network, Plus, Sparkles } from 'lucide-react';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { fmtDate } from '@/lib/format';
import { Button, EmptyState, Field, Input, Modal, Notice, PageHeader, Segmented, Select, Textarea } from '@/components/ui';
import { runJob } from '@/stores/jobs';
import { aiConfigured, useSettings } from '@/stores/settings';
import { generateConceptMap } from '@/ai/agents/visual';
import { layoutMap } from './layout';

export default function MapsPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const s = useSettings((x) => x.s);
  const maps = useLiveQuery(() => db.maps.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const docs = useLiveQuery(() => db.documents.filter((d) => d.status !== 'error' && d.status !== 'processing').toArray(), []) ?? [];
  const summary = useLiveQuery(() => (params.get('summary') ? db.summaries.get(params.get('summary')!) : undefined), [params]);
  const [open, setOpen] = useState(params.get('new') === '1');
  const [mode, setMode] = useState<'ai' | 'empty'>('ai');
  const [docId, setDocId] = useState(params.get('doc') ?? '');
  const [text, setText] = useState('');
  const [topic, setTopic] = useState('');
  const close = () => {
    setOpen(false);
    if (params.toString()) setParams({}, { replace: true });
  };
  const create = async () => {
    close();
    const now = Date.now();
    const doc = docs.find((d) => d.id === docId);
    if (mode === 'empty') {
      const id = newId();
      await db.maps.add({ id, title: topic || 'Nuevo mapa', nodes: [{ id: 'root', label: topic || 'Tema central', x: 0, y: 0, level: 0, color: '#3d5bff' }], edges: [], createdAt: now, updatedAt: now });
      nav(`/maps/${id}`);
      return;
    }
    runJob(
      'Generando mapa conceptual',
      async ({ signal, progress }) => {
        progress(null, 'El Visual Agent está relacionando conceptos');
        const d = await generateConceptMap({ docId: docId || undefined, text: summary ? summary.content : text || undefined, topic: topic || undefined, signal });
        if (d.nodes.length < 2) throw new Error('La IA no encontró suficientes conceptos relacionados.');
        const id = newId();
        await db.maps.add({ id, subjectId: doc?.subjectId, docId: docId || summary?.docId || undefined, title: d.title, ...layoutMap(d), createdAt: now, updatedAt: now });
        return id;
      },
      { route: (id) => `/maps/${id}` },
    ).then((id) => id && nav(`/maps/${id}`));
  };
  return (
    <div>
      <PageHeader title="Mapas conceptuales" subtitle="Transformá tus apuntes en mapas con relaciones reales entre conceptos. Todo es editable." icon={<Network className="size-5" />} actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Nuevo mapa</Button>} />
      {maps.length === 0 ? (
        <EmptyState icon={<Network className="size-6" />} title="Sin mapas" text="Generá un mapa desde un documento, un resumen o tus apuntes, o armalo a mano." action={<Button variant="primary" onClick={() => setOpen(true)}>Crear mapa</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {maps.map((m) => (
            <Link key={m.id} to={`/maps/${m.id}`} className="panel p-4 hover:border-line-strong">
              <div className="font-medium">{m.title}</div>
              <div className="text-xs text-muted mt-1">
                {m.nodes.length} conceptos · {m.edges.length} relaciones · {fmtDate(m.updatedAt)}
              </div>
            </Link>
          ))}
        </div>
      )}
      <Modal
        open={open}
        onClose={close}
        title="Nuevo mapa conceptual"
        footer={
          <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={create} disabled={mode === 'ai' && (!aiConfigured(s) || (!docId && !text.trim() && !topic.trim() && !summary))}>
            Crear
          </Button>
        }
      >
        <div className="space-y-4">
          <Segmented value={mode} onChange={setMode} options={[{ value: 'ai', label: 'Generar con IA' }, { value: 'empty', label: 'Mapa vacío' }]} />
          <Field label="Tema central">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ej.: Energía" />
          </Field>
          {mode === 'ai' && (
            <>
              {!aiConfigured(s) && <Notice tone="warn">Configurá un proveedor de IA para generar mapas.</Notice>}
              {summary && <Notice>Desde el resumen «{summary.title}».</Notice>}
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
              {!docId && !summary && (
                <Field label="O pegá tus apuntes">
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-28" />
                </Field>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
