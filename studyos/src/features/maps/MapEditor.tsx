import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { BookOpen, Download, FileJson, Network, Plus, Sparkles, Trash } from 'lucide-react';
import { db, type ConceptMap } from '@/lib/db';
import { newId } from '@/lib/ids';
import { saveFile } from '@/lib/platform';
import { Button, EmptyState, Input, Panel, Spinner, Textarea } from '@/components/ui';
import { aiConfigured, useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { expandConcept } from '@/ai/agents/visual';
import { aiErrorMessage } from '@/ai/types';
import { layoutMap } from './layout';

type CNode = Node<{ label: string; description?: string; color?: string; page?: number }>;

function ConceptNode({ data, selected }: NodeProps<CNode>) {
  return (
    <div className="rounded-xl px-3 py-2 text-white text-sm shadow-lg max-w-[200px] text-center" style={{ background: `${data.color ?? '#3d5bff'}33`, border: `1.5px solid ${data.color ?? '#3d5bff'}`, boxShadow: selected ? `0 0 0 3px ${data.color ?? '#3d5bff'}55` : undefined }}>
      <Handle type="target" position={Position.Top} className="!bg-cyan !size-2" />
      <div className="font-medium leading-snug">{data.label}</div>
      {data.page && <div className="text-[10px] text-cyan mt-0.5">p. {data.page}</div>}
      <Handle type="source" position={Position.Bottom} className="!bg-cyan !size-2" />
    </div>
  );
}

const nodeTypes = { concept: ConceptNode };
const COLORS = ['#3d5bff', '#8b5cf6', '#12a58a', '#22a05a', '#f08a24', '#e0389a', '#22a0d8', '#94a3b8'];

function toFlow(m: ConceptMap): { nodes: CNode[]; edges: Edge[] } {
  return {
    nodes: m.nodes.map((n) => ({ id: n.id, type: 'concept', position: { x: n.x, y: n.y }, data: { label: n.label, description: n.description, color: n.color, page: n.page } })),
    edges: m.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label, labelStyle: { fill: '#cdd5f0', fontSize: 11 }, labelBgStyle: { fill: '#0b1229' }, style: { stroke: '#3fd7c7' } })),
  };
}

