import { db, type DocKind, type DocumentRec, type DocStructure } from '@/lib/db';
import { newId } from '@/lib/ids';
import { chunkPages, detectFormulas, extractKeywords } from '@/lib/text';
import { extractPdf } from './pdf';
import { extractDocx, extractPptx, extractPlainText } from './office';
import { ocrImage, prepareImage } from './ocr';
import type { ExtractCtx, ExtractResult } from './types';

export const MAX_FILE_MB = 60;
export const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.jpg,.jpeg,.png,application/pdf,text/plain,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation';

export class ImportError extends Error {}

/** Detecta el tipo real por extensión y bytes iniciales (no confía solo en el nombre). */
export async function detectKind(file: File): Promise<DocKind> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image';
  if (isZip && ext === 'docx') return 'docx';
  if (isZip && ext === 'pptx') return 'pptx';
  if (ext === 'txt' || ext === 'md' || file.type.startsWith('text/')) return 'txt';
  if (ext === 'doc' || ext === 'ppt') throw new ImportError('Los formatos antiguos .doc y .ppt no son compatibles. Guardalos como .docx o .pptx.');
  throw new ImportError(`Formato no compatible (${ext || file.type || 'desconocido'}). Usá PDF, DOCX, PPTX, TXT, JPG o PNG.`);
}

export async function checkStorage(extraBytes: number): Promise<string | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota && est.usage !== undefined && est.usage + extraBytes > est.quota * 0.92) {
      return 'El almacenamiento del dispositivo para StudyOS está casi lleno. Borrá documentos que no uses.';
    }
  } catch {
    /* sin soporte */
  }
  return null;
}

export interface ImportOptions {
  subjectId?: string;
  folderId?: string;
  title?: string;
  ocrMode: 'local' | 'ai' | 'off';
  signal?: AbortSignal;
  onProgress?: (p: number, detail: string) => void;
}

async function runExtraction(kind: DocKind, file: Blob | null, text: string | null, ctx: ExtractCtx): Promise<ExtractResult> {
  switch (kind) {
    case 'pdf':
      return extractPdf(await file!.arrayBuffer(), ctx);
    case 'docx':
      return extractDocx(await file!.arrayBuffer(), ctx);
    case 'pptx':
      return extractPptx(await file!.arrayBuffer(), ctx);
    case 'txt':
      return extractPlainText(await (file as Blob).text());
    case 'paste':
      return extractPlainText(text ?? '');
    case 'image': {
      if (ctx.ocrMode === 'off') return { pages: [{ index: 1, text: '', headings: [], tables: 0, tableRows: 0, images: 1 }], unitLabel: 'Página', warnings: ['Imagen guardada sin OCR.'], ocrUsed: false };
      ctx.progress(0.2, ctx.ocrMode === 'ai' ? 'Leyendo la imagen con IA' : 'Reconociendo texto (OCR local)');
      const source = ctx.ocrMode === 'ai' ? file! : await prepareImage(file!);
      const r = await ocrImage(source, ctx);
      const warnings = r.confidence < 60 && r.text.trim() ? [`OCR con confianza baja (${Math.round(r.confidence)}%). Revisá el texto antes de estudiar con él.`] : [];
      return { pages: [{ index: 1, text: r.text.trim(), headings: [], tables: 0, tableRows: 0, images: 1, ocr: true, ocrConfidence: r.confidence }], unitLabel: 'Página', warnings, ocrUsed: true };
    }
  }
}

