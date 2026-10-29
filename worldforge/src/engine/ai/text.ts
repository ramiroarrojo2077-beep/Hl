/** Utilidades de texto compartidas por el planificador y el intérprete de comandos. */

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_.,;:%\-+ \n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const UNITS: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  one: 1,
  a: 1,
  dos: 2,
  two: 2,
  par: 2,
  tres: 3,
  three: 3,
  cuatro: 4,
  four: 4,
  cinco: 5,
  five: 5,
  seis: 6,
  six: 6,
  siete: 7,
  seven: 7,
  ocho: 8,
  eight: 8,
  nueve: 9,
  nine: 9,
  diez: 10,
  ten: 10,
  once: 11,
  eleven: 11,
  doce: 12,
  twelve: 12,
  docena: 12,
  dozen: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  fifteen: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  twenty: 20,
  veinticinco: 25,
  treinta: 30,
  thirty: 30,
  cuarenta: 40,
  forty: 40,
  cincuenta: 50,
  fifty: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  hundred: 100,
  doscientos: 200,
  trescientos: 300,
  quinientos: 500,
  mil: 1000,
};

const TENS_EN: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * Busca una cantidad justo antes de la palabra clave dada (índice de inicio de la
 * palabra en `text`). Acepta dígitos ("20 árboles") y palabras ("veinte árboles",
 * "treinta y cinco").
 */
export function quantityBefore(text: string, index: number): number | null {
  const before = text.slice(Math.max(0, index - 40), index).trim().split(" ");
  const words = before.slice(-4);
  // Dígitos inmediatamente antes (permite un adjetivo en el medio: "20 grandes árboles").
  for (let i = words.length - 1; i >= Math.max(0, words.length - 2); i--) {
    const w = words[i]!;
    if (/^\d+$/.test(w)) return Number(w);
  }
  // Palabras numéricas: "treinta y cinco", "twenty five", "cien".
  let total = 0;
  let found = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w in UNITS) {
      const v = UNITS[w]!;
      if (v === 100 && total > 0 && total < 10) total *= 100;
      else total += v;
      found = true;
    } else if (w in TENS_EN) {
      total += TENS_EN[w]!;
      found = true;
    } else if (w === "y" || w === "and") {
      continue;
    } else {
      total = 0;
      found = false;
    }
  }
  return found && total > 0 ? total : null;
}

/** Primer número que aparece en el texto (dígitos o palabra). */
export function firstNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:[.,]\d+)?/);
  if (m) return Number(m[0].replace(",", "."));
  for (const w of text.split(" ")) if (w in UNITS && w !== "a" && w !== "un" && w !== "una") return UNITS[w]!;
  return null;
}

export function has(text: string, re: RegExp): boolean {
  return re.test(text);
}

/** Primera coincidencia con su posición. */
export function findFirst(text: string, re: RegExp): { index: number; match: string } | null {
  const m = re.exec(text);
  return m ? { index: m.index, match: m[0] } : null;
}

export const COLOR_WORDS: [RegExp, string][] = [
  [/\b(rojo|roja|rojos|rojas|red)\b/, "#c8372d"],
  [/\b(azul|azules|blue)\b/, "#2f5fd0"],
  [/\b(celeste|light blue|sky blue)\b/, "#7cc4f0"],
  [/\b(verde|verdes|green)\b/, "#3f9b4a"],
  [/\b(amarillo|amarilla|yellow)\b/, "#e8c22e"],
  [/\b(naranja|orange)\b/, "#e8792e"],
  [/\b(violeta|morado|morada|purpura|purple|violet)\b/, "#7d4fd6"],
  [/\b(rosa|rosado|rosada|pink)\b/, "#e77fb3"],
  [/\b(blanco|blanca|blancos|blancas|white)\b/, "#eeeeea"],
  [/\b(negro|negra|negros|negras|black)\b/, "#1d1f24"],
  [/\b(gris|grises|gray|grey)\b/, "#8a8f98"],
  [/\b(marron|marrones|cafe|brown)\b/, "#7a5235"],
  [/\b(dorado|dorada|oro|gold|golden)\b/, "#d4a73a"],
  [/\b(plateado|plateada|plata|silver)\b/, "#c4c9d1"],
  [/\b(turquesa|cian|cyan|teal)\b/, "#1fbfb8"],
  [/\b(beige|crema|cream)\b/, "#e3d3b0"],
];

export function findColor(text: string): string | null {
  for (const [re, hex] of COLOR_WORDS) if (re.test(text)) return hex;
  const hex = text.match(/#[0-9a-f]{6}\b/);
  return hex ? hex[0] : null;
}
