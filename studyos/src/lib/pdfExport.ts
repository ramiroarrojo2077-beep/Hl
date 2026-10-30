import { jsPDF } from 'jspdf';
import { answerText, correctAnswerText, ITEM_TYPE_LABEL, seededShuffle, type Item } from './items';
import type { ItemResult } from './db';
import { fmtDate } from './format';

// Exportación a PDF con jsPDF (fuentes estándar: cubren español; los símbolos
// matemáticos que no soportan se escriben en texto).

const SYMBOLS: [RegExp, string][] = [
  [/²/g, '^2'], [/³/g, '^3'], [/√/g, 'raiz'], [/π/g, 'pi'], [/Δ/g, 'Delta'], [/∑/g, 'Suma'], [/∫/g, 'integral'], [/≤/g, '<='], [/≥/g, '>='], [/≠/g, '!='], [/≈/g, '~'], [/→/g, '->'], [/⇌/g, '<=>'], [/×/g, 'x'], [/÷/g, '/'], [/±/g, '+/-'], [/α/g, 'alfa'], [/β/g, 'beta'], [/θ/g, 'theta'], [/λ/g, 'lambda'], [/μ/g, 'mu'], [/∞/g, 'infinito'], [/[“”]/g, '"'], [/[‘’]/g, "'"], [/[–—]/g, '-'], [/…/g, '...'],
];

export function pdfText(s: string): string {
  let out = s
    .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^}]*)\}/g, 'raiz($1)')
    .replace(/\\(cdot|times)/g, '·')
    .replace(/\\(left|right|,|;|!)/g, '')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '');
  for (const [re, r] of SYMBOLS) out = out.replace(re, r);
  // Quita caracteres fuera de Latin-1 que la fuente estándar no puede dibujar
  return out.replace(/[^\u0000-ÿ·]/g, '');
}

class Writer {
  doc = new jsPDF({ unit: 'mm', format: 'a4' });
  y = 18;
  readonly left = 16;
  readonly width = 178;
  ensure(h: number) {
    if (this.y + h > 282) {
      this.doc.addPage();
      this.y = 18;
    }
  }
  text(s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10.5;
    this.doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    this.doc.setTextColor(...(opts.color ?? [20, 24, 40]));
    const lines = this.doc.splitTextToSize(pdfText(s), this.width - (opts.indent ?? 0)) as string[];
    const lh = size * 0.42;
    for (const l of lines) {
      this.ensure(lh);
      this.doc.text(l, this.left + (opts.indent ?? 0), this.y);
      this.y += lh;
    }
    this.y += opts.gap ?? 1.5;
  }
  line() {
    this.ensure(4);
    this.doc.setDrawColor(200, 205, 220);
    this.doc.line(this.left, this.y, this.left + this.width, this.y);
    this.y += 4;
  }
  blank(lines = 2) {
    for (let i = 0; i < lines; i++) {
      this.ensure(7);
      this.doc.setDrawColor(210, 214, 228);
      this.doc.line(this.left + 4, this.y + 4, this.left + this.width, this.y + 4);
      this.y += 7;
    }
    this.y += 2;
  }
  blob() {
    const n = this.doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i);
      this.doc.setFontSize(8);
      this.doc.setTextColor(140, 146, 170);
      this.doc.text(`StudyOS AI · página ${i} de ${n}`, this.left, 292);
    }
    return this.doc.output('blob');
  }
}

export interface PrintableSet {
  title: string;
  subtitle?: string;
  description?: string;
  objectives?: string[];
  items: Item[];
}

