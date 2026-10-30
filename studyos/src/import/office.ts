import JSZip from 'jszip';
import { cleanText } from '@/lib/text';
import type { ExtractCtx, ExtractResult, ExtractedPage } from './types';

// DOCX: mammoth convierte a HTML conservando títulos y tablas; se divide en
// secciones por título de nivel 1-2 (los DOCX no tienen páginas fijas).
export async function extractDocx(data: ArrayBuffer, ctx: ExtractCtx): Promise<ExtractResult> {
  ctx.progress(0.1, 'Leyendo documento Word');
  const mammoth = await import('mammoth');
  const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer: data });
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild!;
  const pages: ExtractedPage[] = [];
  let cur: ExtractedPage = { index: 1, text: '', headings: [], tables: 0, tableRows: 0, images: 0 };
  const pushCur = () => {
    if (cur.text.trim() || cur.headings.length) {
      cur.text = cleanText(cur.text);
      pages.push(cur);
    }
  };
  for (const el of Array.from(root.children)) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-2]$/.test(tag) && cur.text.length > 600) {
      pushCur();
      cur = { index: pages.length + 1, text: '', headings: [], tables: 0, tableRows: 0, images: 0 };
    }
    if (/^h[1-6]$/.test(tag)) {
      cur.headings.push({ text: el.textContent?.trim() ?? '', level: Number(tag[1]) });
      cur.text += `\n\n${el.textContent?.trim()}\n`;
    } else if (tag === 'table') {
      cur.tables++;
      const rows = Array.from(el.querySelectorAll('tr'));
      cur.tableRows += rows.length;
      cur.text += '\n' + rows.map((r) => Array.from(r.querySelectorAll('td,th')).map((c) => c.textContent?.trim() ?? '').join(' | ')).join('\n') + '\n';
    } else if (tag === 'ul' || tag === 'ol') {
      cur.text += '\n' + Array.from(el.querySelectorAll('li')).map((li) => `• ${li.textContent?.trim()}`).join('\n') + '\n';
    } else {
      cur.images += el.querySelectorAll('img').length;
      cur.text += `\n${el.textContent?.trim() ?? ''}\n`;
    }
    // Secciones largas sin títulos: se cortan cada ~3500 caracteres
    if (cur.text.length > 3500) {
      pushCur();
      cur = { index: pages.length + 1, text: '', headings: [], tables: 0, tableRows: 0, images: 0 };
    }
  }
  pushCur();
  pages.forEach((p, i) => (p.index = i + 1));
  const warnings = messages.filter((m) => m.type === 'warning').slice(0, 3).map((m) => `Word: ${m.message}`);
  return { pages, unitLabel: 'Sección', warnings, ocrUsed: false };
}

// PPTX: cada diapositiva es una unidad; se leen los textos (a:t) en orden,
// el título (placeholder title/ctrTitle) y las notas del orador.
export async function extractPptx(data: ArrayBuffer, ctx: ExtractCtx): Promise<ExtractResult> {
  ctx.progress(0.1, 'Leyendo presentación');
  const zip = await JSZip.loadAsync(data);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml/)![1]) - Number(b.match(/(\d+)\.xml/)![1]));
  const pages: ExtractedPage[] = [];
  const parser = new DOMParser();
  for (let i = 0; i < slideFiles.length; i++) {
    ctx.progress(i / slideFiles.length, `Diapositiva ${i + 1} de ${slideFiles.length}`);
    const xml = parser.parseFromString(await zip.file(slideFiles[i])!.async('string'), 'application/xml');
    const shapes = Array.from(xml.getElementsByTagNameNS('*', 'sp'));
    const headings: { text: string; level: number }[] = [];
    const parts: string[] = [];
    for (const sp of shapes) {
      const ph = sp.getElementsByTagNameNS('*', 'ph')[0];
      const type = ph?.getAttribute('type') ?? '';
      const paras = Array.from(sp.getElementsByTagNameNS('*', 'p')).map((p) => Array.from(p.getElementsByTagNameNS('*', 't')).map((t) => t.textContent ?? '').join(''));
      const text = paras.filter((p) => p.trim()).join('\n');
      if (!text.trim()) continue;
      if (type === 'title' || type === 'ctrTitle') headings.push({ text: text.trim(), level: 1 });
      parts.push(text);
    }
    const tables = xml.getElementsByTagNameNS('*', 'tbl').length;
    let tableRows = 0;
    for (const tbl of Array.from(xml.getElementsByTagNameNS('*', 'tbl'))) {
      const rows = Array.from(tbl.getElementsByTagNameNS('*', 'tr'));
      tableRows += rows.length;
      parts.push(rows.map((r) => Array.from(r.getElementsByTagNameNS('*', 'tc')).map((c) => c.textContent?.trim()).join(' | ')).join('\n'));
    }
    const images = xml.getElementsByTagNameNS('*', 'pic').length;
    // Notas del orador
    const relsPath = slideFiles[i].replace('slides/', 'slides/_rels/') + '.rels';
    const rels = zip.file(relsPath) ? parser.parseFromString(await zip.file(relsPath)!.async('string'), 'application/xml') : null;
    const noteRel = rels ? Array.from(rels.getElementsByTagName('Relationship')).find((r) => /notesSlide/.test(r.getAttribute('Type') ?? '')) : null;
    if (noteRel) {
      const target = 'ppt/' + (noteRel.getAttribute('Target') ?? '').replace('../', '');
      const nf = zip.file(target);
      if (nf) {
        const nx = parser.parseFromString(await nf.async('string'), 'application/xml');
        const notes = Array.from(nx.getElementsByTagNameNS('*', 't')).map((t) => t.textContent ?? '').join(' ').replace(/^\s*\d+\s*$/, '').trim();
        if (notes.length > 3) parts.push(`Notas: ${notes}`);
      }
    }
    pages.push({ index: i + 1, text: cleanText(parts.join('\n\n')), headings, tables, tableRows, images });
  }
  const warnings: string[] = [];
  const empty = pages.filter((p) => !p.text.trim()).length;
  if (empty) warnings.push(`${empty} diapositiva(s) sin texto (pueden contener solo imágenes).`);
  return { pages, unitLabel: 'Diapositiva', warnings, ocrUsed: false };
}

export function extractPlainText(text: string): ExtractResult {
  const clean = cleanText(text);
  const pages: ExtractedPage[] = [];
  // Secciones por títulos tipo Markdown o cada ~3500 caracteres
  const blocks = clean.split(/\n(?=#{1,3} )/);
  let buf = '';
  let headings: { text: string; level: number }[] = [];
  const push = () => {
    if (buf.trim()) pages.push({ index: pages.length + 1, text: buf.trim(), headings, tables: 0, tableRows: 0, images: 0 });
    buf = '';
    headings = [];
  };
  for (const b of blocks) {
    const h = b.match(/^(#{1,3}) (.+)/);
    if (h && buf.length > 800) push();
    if (h) headings.push({ text: h[2].trim(), level: h[1].length });
    for (const para of b.split(/\n{2,}/)) {
      if (buf.length + para.length > 3500) push();
      buf += (buf ? '\n\n' : '') + para;
    }
  }
  push();
  return { pages, unitLabel: 'Sección', warnings: [], ocrUsed: false };
}
