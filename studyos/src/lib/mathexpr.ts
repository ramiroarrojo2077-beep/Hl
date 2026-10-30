// Parser de expresiones matemáticas seguro (sin eval) para graficar funciones,
// superficies y verificar resultados. Soporta + - * / ^, paréntesis, unario,
// multiplicación implícita (2x, 3(x+1)), funciones y constantes.

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'un'; op: '-' | '+'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sen: Math.sin, tg: Math.tan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, raiz: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };

interface Tok { k: 'num' | 'id' | 'op' | '(' | ')' | ','; v: string }

function lex(src: string): Tok[] {
  const s = src.replace(/\*\*/g, '^').replace(/×|·/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/²/g, '^2').replace(/³/g, '^3');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === 'e' && /[0-9+-]/.test(s[j + 1] ?? '') && !/[a-z]/i.test(s[j + 2] ?? '')) {
        j++;
        if (/[+-]/.test(s[j])) j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      out.push({ k: 'num', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Zπ_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Zπ_0-9]/.test(s[j])) j++;
      out.push({ k: 'id', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    if (c === '(' || c === '[') { out.push({ k: '(', v: '(' }); i++; continue; }
    if (c === ')' || c === ']') { out.push({ k: ')', v: ')' }); i++; continue; }
    if (c === ',' || c === ';') { out.push({ k: ',', v: ',' }); i++; continue; }
    throw new Error(`Carácter no válido: "${c}"`);
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[], private vars: Set<string>) {}
  parse(): Node {
    const n = this.expr();
    if (this.i < this.toks.length) throw new Error('Expresión incompleta o con símbolos de más');
    return n;
  }
  private peek() { return this.toks[this.i]; }
  private expr(): Node {
    let a = this.term();
    while (this.peek()?.k === 'op' && (this.peek().v === '+' || this.peek().v === '-')) {
      const op = this.toks[this.i++].v as '+' | '-';
      a = { t: 'bin', op, a, b: this.term() };
    }
    return a;
  }
  private term(): Node {
    let a = this.unary();
    for (;;) {
      const p = this.peek();
      if (p?.k === 'op' && (p.v === '*' || p.v === '/')) {
        this.i++;
        a = { t: 'bin', op: p.v as '*' | '/', a, b: this.unary() };
      } else if (p && (p.k === 'num' || p.k === 'id' || p.k === '(')) {
        a = { t: 'bin', op: '*', a, b: this.unary() }; // multiplicación implícita
      } else break;
    }
    return a;
  }
  private unary(): Node {
    const p = this.peek();
    if (p?.k === 'op' && (p.v === '-' || p.v === '+')) {
      this.i++;
      return { t: 'un', op: p.v as '-' | '+', a: this.unary() };
    }
    return this.power();
  }
  private power(): Node {
    const base = this.atom();
    if (this.peek()?.k === 'op' && this.peek().v === '^') {
      this.i++;
      return { t: 'bin', op: '^', a: base, b: this.unary() };
    }
    return base;
  }
  private atom(): Node {
    const p = this.toks[this.i++];
    if (!p) throw new Error('Falta un valor al final');
    if (p.k === 'num') {
      const v = Number(p.v);
      if (!Number.isFinite(v)) throw new Error(`Número inválido: ${p.v}`);
      return { t: 'num', v };
    }
    if (p.k === '(') {
      const n = this.expr();
      if (this.toks[this.i++]?.k !== ')') throw new Error('Falta cerrar paréntesis');
      return n;
    }
    if (p.k === 'id') {
      const name = p.v.toLowerCase();
      if (this.peek()?.k === '(' && FUNCS[name]) {
        this.i++;
        const args: Node[] = [this.expr()];
        while (this.peek()?.k === ',') { this.i++; args.push(this.expr()); }
        if (this.toks[this.i++]?.k !== ')') throw new Error('Falta cerrar paréntesis de función');
        return { t: 'call', fn: name, args };
      }
      if (this.vars.has(name)) return { t: 'var', name };
      if (name in CONSTS) return { t: 'num', v: CONSTS[name] };
      // Variables pegadas: "xy" → x*y
      if ([...name].every((ch) => this.vars.has(ch))) {
        return [...name].map((ch) => ({ t: 'var', name: ch }) as Node).reduce((a, b) => ({ t: 'bin', op: '*', a, b }));
      }
      throw new Error(`Nombre desconocido: "${p.v}"`);
    }
    throw new Error(`Símbolo inesperado: "${p.v}"`);
  }
}

function evalNode(n: Node, scope: Record<string, number>): number {
  switch (n.t) {
    case 'num': return n.v;
    case 'var': return scope[n.name] ?? NaN;
    case 'un': return n.op === '-' ? -evalNode(n.a, scope) : evalNode(n.a, scope);
    case 'bin': {
      const a = evalNode(n.a, scope);
      const b = evalNode(n.b, scope);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '^': return Math.pow(a, b);
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'call': return FUNCS[n.fn](...n.args.map((x) => evalNode(x, scope)));
  }
}

export type CompiledFn = (scope: Record<string, number>) => number;

export function compile(expr: string, vars: string[] = ['x']): CompiledFn {
  let src = expr.trim();
  // Acepta "y = ..." o "f(x) = ..." o "z = ..."
  src = src.replace(/^\s*(?:[a-z]\s*\([a-z, ]+\)|[yz])\s*=\s*/i, '');
  const ast = new Parser(lex(src), new Set(vars.map((v) => v.toLowerCase()))).parse();
  return (scope) => evalNode(ast, scope);
}

export function tryCompile(expr: string, vars: string[] = ['x']): { fn?: CompiledFn; error?: string } {
  try {
    return { fn: compile(expr, vars) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Muestrea y = f(x) en [xMin, xMax], cortando en discontinuidades. */
export function sampleFunction(fn: CompiledFn, xMin: number, xMax: number, n = 240): { x: number; y: number | null }[] {
  const out: { x: number; y: number | null }[] = [];
  for (let i = 0; i <= n; i++) {
    const x = xMin + ((xMax - xMin) * i) / n;
    const y = fn({ x });
    out.push({ x, y: Number.isFinite(y) && Math.abs(y) < 1e6 ? y : null });
  }
  return out;
}