export function exportItemsPdf(set: PrintableSet, opts: { solutions: boolean; answers?: Record<string, unknown>; results?: Record<string, ItemResult> }): Blob {
  const w = new Writer();
  w.text(set.title, { size: 17, bold: true, gap: 2 });
  if (set.subtitle) w.text(set.subtitle, { size: 9.5, color: [100, 108, 135] });
  w.text(`Generado el ${fmtDate(Date.now(), { day: 'numeric', month: 'long', year: 'numeric' })}${opts.solutions ? ' · versión con soluciones' : ''}${opts.answers ? ' · con mis respuestas' : ''}`, { size: 8.5, color: [120, 126, 150] });
  if (!opts.answers) {
    w.text('Nombre: ______________________________   Fecha: ____________', { size: 10, gap: 3 });
  }
  if (set.description) w.text(set.description, { gap: 2 });
  if (set.objectives?.length) {
    w.text('Objetivos', { bold: true, size: 11 });
    for (const o of set.objectives) w.text(`• ${o}`, { indent: 3 });
  }
  w.line();
  set.items.forEach((it, i) => {
    w.ensure(18);
    w.text(`${i + 1}. ${it.prompt}`, { bold: true, size: 11 });
    w.text(`${ITEM_TYPE_LABEL[it.type]} · ${it.points} punto${it.points === 1 ? '' : 's'}${it.sourcePage ? ` · material p. ${it.sourcePage}` : ''}`, { size: 8.5, color: [120, 126, 150] });
    if (it.media?.kind === 'table') {
      w.text(it.media.headers.join(' | '), { bold: true, indent: 4, size: 9.5 });
      for (const r of it.media.rows) w.text(r.join(' | '), { indent: 4, size: 9.5, gap: 0.5 });
    }
    if (it.media?.kind === 'chart') w.text(`Gráfico: y = ${it.media.expression} en [${it.media.xMin}, ${it.media.xMax}]`, { indent: 4, size: 9.5 });
    if (it.media?.kind === 'lab') w.text(`Actividad con el laboratorio 3D de StudyOS: ${it.media.instructions}`, { indent: 4, size: 9.5 });
    if (it.type === 'mcq') it.options!.forEach((o, j) => w.text(`${String.fromCharCode(97 + j)}) ${o}`, { indent: 5 }));
    if (it.type === 'tf') w.text('Verdadero  /  Falso', { indent: 5 });
    if (it.type === 'match') {
      const rights = seededShuffle(it.pairs!.map((p) => p.right), it.id);
      it.pairs!.forEach((p, j) => w.text(`${j + 1}. ${p.left}        ${String.fromCharCode(65 + j)}. ${rights[j]}`, { indent: 5 }));
    }
    if (it.type === 'order') w.text(seededShuffle(it.sequence!, it.id).map((x) => `[  ] ${x}`).join('    '), { indent: 5 });
    if (opts.answers) {
      w.text(`Mi respuesta: ${answerText(it, opts.answers[it.id])}`, { indent: 4, color: [40, 60, 160] });
      const r = opts.results?.[it.id];
      if (r) w.text(`Corrección: ${r.score}/${r.max}. ${r.feedback}`, { indent: 4, color: r.correct ? [20, 120, 70] : [170, 60, 40] });
    } else if (!opts.solutions && ['short', 'numeric', 'fill', 'essay', 'problem'].includes(it.type)) {
      w.blank(it.type === 'essay' || it.type === 'problem' ? 6 : 2);
    }
    if (opts.solutions) {
      w.text(`Respuesta: ${correctAnswerText(it)}`, { indent: 4, color: [20, 120, 70] });
      if (it.solutionSteps.length) it.solutionSteps.forEach((s, j) => w.text(`Paso ${j + 1}: ${s}`, { indent: 6, size: 9.5, color: [60, 66, 90] }));
      if (it.explanation) w.text(it.explanation, { indent: 4, size: 9.5, color: [60, 66, 90] });
      if (it.rubric?.length) w.text(`Criterios: ${it.rubric.map((c) => `${c.description} (${c.points})`).join('; ')}`, { indent: 4, size: 9, color: [90, 96, 120] });
    }
    w.y += 3;
  });
  return w.blob();
}

export function exportMarkdownPdf(title: string, md: string): Blob {
  const w = new Writer();
  w.text(title, { size: 17, bold: true, gap: 3 });
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      w.y += 2;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      w.y += 2;
      w.text(h[2].replace(/\*\*/g, ''), { bold: true, size: h[1].length === 1 ? 14 : h[1].length === 2 ? 12.5 : 11.5 });
      continue;
    }
    const li = line.match(/^(\s*)[-*•]\s+(.*)/);
    const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`/g, '');
    if (li) w.text(`• ${clean(li[2])}`, { indent: 3 + li[1].length * 2, gap: 0.8 });
    else if (/^\|/.test(line)) {
      if (!/^\|\s*-/.test(line)) w.text(clean(line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('  |  ')), { size: 9.5, gap: 0.5 });
    } else w.text(clean(line), { gap: 1 });
  }
  return w.blob();
}
