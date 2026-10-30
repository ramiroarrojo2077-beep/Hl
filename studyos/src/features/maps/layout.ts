import type { ConceptMap } from '@/lib/db';
import type { MapDraft } from '@/ai/agents/visual';

/** Distribuye un mapa en niveles (BFS desde la raíz) para que sea legible. */
export function layoutMap(d: MapDraft, opts: { originX?: number; originY?: number; rootId?: string } = {}): Pick<ConceptMap, 'nodes' | 'edges'> {
  const adj = new Map<string, string[]>();
  for (const n of d.nodes) adj.set(n.id, []);
  for (const e of d.edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }
  const root = opts.rootId && adj.has(opts.rootId) ? opts.rootId : [...adj.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? d.nodes[0]?.id;
  const level = new Map<string, number>();
  const queue = root ? [root] : [];
  if (root) level.set(root, 0);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!level.has(nb)) {
        level.set(nb, level.get(cur)! + 1);
        queue.push(nb);
      }
    }
  }
  const maxL = Math.max(0, ...level.values());
  for (const n of d.nodes) if (!level.has(n.id)) level.set(n.id, maxL + 1);
  const rows = new Map<number, string[]>();
  for (const n of d.nodes) rows.set(level.get(n.id)!, [...(rows.get(level.get(n.id)!) ?? []), n.id]);
  const pos = new Map<string, { x: number; y: number }>();
  const ox = opts.originX ?? 0;
  const oy = opts.originY ?? 0;
  for (const [l, ids] of rows) {
    const w = 210;
    ids.forEach((id, i) => pos.set(id, { x: ox + (i - (ids.length - 1) / 2) * w, y: oy + l * 150 }));
  }
  const palette = ['#3d5bff', '#8b5cf6', '#12a58a', '#e0389a', '#f08a24', '#22a0d8'];
  return {
    nodes: d.nodes.map((n) => ({ id: n.id, label: n.label, description: n.description ?? undefined, page: n.page ?? undefined, level: level.get(n.id)!, color: palette[Math.min(level.get(n.id)!, palette.length - 1)], ...pos.get(n.id)! })),
    edges: d.edges.map((e, i) => ({ id: `e${i}-${e.source}-${e.target}`, source: e.source, target: e.target, label: e.label ?? undefined })),
  };
}
