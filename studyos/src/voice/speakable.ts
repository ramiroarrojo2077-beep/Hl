// Convierte Markdown/LaTeX en texto apto para leer en voz alta.

const LATEX_WORDS: [RegExp, string][] = [
  [/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1 sobre $2'],
  [/\\sqrt\{([^}]*)\}/g, 'raíz de $1'],
  [/\^\{?2\}?/g, ' al cuadrado'],
  [/\^\{?3\}?/g, ' al cubo'],
  [/\^\{([^}]*)\}/g, ' elevado a $1'],
  [/\^(\w)/g, ' elevado a $1'],
  [/_\{([^}]*)\}/g, ' sub $1'],
  [/\\cdot|\\times/g, ' por '],
  [/\\div/g, ' dividido '],
  [/\\pm/g, ' más o menos '],
  [/\\leq?/g, ' menor o igual que '],
  [/\\geq?/g, ' mayor o igual que '],
  [/\\neq/g, ' distinto de '],
  [/\\approx/g, ' aproximadamente '],
  [/\\to|\\rightarrow/g, ' tiende a '],
  [/\\pi/g, ' pi '],
  [/\\Delta/g, ' delta '],
  [/\\alpha/g, ' alfa '],
  [/\\beta/g, ' beta '],
  [/\\theta/g, ' theta '],
  [/\\lambda/g, ' lambda '],
  [/\\mu/g, ' mu '],
  [/\\sum/g, ' sumatoria '],
  [/\\int/g, ' integral '],
  [/\\infty/g, ' infinito '],
  [/\\(left|right|,|;|!|quad|qquad|text|mathrm|mathbf)/g, ' '],
  [/[{}\\]/g, ' '],
];

function latexToSpeech(s: string) {
  let out = s;
  for (const [re, rep] of LATEX_WORDS) out = out.replace(re, rep);
  return out.replace(/=/g, ' igual a ').replace(/\+/g, ' más ').replace(/(?<=\s|\d)-(?=\s|\d)/g, ' menos ').replace(/\*/g, ' por ').replace(/\//g, ' sobre ');
}

export function toSpeakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (ver el código en pantalla) ')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, f) => ` ${latexToSpeech(f)} `)
    .replace(/\$([^$\n]+?)\$/g, (_m, f) => ` ${latexToSpeech(f)} `)
    .replace(/\[\[lab:[^\]]+\]\]/g, ' Podés abrir la simulación en pantalla. ')
    .replace(/\[\[pizarra:[^\]]+\]\]/g, ' Lo podemos desarrollar en la pizarra. ')
    .replace(/\[(?:p|pág|diap|sec)\.?\s*\d+(?:\s*[-–]\s*\d+)?\]/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[*_`>#~]/g, '')
    .replace(/❌|✅|→/g, (m) => (m === '→' ? ', ' : ''))
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function splitSentences(text: string, maxLen = 220): string[] {
  const parts = text.match(/[^.!?¿¡]+[.!?]+|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (p.length <= maxLen) out.push(p);
    else {
      let buf = '';
      for (const w of p.split(/(?<=,)\s+|\s+/)) {
        if ((buf + ' ' + w).length > maxLen) {
          out.push(buf.trim());
          buf = '';
        }
        buf += ' ' + w;
      }
      if (buf.trim()) out.push(buf.trim());
    }
  }
  return out;
}
