import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { cleanText } from '@/lib/text';
import { ocrImage } from './ocr';
import type { ExtractCtx, ExtractResult, ExtractedPage } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function vendor(p: string) {
  return new URL(`vendor/pdfjs/${p}/`, document.baseURI).href;
}

export async function loadPdf(data: ArrayBuffer) {
  return pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: vendor('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: vendor('standard_fonts'),
    wasmUrl: vendor('wasm'),
    iccUrl: vendor('iccs'),
  }).promise;
}

interface Line {
  y: number;
  size: number;
  text: string;
}

export async function extractPdf(data: ArrayBuffer, ctx: ExtractCtx): Promise<ExtractResult> {
  const pdf = await loadPdf(data);
  const pages: ExtractedPage[] = [];
  const warnings: string[] = [];
  let ocrUsed = false;
  let ocrPages = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    if (ctx.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    ctx.progress((i - 1) / pdf.numPages, `Leyendo página ${i} de ${pdf.numPages}`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it): it is TextItem => 'str' in it);
    // Agrupa fragmentos por línea (misma coordenada y) para reconstruir el texto.
    const lines: Line[] = [];
    for (const it of items) {
      if (!it.str.trim() && !it.hasEOL) continue;
      const y = Math.round(it.transform[5]);
      const size = Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) <= Math.max(2, size * 0.3)) {
        last.text += (last.text.endsWith(' ') || it.str.startsWith(' ') ? '' : ' ') + it.str;
        last.size = Math.max(last.size, size);
      } else {
        lines.push({ y, size, text: it.str });
      }
    }
    const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] || 10;
    const headings = lines
      .filter((l) => l.size >= median * 1.25 && l.text.trim().length > 2 && l.text.trim().length < 120)
      .map((l) => ({ text: l.text.trim(), level: l.size >= median * 1.7 ? 1 : 2 }));
    let text = cleanText(lines.map((l) => l.text).join('\n'));
    // Imágenes en la página
    let images = 0;
    try {
      const ops = await page.getOperatorList();
      images = ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length;
    } catch {
      /* no crítico */
    }
    // Tablas: heurística por líneas con varias columnas separadas por espacios amplios
    const tableRows = lines.filter((l) => (l.text.match(/\S\s{3,}\S/g) ?? []).length >= 2).length;
    let ocr = false;
    let ocrConfidence: number | undefined;
    if (text.replace(/\s/g, '').length < 40 && ctx.ocrMode !== 'off') {
      // Página escaneada o sin capa de texto: se renderiza y se aplica OCR.
      ctx.progress((i - 0.5) / pdf.numPages, `Aplicando OCR a la página ${i}`);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const r = await ocrImage(canvas, ctx);
      text = cleanText(r.text);
      ocr = true;
      ocrConfidence = r.confidence;
      ocrUsed = true;
      ocrPages++;
      if (r.confidence < 60 && text) warnings.push(`Página ${i}: OCR con confianza baja (${Math.round(r.confidence)}%). Revisá el texto extraído.`);
    }
    if (!text.trim()) warnings.push(`Página ${i}: no se encontró texto legible.`);
    pages.push({ index: i, text, headings, tables: tableRows >= 3 ? 1 : 0, tableRows, images, ocr, ocrConfidence });
    page.cleanup();
  }
  await pdf.destroy();
  if (ocrPages) warnings.unshift(`${ocrPages} página(s) escaneada(s) procesadas con OCR.`);
  return { pages, unitLabel: 'Página', warnings, ocrUsed };
}

/** Renderiza una página para el visor de documentos. */
export async function renderPdfPage(data: ArrayBuffer, pageNum: number, canvas: HTMLCanvasElement, width: number) {
  const pdf = await loadPdf(data);
  try {
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${width}px`;
    await page.render({ canvas, viewport }).promise;
  } finally {
    await pdf.destroy();
  }
}
