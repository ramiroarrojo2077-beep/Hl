import { db, type Chunk, type DocumentRec } from '@/lib/db';
import { Bm25, cosine, spreadSelect } from '@/lib/text';
import { currentEmbeddingModel, embedTexts } from './client';

// Recuperación de fragmentos del material del estudiante. Siempre usa BM25
// (búsqueda léxica local, sin red). Si hay embeddings calculados con el modelo
// actual, combina ambos puntajes (búsqueda híbrida).

export interface RetrievedChunk extends Chunk {
  score: number;
  docTitle: string;
  unitLabel: string;
}

export async function retrieve(docIds: string[], query: string, k = 8, signal?: AbortSignal): Promise<RetrievedChunk[]> {
  if (!docIds.length) return [];
  const docs = await db.documents.bulkGet(docIds);
  const meta = new Map(docs.filter(Boolean).map((d) => [d!.id, d!]));
  const chunks = (await db.chunks.where('docId').anyOf(docIds).toArray()).filter((c) => meta.has(c.docId));
  if (!chunks.length) return [];
  const bm = new Bm25(chunks.map((c) => ({ id: c.id, text: `${c.heading ?? ''}\n${c.text}` })));
  const lex = bm.search(query, Math.max(k * 3, 20));
  const maxLex = lex[0]?.score || 1;
  const scores = new Map<string, number>(lex.map((r) => [r.id, r.score / maxLex]));

  const model = currentEmbeddingModel();
  if (model && chunks.some((c) => c.embeddingModel === model)) {
    try {
      const q = await embedTexts([query], signal);
      if (q) {
        for (const c of chunks) {
          if (c.embeddingModel !== model || !c.embedding) continue;
          const sim = cosine(q.vectors[0], c.embedding);
          scores.set(c.id, (scores.get(c.id) ?? 0) * 0.45 + Math.max(0, sim) * 0.55 * 1.6);
        }
      }
    } catch {
      /* si falla la red, queda la búsqueda léxica */
    }
  }
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id, score]) => {
      const c = byId.get(id)!;
      const d = meta.get(c.docId)!;
      return { ...c, score, docTitle: d.title, unitLabel: d.unitLabel };
    });
}

export function unitAbbr(unitLabel: string) {
  return unitLabel.startsWith('Diap') ? 'diap.' : unitLabel.startsWith('Sec') ? 'sec.' : 'p.';
}

export function formatChunks(chunks: (Chunk & { docTitle?: string; unitLabel?: string })[], multiDoc = false): string {
  return chunks
    .map((c) => {
      const tag = `[${unitAbbr(c.unitLabel ?? 'Página')} ${c.page}]`;
      return `${multiDoc && c.docTitle ? `«${c.docTitle}» ` : ''}${tag}${c.heading ? ` (${c.heading})` : ''}\n${c.text}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Contexto de un documento para generar contenido. Con consulta: fragmentos
 * más relevantes (ordenados como en el original). Sin consulta: fragmentos
 * repartidos a lo largo de todo el documento hasta el presupuesto.
 */
export async function docContext(docId: string, budgetChars: number, query?: string): Promise<{ doc: DocumentRec; text: string; pages: number[]; truncated: boolean }> {
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error('Documento no encontrado');
  const all = await db.chunks.where('[docId+order]').between([docId, -Infinity], [docId, Infinity]).toArray();
  let selected: Chunk[];
  if (query?.trim()) {
    const ranked = await retrieve([docId], query, 60);
    const picked: Chunk[] = [];
    let used = 0;
    for (const c of ranked) {
      if (used + c.text.length > budgetChars) continue;
      picked.push(c);
      used += c.text.length;
    }
    selected = picked.sort((a, b) => a.order - b.order);
  } else {
    selected = spreadSelect(all, budgetChars);
  }
  const text = formatChunks(selected.map((c) => ({ ...c, unitLabel: doc.unitLabel })));
  return { doc, text, pages: [...new Set(selected.map((c) => c.page))], truncated: selected.length < all.length };
}

/** Agrupa todos los fragmentos de un documento en bloques que entran en el presupuesto (map-reduce). */
export async function docBatches(docId: string, budgetChars: number): Promise<{ doc: DocumentRec; batches: string[] }> {
  const doc = await db.documents.get(docId);
  if (!doc) throw new Error('Documento no encontrado');
  const all = await db.chunks.where('[docId+order]').between([docId, -Infinity], [docId, Infinity]).toArray();
  const batches: string[] = [];
  let cur: Chunk[] = [];
  let used = 0;
  for (const c of all) {
    if (used + c.text.length > budgetChars && cur.length) {
      batches.push(formatChunks(cur.map((x) => ({ ...x, unitLabel: doc.unitLabel }))));
      cur = [];
      used = 0;
    }
    cur.push(c);
    used += c.text.length;
  }
  if (cur.length) batches.push(formatChunks(cur.map((x) => ({ ...x, unitLabel: doc.unitLabel }))));
  return { doc, batches };
}

/** Calcula embeddings de los fragmentos de un documento (opcional, si está activado). */
export async function embedDocument(docId: string, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<boolean> {
  const model = currentEmbeddingModel();
  if (!model) return false;
  const chunks = await db.chunks.where('docId').equals(docId).toArray();
  const pending = chunks.filter((c) => c.embeddingModel !== model);
  for (let i = 0; i < pending.length; i += 32) {
    const batch = pending.slice(i, i + 32);
    const res = await embedTexts(batch.map((c) => `${c.heading ?? ''}\n${c.text}`), signal);
    if (!res) return false;
    await db.chunks.bulkPut(batch.map((c, j) => ({ ...c, embedding: res.vectors[j], embeddingModel: res.model })));
    onProgress?.((i + batch.length) / pending.length);
  }
  return true;
}
