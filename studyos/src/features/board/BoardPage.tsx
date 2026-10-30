import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import katex from 'katex';
import { ArrowRight, Circle, Download, Eraser, Image as ImageIcon, MousePointer2, MoveRight, PenTool, Plus, Redo2, Sigma, Sparkles, Square, Trash, Type, Undo2, Volume2, ChartColumn, Check, Minus } from 'lucide-react';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { fileToDataUrl, saveFile } from '@/lib/platform';
import { parseNumber, textMatches } from '@/lib/items';
import { sampleFunction, tryCompile } from '@/lib/mathexpr';
import { timeAgo } from '@/lib/format';
import { Button, IconButton, Input, Modal, Notice, Panel, Select, Spinner, cx } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { boardSteps, judgeStep, type BoardSteps } from '@/ai/agents/whiteboard';
import { aiErrorMessage } from '@/ai/types';
import { aiConfigured, useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { speak, stopSpeaking } from '@/voice/tts';
import { AvatarView } from '@/features/avatar/AvatarView';
import { useAvatar } from '@/features/avatar/store';

type Obj =
  | { id: string; kind: 'path'; pts: [number, number][]; color: string; width: number }
  | { id: string; kind: 'line' | 'arrow' | 'rect' | 'ellipse'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { id: string; kind: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { id: string; kind: 'formula'; x: number; y: number; latex: string; color: string; size: number }
  | { id: string; kind: 'graph'; x: number; y: number; w: number; h: number; expr: string; xMin: number; xMax: number }
  | { id: string; kind: 'image'; x: number; y: number; w: number; h: number; src: string };

type Tool = 'select' | 'pen' | 'eraser' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'formula' | 'graph' | 'image';
const W = 1600;
const H = 1000;
const COLORS = ['#f8fafc', '#5fdcff', '#8ea2ff', '#c4a6ff', '#6ff59b', '#ffd166', '#ff7a7a'];

function bbox(o: Obj): [number, number, number, number] {
  switch (o.kind) {
    case 'path': {
      const xs = o.pts.map((p) => p[0]);
      const ys = o.pts.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return [Math.min(o.x1, o.x2), Math.min(o.y1, o.y2), Math.max(o.x1, o.x2), Math.max(o.y1, o.y2)];
    case 'text':
      return [o.x, o.y - o.size, o.x + o.text.length * o.size * 0.55, o.y + o.size * 0.3];
    case 'formula':
      return [o.x, o.y, o.x + Math.max(120, o.latex.length * o.size * 0.5), o.y + o.size * 2];
    default:
      return [o.x, o.y, o.x + o.w, o.y + o.h];
  }
}

function move(o: Obj, dx: number, dy: number): Obj {
  switch (o.kind) {
    case 'path':
      return { ...o, pts: o.pts.map(([x, y]) => [x + dx, y + dy]) };
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    default:
      return { ...o, x: o.x + dx, y: o.y + dy } as Obj;
  }
}

function Graph({ o }: { o: Extract<Obj, { kind: 'graph' }> }) {
  const d = useMemo(() => {
    const { fn } = tryCompile(o.expr, ['x']);
    if (!fn) return '';
    const pts = sampleFunction(fn, o.xMin, o.xMax, 200);
    const ys = pts.map((p) => p.y).filter((y): y is number => y !== null);
    if (!ys.length) return '';
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys) === yMin ? yMin + 1 : Math.max(...ys);
    let s = '';
    let pen = false;
    for (const p of pts) {
      if (p.y === null) {
        pen = false;
        continue;
      }
      const x = o.x + ((p.x - o.xMin) / (o.xMax - o.xMin)) * o.w;
      const y = o.y + o.h - ((p.y - yMin) / (yMax - yMin)) * o.h;
      s += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      pen = true;
    }
    return s;
  }, [o]);
  const x0 = o.x + ((0 - o.xMin) / (o.xMax - o.xMin)) * o.w;
  return (
    <g>
      <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="rgba(10,16,36,.6)" stroke="rgba(150,165,220,.3)" rx={8} />
      {o.xMin < 0 && o.xMax > 0 && <line x1={x0} x2={x0} y1={o.y} y2={o.y + o.h} stroke="rgba(200,210,255,.35)" />}
      <path d={d} fill="none" stroke="#5fdcff" strokeWidth={3} />
      <text x={o.x + 8} y={o.y + 20} fill="#9fb0e0" fontSize={16} fontFamily="monospace">
        y = {o.expr}
      </text>
    </g>
  );
}

function Render({ o, selected }: { o: Obj; selected: boolean }) {
  const sel = selected ? { filter: 'drop-shadow(0 0 6px #5b7bff)' } : undefined;
  switch (o.kind) {
    case 'path':
      return <polyline points={o.pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={o.color} strokeWidth={o.width} strokeLinecap="round" strokeLinejoin="round" style={sel} />;
    case 'line':
      return <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} stroke={o.color} strokeWidth={o.width} strokeLinecap="round" style={sel} />;
    case 'arrow':
      return <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} stroke={o.color} strokeWidth={o.width} strokeLinecap="round" markerEnd={`url(#arrow-${o.color.slice(1)})`} style={sel} />;
    case 'rect':
      return <rect x={Math.min(o.x1, o.x2)} y={Math.min(o.y1, o.y2)} width={Math.abs(o.x2 - o.x1)} height={Math.abs(o.y2 - o.y1)} fill="none" stroke={o.color} strokeWidth={o.width} rx={6} style={sel} />;
    case 'ellipse':
      return <ellipse cx={(o.x1 + o.x2) / 2} cy={(o.y1 + o.y2) / 2} rx={Math.abs(o.x2 - o.x1) / 2} ry={Math.abs(o.y2 - o.y1) / 2} fill="none" stroke={o.color} strokeWidth={o.width} style={sel} />;
    case 'text':
      return (
        <text x={o.x} y={o.y} fill={o.color} fontSize={o.size} fontFamily="Inter Variable, sans-serif" style={sel}>
          {o.text}
        </text>
      );
    case 'formula': {
      const html = (() => {
        try {
          return katex.renderToString(o.latex, { throwOnError: false, displayMode: true });
        } catch {
          return o.latex;
        }
      })();
      return (
        <foreignObject x={o.x} y={o.y} width={1100} height={o.size * 3} style={sel}>
          <div style={{ color: o.color, fontSize: o.size, lineHeight: 1.2 }} dangerouslySetInnerHTML={{ __html: html }} />
        </foreignObject>
      );
    }
    case 'graph':
      return <Graph o={o} />;
    case 'image':
      return <image href={o.src} x={o.x} y={o.y} width={o.w} height={o.h} preserveAspectRatio="xMidYMid meet" style={sel} />;
  }
}

function equivalent(kind: 'numeric' | 'expression' | 'text', expected: string, answer: string): boolean {
  if (kind === 'numeric') {
    const a = parseNumber(answer);
    const e = parseNumber(expected);
    return a !== null && e !== null && Math.abs(a - e) <= Math.max(Math.abs(e) * 1e-4, 1e-6);
  }
  if (kind === 'expression') {
    const fa = tryCompile(answer.replace(/^.*=/, ''), ['x', 'y']).fn;
    const fe = tryCompile(expected.replace(/^.*=/, ''), ['x', 'y']).fn;
    if (!fa || !fe) return textMatches(answer, [expected]);
    // Comparación numérica en puntos al azar: equivalencia algebraica práctica
    for (let i = 0; i < 12; i++) {
      const s = { x: Math.random() * 6 - 3, y: Math.random() * 6 - 3 };
      const va = fa(s);
      const ve = fe(s);
      if (!Number.isFinite(va) || !Number.isFinite(ve)) continue;
      if (Math.abs(va - ve) > 1e-6 * Math.max(1, Math.abs(ve))) return false;
    }
    return true;
  }
  return textMatches(answer, [expected]);
}

export default function BoardPage() {
  const [params, setParams] = useSearchParams();
  const s = useSettings((x) => x.s);
  const boards = useLiveQuery(() => db.boards.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const [boardId, setBoardId] = useState<string | null>(null);
  const [title, setTitle] = useState('Pizarra');
  const [objs, setObjs] = useState<Obj[]>([]);
  const [past, setPast] = useState<Obj[][]>([]);
  const [future, setFuture] = useState<Obj[][]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Obj | null>(null);
  const [prompt, setPrompt] = useState<{ kind: 'text' | 'formula' | 'graph'; x: number; y: number } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  // Explicación paso a paso
  const [problem, setProblem] = useState(params.get('problem') ?? '');
  const [lesson, setLesson] = useState<BoardSteps | null>(null);
  const [stepIdx, setStepIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [tryValue, setTryValue] = useState('');
  const [tryFeedback, setTryFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const playGesture = useAvatar((a) => a.play);
  const nextY = useRef(120);

  // Carga o crea la pizarra
  useEffect(() => {
    if (boardId) return;
    (async () => {
      const last = (await db.boards.orderBy('updatedAt').reverse().first()) ?? null;
      if (last && !params.get('problem')) {
        setBoardId(last.id);
        setTitle(last.title);
        setObjs(last.objects as Obj[]);
      } else {
        const id = newId();
        await db.boards.add({ id, title: params.get('problem') ? 'Explicación' : 'Pizarra', objects: [], createdAt: Date.now(), updatedAt: Date.now() });
        setBoardId(id);
        setTitle(params.get('problem') ? 'Explicación' : 'Pizarra');
      }
    })();
  }, [boardId, params]);

  // Guardado automático
  useEffect(() => {
    if (!boardId) return;
    const t = setTimeout(() => db.boards.update(boardId, { objects: objs, title, updatedAt: Date.now() }), 400);
    return () => clearTimeout(t);
  }, [objs, title, boardId]);

  const commit = (next: Obj[]) => {
    setPast((p) => [...p.slice(-50), objs]);
    setFuture([]);
    setObjs(next);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [objs, ...f]);
    setObjs(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, objs]);
    setObjs(future[0]);
    setFuture((f) => f.slice(1));
  };

  const pt = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const hit = (x: number, y: number) => [...objs].reverse().find((o) => {
    const [a, b, c, d] = bbox(o);
    return x >= a - 10 && x <= c + 10 && y >= b - 10 && y <= d + 10;
  });

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = pt(e);
    if (tool === 'select') {
      const h = hit(x, y);
      setSelId(h?.id ?? null);
      if (h) {
        drag.current = { x, y };
        setPast((p) => [...p.slice(-50), objs]);
      }
      return;
    }
    if (tool === 'eraser') {
      const h = hit(x, y);
      if (h) commit(objs.filter((o) => o.id !== h.id));
      drag.current = { x, y };
      return;
    }
    if (tool === 'text' || tool === 'formula' || tool === 'graph') {
      setPrompt({ kind: tool, x, y });
      setPromptValue(tool === 'graph' ? 'x^2 - 4' : '');
      return;
    }
    if (tool === 'image') {
      imgRef.current?.click();
      return;
    }
    if (tool === 'pen') setDraft({ id: newId(), kind: 'path', pts: [[x, y]], color, width });
    else setDraft({ id: newId(), kind: tool, x1: x, y1: y, x2: x, y2: y, color, width });
  };
  const onMove = (e: React.PointerEvent) => {
    const [x, y] = pt(e);
    if (tool === 'select' && drag.current && selId) {
      const dx = x - drag.current.x;
      const dy = y - drag.current.y;
      drag.current = { x, y };
      setObjs((os) => os.map((o) => (o.id === selId ? move(o, dx, dy) : o)));
      return;
    }
    if (tool === 'eraser' && drag.current) {
      const h = hit(x, y);
      if (h) setObjs((os) => os.filter((o) => o.id !== h.id));
      return;
    }
    if (!draft) return;
    if (draft.kind === 'path') setDraft({ ...draft, pts: [...draft.pts, [x, y]] });
    else if (draft.kind === 'line' || draft.kind === 'arrow' || draft.kind === 'rect' || draft.kind === 'ellipse') setDraft({ ...draft, x2: x, y2: y });
  };
  const onUp = () => {
    drag.current = null;
    if (draft) {
      const tiny = draft.kind === 'path' ? draft.pts.length < 2 : 'x1' in draft && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 4;
      if (!tiny) commit([...objs, draft]);
      setDraft(null);
    }
  };

  const confirmPrompt = () => {
    if (!prompt || !promptValue.trim()) return setPrompt(null);
    const id = newId();
    const o: Obj =
      prompt.kind === 'text'
        ? { id, kind: 'text', x: prompt.x, y: prompt.y, text: promptValue, color, size: 32 }
        : prompt.kind === 'formula'
          ? { id, kind: 'formula', x: prompt.x, y: prompt.y, latex: promptValue, color, size: 30 }
          : { id, kind: 'graph', x: prompt.x, y: prompt.y, w: 480, h: 300, expr: promptValue, xMin: -6, xMax: 6 };
    if (o.kind === 'graph' && tryCompile(o.expr).error) return toast.error(`Función inválida: ${tryCompile(o.expr).error}`);
    commit([...objs, o]);
    setPrompt(null);
  };

  // ---- Explicación con IA ----
  const explain = async () => {
    if (!problem.trim()) return;
    setLoading(true);
    stopSpeaking();
    try {
      const l = await boardSteps(problem);
      setLesson(l);
      setStepIdx(-1);
      nextY.current = 160;
      commit([...objs, { id: newId(), kind: 'text', x: 60, y: 80, text: l.title.slice(0, 70), color: '#ffd166', size: 38 }]);
      setTitle(l.title.slice(0, 60));
      if (params.get('problem')) setParams({}, { replace: true });
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  const showStep = (i: number) => {
    if (!lesson) return;
    const st = lesson.steps[i];
    const y = nextY.current;
    const items: Obj[] = [{ id: newId(), kind: 'text', x: 60, y, text: `${i + 1}. ${st.title}`, color: '#8ea2ff', size: 26 }];
    if (st.latex) items.push({ id: newId(), kind: 'formula', x: 90, y: y + 10, latex: st.latex, color: '#f8fafc', size: 30 });
    else if (st.text) items.push({ id: newId(), kind: 'text', x: 90, y: y + 50, text: st.text.slice(0, 90), color: '#f8fafc', size: 26 });
    nextY.current = y + (st.latex ? 120 : 90);
    if (nextY.current > H - 60) nextY.current = 160;
    commit([...objs, ...items]);
    setStepIdx(i);
    setTryValue('');
    setTryFeedback(null);
    playGesture('point');
    speak(st.explanation);
  };
  const nextStep = () => lesson && stepIdx + 1 < lesson.steps.length && showStep(stepIdx + 1);
  const pending = lesson && stepIdx + 1 < lesson.steps.length ? lesson.steps[stepIdx + 1] : null;
  const checkTry = async () => {
    if (!pending?.check) return;
    const ok = equivalent(pending.check.kind, pending.check.expected, tryValue);
    if (ok) {
      setTryFeedback({ ok: true, text: '¡Correcto! Así queda en la pizarra.' });
      playGesture('nod');
      setTimeout(() => showStep(stepIdx + 1), 900);
      return;
    }
    if (aiConfigured(s)) {
      try {
        const j = await judgeStep(problem, pending.title, pending.check.expected, tryValue);
        if (j.correct) {
          setTryFeedback({ ok: true, text: j.feedback });
          setTimeout(() => showStep(stepIdx + 1), 1200);
          return;
        }
        setTryFeedback({ ok: false, text: j.feedback });
      } catch {
        setTryFeedback({ ok: false, text: 'No coincide con lo esperado. Revisá el paso o pedí verlo.' });
      }
    } else setTryFeedback({ ok: false, text: 'No coincide con lo esperado. Revisá el paso o pedí verlo.' });
  };

  const exportSvg = async () => {
    const svg = svgRef.current!.cloneNode(true) as SVGSVGElement;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    toast.ok(`Guardada: ${await saveFile(blob, `${title}.svg`)}`);
  };

  const newBoard = async () => {
    const id = newId();
    await db.boards.add({ id, title: 'Pizarra', objects: [], createdAt: Date.now(), updatedAt: Date.now() });
    setBoardId(id);
    setTitle('Pizarra');
    setObjs([]);
    setPast([]);
    setFuture([]);
    setLesson(null);
  };

  const TOOLS: { t: Tool; icon: React.ReactNode; label: string }[] = [
    { t: 'select', icon: <MousePointer2 className="size-4" />, label: 'Mover' },
    { t: 'pen', icon: <PenTool className="size-4" />, label: 'Lápiz' },
    { t: 'eraser', icon: <Eraser className="size-4" />, label: 'Borrar' },
    { t: 'line', icon: <Minus className="size-4" />, label: 'Línea' },
    { t: 'arrow', icon: <MoveRight className="size-4" />, label: 'Flecha' },
    { t: 'rect', icon: <Square className="size-4" />, label: 'Rectángulo' },
    { t: 'ellipse', icon: <Circle className="size-4" />, label: 'Elipse' },
    { t: 'text', icon: <Type className="size-4" />, label: 'Texto' },
    { t: 'formula', icon: <Sigma className="size-4" />, label: 'Fórmula' },
    { t: 'graph', icon: <ChartColumn className="size-4" />, label: 'Gráfico' },
    { t: 'image', icon: <ImageIcon className="size-4" />, label: 'Imagen' },
  ];

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="max-w-xs font-display font-semibold" aria-label="Título de la pizarra" />
          <Select value={boardId ?? ''} onChange={async (e) => { const b = await db.boards.get(e.target.value); if (b) { setBoardId(b.id); setTitle(b.title); setObjs(b.objects as Obj[]); setLesson(null); } }} className="w-auto h-10 text-xs" aria-label="Sesiones guardadas">
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title} · {timeAgo(b.updatedAt)}
              </option>
            ))}
          </Select>
          <Button size="sm" icon={<Plus className="size-4" />} onClick={newBoard}>
            Nueva
          </Button>
          <Button size="sm" icon={<Download className="size-4" />} onClick={exportSvg}>
            SVG
          </Button>
        </div>
        <Panel className="p-2 flex flex-wrap items-center gap-1">
          {TOOLS.map((x) => (
            <IconButton key={x.t} label={x.label} active={tool === x.t} onClick={() => setTool(x.t)}>
              {x.icon}
            </IconButton>
          ))}
          <span className="w-px h-6 bg-line mx-1" />
          {COLORS.map((c) => (
            <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)} className={cx('size-7 rounded-full border-2', color === c ? 'border-white' : 'border-transparent')} style={{ background: c }} />
          ))}
          <select value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Grosor" className="h-8 rounded-lg bg-[#0a102a] border border-line text-xs px-1.5 ml-1">
            {[2, 4, 7, 12].map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </select>
          <span className="w-px h-6 bg-line mx-1" />
          <IconButton label="Deshacer" onClick={undo} disabled={!past.length}>
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton label="Rehacer" onClick={redo} disabled={!future.length}>
            <Redo2 className="size-4" />
          </IconButton>
          {selId && (
            <IconButton label="Eliminar seleccionado" onClick={() => { commit(objs.filter((o) => o.id !== selId)); setSelId(null); }}>
              <Trash className="size-4" />
            </IconButton>
          )}
          <IconButton label="Borrar todo" onClick={() => confirm('¿Borrar toda la pizarra?') && commit([])}>
            <Eraser className="size-4 text-bad" />
          </IconButton>
        </Panel>
        <div className="rounded-2xl overflow-hidden border border-line bg-[#0c1a1f] touch-none">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} style={{ cursor: tool === 'select' ? 'move' : 'crosshair', background: 'linear-gradient(180deg,#102027,#0b1a20)' }}>
            <defs>
              {COLORS.map((c) => (
                <marker key={c} id={`arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={c} />
                </marker>
              ))}
              <pattern id="wb-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0H0V40" fill="none" stroke="rgba(150,200,220,.06)" />
              </pattern>
            </defs>
            <rect width={W} height={H} fill="url(#wb-grid)" />
            {objs.map((o) => (
              <Render key={o.id} o={o} selected={o.id === selId} />
            ))}
            {draft && <Render o={draft} selected={false} />}
          </svg>
        </div>
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 4 * 1024 * 1024) return toast.error('La imagen supera 4 MB.');
            commit([...objs, { id: newId(), kind: 'image', x: 200, y: 200, w: 500, h: 340, src: await fileToDataUrl(f) }]);
            setTool('select');
          }}
        />
      </div>

      <aside className="space-y-3">
        <Panel className="p-4 space-y-3">
          <h2 className="font-display font-semibold">Explicación paso a paso</h2>
          {!aiConfigured(s) && <Notice tone="warn">La explicación automática necesita un proveedor de IA. La pizarra funciona sin IA.</Notice>}
          <div className="flex gap-2">
            <Input value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Ej.: Resolvé x² - 5x + 6 = 0" />
            <Button variant="primary" icon={loading ? <Spinner className="text-white" /> : <Sparkles className="size-4" />} disabled={!problem.trim() || loading || !aiConfigured(s)} onClick={explain} aria-label="Explicar">
              {''}
            </Button>
          </div>
          {lesson && (
            <div className="space-y-3">
              <div className="text-xs text-muted">
                Paso {Math.max(0, stepIdx + 1)} de {lesson.steps.length}
              </div>
              {stepIdx >= 0 && (
                <div className="tile p-3">
                  <div className="text-sm font-medium">{lesson.steps[stepIdx].title}</div>
                  <Markdown className="!text-[13px] mt-1">{lesson.steps[stepIdx].explanation}</Markdown>
                  <button className="mt-1 text-[11px] text-[#8ea2ff] inline-flex items-center gap-1" onClick={() => speak(lesson.steps[stepIdx].explanation)}>
                    <Volume2 className="size-3" /> Escuchar de nuevo
                  </button>
                </div>
              )}
              {pending?.check && (
                <div className="rounded-xl border border-violet/40 bg-violet/10 p-3 space-y-2">
                  <div className="text-sm">Tu turno: {pending.check.prompt}</div>
                  <div className="flex gap-2">
                    <Input value={tryValue} onChange={(e) => setTryValue(e.target.value)} className="font-mono" aria-label="Tu respuesta" />
                    <Button size="md" icon={<Check className="size-4" />} onClick={checkTry} disabled={!tryValue.trim()}>
                      {''}
                    </Button>
                  </div>
                  {tryFeedback && <p className={cx('text-xs', tryFeedback.ok ? 'text-ok' : 'text-warn')}>{tryFeedback.text}</p>}
                </div>
              )}
              {pending ? (
                <Button variant={pending.check ? 'ghost' : 'primary'} icon={<ArrowRight className="size-4" />} onClick={nextStep}>
                  {pending.check ? 'Ver el paso' : stepIdx < 0 ? 'Empezar' : 'Siguiente paso'}
                </Button>
              ) : (
                <p className="text-sm text-ok">Explicación completa. La pizarra quedó guardada.</p>
              )}
            </div>
          )}
        </Panel>
        {lesson && s.avatar.show && (
          <div className="relative h-64 rounded-2xl border border-line-strong bg-[linear-gradient(180deg,#121a44,#0b1029)] overflow-hidden">
            <AvatarView character={s.avatar.character} framing="half" facing={0.5} className="absolute inset-0" />
          </div>
        )}
      </aside>

      <Modal
        open={!!prompt}
        onClose={() => setPrompt(null)}
        title={prompt?.kind === 'text' ? 'Texto' : prompt?.kind === 'formula' ? 'Fórmula (LaTeX)' : 'Graficar función'}
        footer={<Button variant="primary" onClick={confirmPrompt}>Agregar</Button>}
      >
        <Input autoFocus value={promptValue} onChange={(e) => setPromptValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmPrompt()} placeholder={prompt?.kind === 'formula' ? '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}' : prompt?.kind === 'graph' ? 'sin(x) * x' : 'Escribí…'} className="font-mono" />
        {prompt?.kind === 'formula' && promptValue && (
          <div className="mt-3 text-lg" dangerouslySetInnerHTML={{ __html: katex.renderToString(promptValue, { throwOnError: false }) }} />
        )}
      </Modal>
    </div>
  );
}