/** Importa un archivo o texto pegado: guarda el original, extrae, estructura y fragmenta. */
export async function importDocument(input: { file?: File; text?: string }, o: ImportOptions): Promise<DocumentRec> {
  const file = input.file ?? null;
  if (file && file.size > MAX_FILE_MB * 1024 * 1024) throw new ImportError(`El archivo supera el límite de ${MAX_FILE_MB} MB.`);
  if (!file && !input.text?.trim()) throw new ImportError('No hay contenido para importar.');
  const kind: DocKind = file ? await detectKind(file) : 'paste';
  const storageWarn = await checkStorage(file?.size ?? 0);
  if (storageWarn && file && file.size > 5 * 1024 * 1024) throw new ImportError(storageWarn);

  const now = Date.now();
  const id = newId();
  const emptyStructure: DocStructure = { headings: [], formulas: [], tables: [], images: [], keywords: [] };
  const doc: DocumentRec = {
    id,
    subjectId: o.subjectId,
    folderId: o.folderId,
    title: o.title?.trim() || (file ? file.name.replace(/\.[^.]+$/, '') : (input.text ?? '').trim().split('\n')[0].slice(0, 60) || 'Texto pegado'),
    fileName: file?.name ?? 'texto.txt',
    mime: file?.type || (kind === 'paste' ? 'text/plain' : ''),
    size: file?.size ?? (input.text ?? '').length,
    kind,
    status: 'processing',
    warnings: [],
    pageCount: 0,
    unitLabel: 'Página',
    ocrUsed: false,
    charCount: 0,
    structure: emptyStructure,
    createdAt: now,
    updatedAt: now,
  };
  await db.documents.add(doc);
  if (file) await db.docFiles.put({ id, blob: file });

  const ctx: ExtractCtx = { signal: o.signal, ocrMode: o.ocrMode, progress: (p, d) => o.onProgress?.(p * 0.85, d) };
  try {
    const res = await runExtraction(kind, file, input.text ?? null, ctx);
    const pages = res.pages;
    const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
    const structure: DocStructure = {
      headings: pages.flatMap((p) => p.headings.map((h) => ({ ...h, page: p.index }))).slice(0, 300),
      formulas: pages.flatMap((p) => detectFormulas(p.text, p.index)).slice(0, 120),
      tables: pages.filter((p) => p.tables > 0).map((p) => ({ page: p.index, rows: p.tableRows })),
      images: pages.filter((p) => p.images > 0).map((p) => ({ page: p.index, count: p.images })),
      keywords: extractKeywords(pages.map((p) => ({ page: p.index, text: p.text }))),
    };
    o.onProgress?.(0.88, 'Fragmentando para búsqueda');
    const headingByPage = new Map<number, string>();
    for (const h of structure.headings) if (!headingByPage.has(h.page)) headingByPage.set(h.page, h.text);
    const chunks = chunkPages(pages.map((p) => ({ page: p.index, text: p.text })), 1100, headingByPage);
    await db.transaction('rw', db.pages, db.chunks, db.documents, async () => {
      await db.pages.bulkAdd(pages.map((p) => ({ id: `${id}:${p.index}`, docId: id, index: p.index, text: p.text, ocr: p.ocr, ocrConfidence: p.ocrConfidence })));
      await db.chunks.bulkAdd(chunks.map((c) => ({ id: newId(), docId: id, ...c })));
      const unreadable = totalChars < 30;
      const emptyPages = pages.filter((p) => !p.text.trim()).length;
      await db.documents.update(id, {
        status: unreadable ? 'error' : emptyPages > 0 ? 'partial' : 'ready',
        error: unreadable
          ? kind === 'image' || res.ocrUsed
            ? 'No se pudo reconocer texto en el archivo. Probá con una foto más nítida, mejor iluminada o con el OCR por IA.'
            : 'El archivo no contiene texto legible. Si es un escaneo, activá el OCR al importarlo.'
          : undefined,
        warnings: [...res.warnings, ...(storageWarn ? [storageWarn] : [])],
        pageCount: pages.length,
        unitLabel: res.unitLabel,
        ocrUsed: res.ocrUsed,
        charCount: totalChars,
        structure,
        updatedAt: Date.now(),
      });
    });
    o.onProgress?.(0.95, 'Listo');
    // Embeddings opcionales (búsqueda semántica); si fallan, la búsqueda léxica sigue funcionando.
    try {
      const { embedDocument } = await import('@/ai/rag');
      await embedDocument(id, o.signal);
    } catch {
      await db.documents.update(id, { warnings: [...res.warnings, 'No se pudieron calcular los embeddings; se usará búsqueda por palabras.'] });
    }
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    await db.documents.update(id, { status: 'error', error: aborted ? 'Importación cancelada.' : `No se pudo procesar el archivo: ${(e as Error).message}`, updatedAt: Date.now() });
    if (aborted) throw e;
    throw new ImportError(`No se pudo procesar «${doc.title}»: ${(e as Error).message}`);
  }
  return (await db.documents.get(id))!;
}

export async function deleteDocument(id: string) {
  await db.transaction('rw', [db.documents, db.docFiles, db.pages, db.chunks], async () => {
    await db.pages.where('docId').equals(id).delete();
    await db.chunks.where('docId').equals(id).delete();
    await db.docFiles.delete(id);
    await db.documents.delete(id);
  });
}

/** Reemplaza el texto de una página (corrección manual de OCR) y regenera sus fragmentos. */
export async function updatePageText(docId: string, index: number, text: string) {
  const doc = await db.documents.get(docId);
  if (!doc) return;
  await db.transaction('rw', db.pages, db.chunks, db.documents, async () => {
    await db.pages.update(`${docId}:${index}`, { text, ocr: false });
    const old = await db.chunks.where('docId').equals(docId).filter((c) => c.page === index).toArray();
    const startOrder = old.length ? Math.min(...old.map((c) => c.order)) : 1e6 + index;
    await db.chunks.bulkDelete(old.map((c) => c.id));
    const fresh = chunkPages([{ page: index, text }]);
    await db.chunks.bulkAdd(fresh.map((c, i) => ({ ...c, id: newId(), docId, order: startOrder + i * 0.01 })));
    const pages = await db.pages.where('docId').equals(docId).toArray();
    const empty = pages.filter((p) => !p.text.trim()).length;
    await db.documents.update(docId, { status: empty ? 'partial' : 'ready', charCount: pages.reduce((s, p) => s + p.text.length, 0), error: undefined, updatedAt: Date.now() });
  });
}