export default function MapEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const s = useSettings((x) => x.s);
  const map = useLiveQuery(() => db.maps.get(id!), [id]);
  const [nodes, setNodes] = useState<CNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const loaded = useRef<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map || loaded.current === map.id) return;
    loaded.current = map.id;
    const f = toFlow(map);
    setNodes(f.nodes);
    setEdges(f.edges);
    setTitle(map.title);
  }, [map]);

  // Guardado automático
  useEffect(() => {
    if (!map || loaded.current !== map.id) return;
    const t = setTimeout(() => {
      db.maps.update(map.id, {
        title,
        nodes: nodes.map((n) => ({ id: n.id, label: n.data.label, description: n.data.description, color: n.data.color, page: n.data.page, x: n.position.x, y: n.position.y, level: 0 })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: typeof e.label === 'string' ? e.label : undefined })),
        updatedAt: Date.now(),
      });
    }, 500);
    return () => clearTimeout(t);
  }, [nodes, edges, title, map]);

  const onNodesChange = useCallback((c: NodeChange<CNode>[]) => setNodes((n) => applyNodeChanges(c, n)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((e) => applyEdgeChanges(c, e)), []);
  const onConnect = useCallback((c: Connection) => {
    const label = prompt('Verbo de enlace (ej.: «produce», «es un tipo de»):') ?? '';
    setEdges((e) => addEdge({ ...c, id: newId(), label: label || undefined, labelStyle: { fill: '#cdd5f0', fontSize: 11 }, labelBgStyle: { fill: '#0b1229' }, style: { stroke: '#3fd7c7' } }, e));
  }, []);
  const selected = nodes.find((n) => n.id === sel);
  const selectedEdge = edges.find((e) => e.id === selEdge);
  const patchNode = (p: Partial<CNode['data']>) => setNodes((ns) => ns.map((n) => (n.id === sel ? { ...n, data: { ...n.data, ...p } } : n)));

  const addNode = () => {
    const nid = newId();
    const base = selected?.position ?? { x: 0, y: 0 };
    setNodes((ns) => [...ns, { id: nid, type: 'concept', position: { x: base.x + 40, y: base.y + 140 }, data: { label: 'Nuevo concepto', color: '#8b5cf6' } }]);
    if (selected) setEdges((e) => [...e, { id: newId(), source: selected.id, target: nid, style: { stroke: '#3fd7c7' } }]);
    setSel(nid);
  };

  const expand = async () => {
    if (!selected || !map) return;
    setExpanding(true);
    try {
      const d = await expandConcept({ concept: selected.data.label, existing: nodes.map((n) => n.data.label), docId: map.docId });
      const lay = layoutMap(d, { originX: selected.position.x, originY: selected.position.y, rootId: 'root' });
      const idMap = new Map<string, string>([['root', selected.id]]);
      const fresh: CNode[] = [];
      for (const n of lay.nodes) {
        if (n.id === 'root') continue;
        const existing = nodes.find((x) => x.data.label.toLowerCase() === n.label.toLowerCase());
        if (existing) {
          idMap.set(n.id, existing.id);
          continue;
        }
        const nid = newId();
        idMap.set(n.id, nid);
        fresh.push({ id: nid, type: 'concept', position: { x: n.x, y: n.y }, data: { label: n.label, description: n.description, color: '#12a58a', page: n.page } });
      }
      const newEdges: Edge[] = lay.edges
        .map((e) => ({ id: newId(), source: idMap.get(e.source)!, target: idMap.get(e.target)!, label: e.label, labelStyle: { fill: '#cdd5f0', fontSize: 11 }, labelBgStyle: { fill: '#0b1229' }, style: { stroke: '#3fd7c7' } }))
        .filter((e) => e.source && e.target && e.source !== e.target);
      setNodes((ns) => [...ns, ...fresh]);
      setEdges((es) => [...es, ...newEdges]);
      toast.ok(`Se agregaron ${fresh.length} conceptos`);
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setExpanding(false);
    }
  };

  const exportPng = async () => {
    const el = wrap.current?.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!el) return;
    const dataUrl = await toPng(wrap.current!.querySelector('.react-flow') as HTMLElement, { backgroundColor: '#060913', filter: (n) => !(n as HTMLElement).classList?.contains('react-flow__controls') && !(n as HTMLElement).classList?.contains('react-flow__minimap') });
    const blob = await (await fetch(dataUrl)).blob();
    toast.ok(`Imagen guardada: ${await saveFile(blob, `${title}.png`)}`);
  };
  const exportJson = async () => {
    const m = await db.maps.get(map!.id);
    toast.ok(`Guardado: ${await saveFile(new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' }), `${title}.json`)}`);
  };
  const flowNodes = useMemo(() => nodes, [nodes]);

  if (map === undefined) return null;
  if (!map) return <EmptyState icon={<Network className="size-6" />} title="Mapa no encontrado" text="Puede que se haya eliminado." />;
  return (
    <div className="flex flex-col h-[calc(100dvh-170px)] lg:h-[calc(100dvh-80px)] gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="max-w-md font-display font-semibold" aria-label="Título del mapa" />
        <Button size="sm" icon={<Plus className="size-4" />} onClick={addNode}>
          Concepto
        </Button>
        <Button size="sm" icon={<Download className="size-4" />} onClick={exportPng}>
          PNG
        </Button>
        <Button size="sm" icon={<FileJson className="size-4" />} onClick={exportJson}>
          JSON
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash className="size-4" />}
          onClick={async () => {
            if (!confirm('¿Eliminar el mapa?')) return;
            await db.maps.delete(map.id);
            nav('/maps');
          }}
        >
          Eliminar
        </Button>
        <span className="text-[11px] text-faint">Arrastrá para mover · conectá desde los puntos · guardado automático</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px] flex-1 min-h-0">
        <div ref={wrap} className="panel overflow-hidden min-h-[360px]">
          <ReactFlow
            nodes={flowNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSel(n.id);
              setSelEdge(null);
            }}
            onEdgeClick={(_, e) => {
              setSelEdge(e.id);
              setSel(null);
            }}
            onPaneClick={() => {
              setSel(null);
              setSelEdge(null);
            }}
            fitView
            minZoom={0.2}
            colorMode="dark"
          >
            <Background color="rgba(150,165,220,.15)" gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => ((n.data as { color?: string }).color ?? '#3d5bff')} />
          </ReactFlow>
        </div>
        <Panel className="p-4 space-y-3 overflow-y-auto scroll-thin">
          {selected ? (
            <>
              <h3 className="font-display font-semibold text-sm">Concepto</h3>
              <Input value={selected.data.label} onChange={(e) => patchNode({ label: e.target.value })} aria-label="Nombre del concepto" />
              <Textarea value={selected.data.description ?? ''} onChange={(e) => patchNode({ description: e.target.value })} placeholder="Descripción" className="min-h-20" />
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button key={c} aria-label={`Color ${c}`} onClick={() => patchNode({ color: c })} className="size-7 rounded-full border-2" style={{ background: c, borderColor: selected.data.color === c ? '#fff' : 'transparent' }} />
                ))}
              </div>
              {selected.data.page && map.docId && (
                <Button size="sm" variant="outline" icon={<BookOpen className="size-4" />} onClick={() => nav(`/library/${map.docId}?page=${selected.data.page}`)}>
                  Ver en el documento (p. {selected.data.page})
                </Button>
              )}
              <Button size="sm" variant="primary" icon={expanding ? <Spinner className="text-white" /> : <Sparkles className="size-4" />} disabled={!aiConfigured(s) || expanding} onClick={expand}>
                Expandir con IA
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash className="size-4" />}
                onClick={() => {
                  setNodes((ns) => ns.filter((n) => n.id !== sel));
                  setEdges((es) => es.filter((e) => e.source !== sel && e.target !== sel));
                  setSel(null);
                }}
              >
                Eliminar concepto
              </Button>
            </>
          ) : selectedEdge ? (
            <>
              <h3 className="font-display font-semibold text-sm">Relación</h3>
              <Input value={(selectedEdge.label as string) ?? ''} onChange={(e) => setEdges((es) => es.map((x) => (x.id === selEdge ? { ...x, label: e.target.value } : x)))} placeholder="Verbo de enlace" />
              <Button size="sm" variant="danger" icon={<Trash className="size-4" />} onClick={() => { setEdges((es) => es.filter((e) => e.id !== selEdge)); setSelEdge(null); }}>
                Eliminar relación
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted">Tocá un concepto o una relación para editarlo. Con un concepto seleccionado podés agregar hijos o expandirlo con IA.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
