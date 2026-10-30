import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Clapperboard, Download, Pause, Play, Plus, RotateCcw, Sparkles, Trash, Wand } from 'lucide-react';
import { db, logActivity } from '@/lib/db';
import { newId } from '@/lib/ids';
import { saveFile } from '@/lib/platform';
import { Badge, Button, EmptyState, Field, IconButton, Input, Modal, Notice, PageHeader, Panel, ProgressBar, Select, Slider, Textarea, Toggle, cx } from '@/components/ui';
import { runJob } from '@/stores/jobs';
import { aiConfigured, useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { directVideo } from '@/ai/agents/video';
import { openaiSpeech } from '@/ai/providers/openai';
import { aiErrorMessage } from '@/ai/types';
import { speak, stopSpeaking } from '@/voice/tts';
import { useVoice, voiceBus } from '@/voice/bus';
import { CHARACTERS } from '@/features/avatar/store';
import { PRESET_LABEL, PRESETS_3D, TEMPLATE_LABEL, TEMPLATES, estimateDuration, type Scene, type VideoScript } from './types';
import { VideoEngine, VH, VW, buildTimeline, pickRecorderMime } from './engine';

function linesToList(s: string) {
  return s.split('\n').map((x) => x.trim()).filter(Boolean);
}

function SceneEditor({ scene, onChange }: { scene: Scene; onChange: (s: Scene) => void }) {
  const set = (p: Partial<Scene>) => onChange({ ...scene, ...p, duration: p.narration !== undefined || p.template ? estimateDuration({ ...scene, ...p }) : scene.duration, ...('duration' in p ? { duration: p.duration! } : {}) });
  return (
    <div className="space-y-3">
      <Field label="Plantilla">
        <Select value={scene.template} onChange={(e) => set({ template: e.target.value as Scene['template'] })}>
          {TEMPLATES.map((t) => (
            <option key={t} value={t}>
              {TEMPLATE_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      {scene.template !== 'quiz' && (
        <Field label="Título de la escena">
          <Input value={scene.heading ?? ''} onChange={(e) => set({ heading: e.target.value })} />
        </Field>
      )}
      <Field label="Narración" hint={`${scene.narration.split(/\s+/).length} palabras · ≈${scene.duration} s`}>
        <Textarea value={scene.narration} onChange={(e) => set({ narration: e.target.value })} className="min-h-24" />
      </Field>
      {scene.template === 'bullets' && (
        <Field label="Ideas (una por línea)">
          <Textarea value={(scene.bullets ?? []).join('\n')} onChange={(e) => set({ bullets: linesToList(e.target.value) })} />
        </Field>
      )}
      {scene.template === 'process' && (
        <Field label="Pasos (uno por línea)">
          <Textarea value={(scene.steps ?? []).join('\n')} onChange={(e) => set({ steps: linesToList(e.target.value) })} />
        </Field>
      )}
      {scene.template === 'diagram' && (
        <>
          <Field label="Conceptos (uno por línea)">
            <Textarea value={(scene.nodes ?? []).join('\n')} onChange={(e) => set({ nodes: linesToList(e.target.value) })} />
          </Field>
          <Field label="Relaciones (A -> B : etiqueta)">
            <Textarea
              value={(scene.edges ?? []).map((x) => `${x.from} -> ${x.to}${x.label ? ` : ${x.label}` : ''}`).join('\n')}
              onChange={(e) =>
                set({
                  edges: linesToList(e.target.value)
                    .map((l) => l.match(/^(.+?)\s*->\s*(.+?)(?:\s*:\s*(.+))?$/))
                    .filter(Boolean)
                    .map((m) => ({ from: m![1], to: m![2], label: m![3] ?? null })),
                })
              }
            />
          </Field>
        </>
      )}
      {scene.template === 'comparison' && (
        <div className="grid grid-cols-2 gap-2">
          {(['left', 'right'] as const).map((k) => (
            <div key={k} className="space-y-2">
              <Input value={scene[k]?.title ?? ''} onChange={(e) => set({ [k]: { title: e.target.value, points: scene[k]?.points ?? [] } })} placeholder={k === 'left' ? 'Lado A' : 'Lado B'} />
              <Textarea value={(scene[k]?.points ?? []).join('\n')} onChange={(e) => set({ [k]: { title: scene[k]?.title ?? '', points: linesToList(e.target.value) } })} placeholder="Un punto por línea" />
            </div>
          ))}
        </div>
      )}
      {scene.template === 'formula' && (
        <>
          <Field label="Fórmula">
            <Input value={scene.formula ?? ''} onChange={(e) => set({ formula: e.target.value })} placeholder="F = m · a" />
          </Field>
          <Field label="Nota">
            <Input value={scene.formulaNote ?? ''} onChange={(e) => set({ formulaNote: e.target.value })} />
          </Field>
        </>
      )}
      {scene.template === 'chart' && (
        <>
          <Field label="Función (opcional, en lugar de barras)">
            <Input value={scene.expression ?? ''} onChange={(e) => set({ expression: e.target.value || null })} placeholder="x^2 - 4" className="font-mono" />
          </Field>
          <Field label="Barras: etiqueta = valor (una por línea)">
            <Textarea
              value={scene.bars ? scene.bars.labels.map((l, i) => `${l} = ${scene.bars!.values[i]}`).join('\n') : ''}
              onChange={(e) => {
                const rows = linesToList(e.target.value).map((l) => l.split('='));
                set({ bars: rows.length ? { labels: rows.map((r) => r[0].trim()), values: rows.map((r) => Number((r[1] ?? '0').replace(',', '.')) || 0), unit: scene.bars?.unit ?? null } : null });
              }}
            />
          </Field>
        </>
      )}
      {scene.template === 'scene3d' && (
        <>
          <Field label="Escena 3D">
            <Select value={scene.preset3d ?? 'orbits'} onChange={(e) => set({ preset3d: e.target.value as Scene['preset3d'] })}>
              {PRESETS_3D.map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rótulos (uno por línea)">
            <Textarea value={(scene.labels3d ?? []).join('\n')} onChange={(e) => set({ labels3d: linesToList(e.target.value) })} />
          </Field>
        </>
      )}
      {scene.template === 'quiz' && (
        <>
          <Field label="Pregunta">
            <Input value={scene.question ?? ''} onChange={(e) => set({ question: e.target.value })} />
          </Field>
          <Field label="Opciones (una por línea)">
            <Textarea value={(scene.options ?? []).join('\n')} onChange={(e) => set({ options: linesToList(e.target.value) })} />
          </Field>
          <Field label="Opción correcta">
            <Select value={scene.answerIndex ?? 0} onChange={(e) => set({ answerIndex: Number(e.target.value) })}>
              {(scene.options ?? []).map((o, i) => (
                <option key={i} value={i}>
                  {String.fromCharCode(65 + i)}) {o}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cámara">
          <Select value={scene.camera ?? 'push'} onChange={(e) => set({ camera: e.target.value as Scene['camera'] })}>
            <option value="static">Fija</option>
            <option value="push">Acercamiento</option>
            <option value="pan">Paneo</option>
            <option value="orbit">Órbita (3D)</option>
          </Select>
        </Field>
        <Field label="Transición">
          <Select value={scene.transition ?? 'fade'} onChange={(e) => set({ transition: e.target.value as Scene['transition'] })}>
            <option value="fade">Fundido</option>
            <option value="slide">Deslizar</option>
            <option value="zoom">Zoom</option>
            <option value="wipe">Barrido</option>
          </Select>
        </Field>
      </div>
      <Slider label="Duración" value={scene.duration} min={3} max={30} step={0.5} onChange={(v) => onChange({ ...scene, duration: v })} format={(v) => `${v} s`} />
    </div>
  );
}

function blankScene(template: Scene['template'] = 'bullets'): Scene {
  const s: Scene = { id: newId(), template, narration: 'Escribí acá lo que dice el narrador en esta escena.', heading: 'Nueva escena', bullets: ['Primera idea', 'Segunda idea'], duration: 6, camera: 'push', transition: 'fade' };
  return s;
}

export default function VideoStudio() {
  const [params] = useSearchParams();
  const s = useSettings((x) => x.s);
  const projects = useLiveQuery(() => db.videos.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const docs = useLiveQuery(() => db.documents.filter((d) => d.status !== 'error' && d.status !== 'processing').toArray(), []) ?? [];
  const [projectId, setProjectId] = useState<string | null>(params.get('id'));
  const project = projects.find((p) => p.id === projectId);
  const [script, setScript] = useState<VideoScript | null>(null);
  const [sel, setSel] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [narrate, setNarrate] = useState(true);
  const [subtitles, setSubtitles] = useState(true);
  const [creating, setCreating] = useState(!params.get('id'));
  const [prompt, setPrompt] = useState('Explicame la separación magnética mediante un video con un científico 3D y ejemplos en una planta de reciclaje');
  const [docId, setDocId] = useState(params.get('doc') ?? '');
  const [target, setTarget] = useState(60);
  const [presenter, setPresenter] = useState<VideoScript['presenter']>(s.avatar.character);
  const [exporting, setExporting] = useState<{ p: number; label: string } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<VideoEngine | null>(null);
  const cancelExport = useRef(false);
  const tRef = useRef(0);
  const voice = useVoice();
  const lastScene = useRef(-1);

  useEffect(() => {
    if (project) setScript(project.script as VideoScript);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardado automático del guion
  useEffect(() => {
    if (!script || !projectId) return;
    const h = setTimeout(() => db.videos.update(projectId, { script, title: script.title, updatedAt: Date.now() }), 500);
    return () => clearTimeout(h);
  }, [script, projectId]);

  const tl = useMemo(() => (script ? buildTimeline(script) : null), [script]);

  // Motor de vista previa
  useEffect(() => {
    if (!script || !canvasRef.current) return;
    const eng = new VideoEngine(canvasRef.current, script);
    engineRef.current = eng;
    let alive = true;
    eng.init().then(() => alive && tl && eng.render(tl, tRef.current));
    return () => {
      alive = false;
      eng.dispose();
      engineRef.current = null;
    };
  }, [script?.presenter, projectId, script === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !script) return;
    eng.script = script;
    eng.subtitles = subtitles;
    if (tl && !playing) eng.render(tl, tRef.current);
  }, [script, subtitles, tl, playing]);

  // Reloj de reproducción: espera a que termine la narración de cada escena
  useEffect(() => {
    if (!playing || !tl) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const idx = tl.scenes.findIndex((x) => tRef.current >= x.start && tRef.current < x.end);
      const scene = tl.scenes[idx];
      const speaking = useVoice.getState().state === 'speaking';
      let nt = tRef.current + dt;
      if (scene && narrate && speaking && nt >= scene.end - 0.05) nt = scene.end - 0.05; // mantiene el cuadro hasta que termine la voz
      if (idx !== lastScene.current && scene) {
        lastScene.current = idx;
        setSel(idx);
        if (narrate) speak(scene.scene.narration);
      }
      if (nt >= tl.duration) {
        nt = tl.duration - 0.001;
        setPlaying(false);
      }
      tRef.current = nt;
      setT(nt);
      engineRef.current?.render(tl, nt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, tl, narrate]);

  const seek = (v: number) => {
    tRef.current = v;
    setT(v);
    lastScene.current = -1;
    stopSpeaking();
    if (tl) engineRef.current?.render(tl, v);
  };

  const generate = () =>
    runJob(
      'Video Director: escribiendo el guion',
      async ({ signal, progress }) => {
        progress(null, 'Planificando escenas');
        const r = await directVideo({ prompt, docId: docId || undefined, targetSeconds: target, presenter, signal });
        const id = newId();
        await db.videos.add({ id, docId: docId || undefined, subjectId: docs.find((d) => d.id === docId)?.subjectId, prompt, title: r.script.title, script: r.script, createdAt: Date.now(), updatedAt: Date.now() });
        await logActivity({ type: 'video', title: `Video: ${r.script.title}`, refId: id, route: `/video?id=${id}` });
        return { id, notes: r.notes };
      },
    ).then((r) => {
      if (!r) return;
      setProjectId(r.id);
      setNotes(r.notes);
      setCreating(false);
      seek(0);
    });

  const createManual = async () => {
    const sc: VideoScript = { title: 'Mi video', style: 'cosmos', presenter, scenes: [{ ...blankScene('title'), heading: 'Mi video educativo', narration: 'Hoy vamos a aprender algo nuevo.' }, blankScene('bullets')] };
    const id = newId();
    await db.videos.add({ id, prompt: '', title: sc.title, script: sc, createdAt: Date.now(), updatedAt: Date.now() });
    setProjectId(id);
    setCreating(false);
  };

  const exportVideo = async () => {
    if (!script) return;
    const useCloud = s.voice.engine === 'openai' && !!s.ai.keys.openai;
    const mime = pickRecorderMime(useCloud);
    if (!mime || !('captureStream' in HTMLCanvasElement.prototype)) return toast.error('Este navegador no permite grabar video desde la app.');
    setPlaying(false);
    stopSpeaking();
    cancelExport.current = false;
    setExporting({ p: 0, label: 'Preparando…' });
    const canvas = document.createElement('canvas');
    const eng = new VideoEngine(canvas, script);
    eng.subtitles = subtitles;
    let audioCtx: AudioContext | null = null;
    try {
      await eng.init();
      const buffers: Record<string, AudioBuffer> = {};
      const durations: Record<string, number> = {};
      if (useCloud) {
        audioCtx = new AudioContext();
        for (let i = 0; i < script.scenes.length; i++) {
          if (cancelExport.current) throw new Error('cancel');
          const sc = script.scenes[i];
          setExporting({ p: (i / script.scenes.length) * 0.2, label: `Generando narración ${i + 1}/${script.scenes.length}` });
          const blob = await openaiSpeech(sc.narration, s.voice.openaiVoice, { apiKey: s.ai.keys.openai!, baseUrl: s.ai.openaiBaseUrl });
          buffers[sc.id] = await audioCtx.decodeAudioData(await blob.arrayBuffer());
          durations[sc.id] = Math.max(sc.duration, buffers[sc.id].duration + 0.6);
        }
      }
      const timeline = buildTimeline(script, durations);
      const stream = canvas.captureStream(30);
      let analyser: AnalyserNode | null = null;
      if (audioCtx) {
        const dest = audioCtx.createMediaStreamDestination();
        analyser = audioCtx.createAnalyser();
        analyser.connect(dest);
        dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
        const t0 = audioCtx.currentTime + 0.25;
        for (const it of timeline.scenes) {
          const b = buffers[it.scene.id];
          if (!b) continue;
          const src = audioCtx.createBufferSource();
          src.buffer = b;
          src.connect(analyser);
          src.start(t0 + it.start + 0.3);
        }
      }
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.start(500);
      const start = performance.now() + (audioCtx ? 250 : 0);
      const buf = new Uint8Array(512);
      await new Promise<void>((resolve) => {
        const loop = () => {
          const t = Math.max(0, (performance.now() - start) / 1000);
          const cur = timeline.scenes.find((x) => t >= x.start && t < x.end);
          // Mueve la boca del presentador: por volumen real (audio) o por el texto de la narración.
          if (cur) {
            if (analyser) {
              analyser.getByteTimeDomainData(buf);
              let sum = 0;
              for (const v of buf) sum += ((v - 128) / 128) ** 2;
              voiceBus.set({ state: 'speaking', level: Math.min(1, Math.sqrt(sum / buf.length) * 4), utterance: { text: cur.scene.narration, startedAt: 0, cps: 14, charIndex: Math.floor(((t - cur.start) / (cur.end - cur.start)) * cur.scene.narration.length), charAt: performance.now() } });
            } else {
              const len = cur.scene.narration.length;
              const ci = Math.floor(((t - cur.start) / Math.max(0.5, cur.end - cur.start - 0.5)) * len);
              voiceBus.set({ state: ci < len ? 'speaking' : 'idle', level: null, utterance: ci < len ? { text: cur.scene.narration, startedAt: 0, cps: 0, charIndex: ci, charAt: performance.now() } : null });
            }
          }
          eng.render(timeline, Math.min(t, timeline.duration - 0.001));
          setExporting({ p: 0.2 + 0.8 * Math.min(1, t / timeline.duration), label: `Grabando ${Math.floor(t)} / ${Math.ceil(timeline.duration)} s` });
          if (t >= timeline.duration || cancelExport.current) return resolve();
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      rec.stop();
      await done;
      if (cancelExport.current) throw new Error('cancel');
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const where = await saveFile(blob, `${script.title}.${ext}`);
      toast.ok(`Video exportado (${(blob.size / 1024 / 1024).toFixed(1)} MB): ${where}`);
    } catch (e) {
      if ((e as Error).message !== 'cancel') toast.error(`No se pudo exportar: ${aiErrorMessage(e)}`);
      else toast.info('Exportación cancelada');
    } finally {
      voiceBus.set({ state: 'idle', utterance: null, level: null });
      eng.dispose();
      audioCtx?.close();
      setExporting(null);
    }
  };

  const updateScene = (i: number, sc: Scene) => script && setScript({ ...script, scenes: script.scenes.map((x, j) => (j === i ? sc : x)) });
  const moveScene = (i: number, d: number) => {
    if (!script) return;
    const j = i + d;
    if (j < 0 || j >= script.scenes.length) return;
    const sc = [...script.scenes];
    [sc[i], sc[j]] = [sc[j], sc[i]];
    setScript({ ...script, scenes: sc });
    setSel(j);
  };

  const fmtT = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  const cloud = s.voice.engine === 'openai' && !!s.ai.keys.openai;

  return (
    <div>
      <PageHeader
        title="Estudio de video"
        subtitle="Guion con IA, escenas animadas sobre plantillas (tipografía cinética, diagramas, procesos, gráficos y escenas 3D), narración y exportación."
        icon={<Clapperboard className="size-5" />}
        actions={
          <>
            <Select value={projectId ?? ''} onChange={(e) => { setProjectId(e.target.value || null); setCreating(!e.target.value); seek(0); }} className="w-auto h-10 text-xs" aria-label="Proyecto">
              <option value="">Nuevo video…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
            {script && (
              <Button variant="primary" icon={<Download className="size-4" />} onClick={exportVideo} disabled={!!exporting}>
                Exportar
              </Button>
            )}
          </>
        }
      />

      {creating || !script ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel className="p-5 space-y-4">
            {!aiConfigured(s) && <Notice tone="warn">El guion automático necesita un proveedor de IA. También podés armar el video escena por escena a mano.</Notice>}
            <Field label="¿Qué video querés?">
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-24" />
            </Field>
            <Field label="Usar como fuente (opcional)">
              <Select value={docId} onChange={(e) => setDocId(e.target.value)}>
                <option value="">Ninguno</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Slider label="Duración aproximada" value={target} min={30} max={180} step={15} onChange={setTarget} format={(v) => `${v} s`} />
              <Field label="Presentador 3D">
                <Select value={presenter ?? ''} onChange={(e) => setPresenter((e.target.value || null) as VideoScript['presenter'])}>
                  <option value="">Sin presentador</option>
                  {Object.entries(CHARACTERS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={!aiConfigured(s) || !prompt.trim()} onClick={generate}>
                Generar guion y escenas
              </Button>
              <Button icon={<Wand className="size-4" />} onClick={createManual}>
                Crear a mano
              </Button>
            </div>
          </Panel>
          <Panel className="p-4 space-y-2 text-sm">
            <h3 className="font-display font-semibold">Qué puede generar el motor</h3>
            <ul className="list-disc pl-4 space-y-1 text-[13px] text-[#cdd5f0]">
              <li>Plantillas: {TEMPLATES.map((x) => TEMPLATE_LABEL[x]).join(', ')}.</li>
              <li>Escenas 3D: {PRESETS_3D.map((x) => PRESET_LABEL[x].split(' (')[0]).join('; ')}.</li>
              <li>Presentador 3D con gestos y boca animada.</li>
              <li>Narración: voz del dispositivo en la vista previa. Para que la voz quede dentro del archivo exportado hace falta la voz de OpenAI (Configuración → Voz).</li>
            </ul>
            <p className="text-[11px] text-faint">No genera video fotorrealista ni personajes o lugares arbitrarios: si el pedido los menciona, el guion los representa con diagramas y escenas disponibles.</p>
          </Panel>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3 min-w-0">
            {notes.length > 0 && <Notice tone="warn">{notes.join(' ')}</Notice>}
            <Input value={script.title} onChange={(e) => setScript({ ...script, title: e.target.value })} className="font-display font-semibold" aria-label="Título del video" />
            <div className="rounded-2xl overflow-hidden border border-line bg-black aspect-video">
              <canvas ref={canvasRef} width={VW} height={VH} className="w-full h-full block" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={() => { if (!playing && tl && tRef.current >= tl.duration - 0.05) seek(0); if (playing) stopSpeaking(); setPlaying(!playing); }}>
                {playing ? 'Pausar' : 'Reproducir'}
              </Button>
              <IconButton label="Desde el principio" onClick={() => { setPlaying(false); seek(0); }}>
                <RotateCcw className="size-4" />
              </IconButton>
              <input type="range" min={0} max={tl?.duration ?? 1} step={0.05} value={t} onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} className="flex-1 min-w-40" aria-label="Posición" />
              <span className="font-mono text-xs text-muted">
                {fmtT(t)} / {fmtT(tl?.duration ?? 0)}
              </span>
            </div>
            <div className="flex flex-wrap gap-4">
              <Toggle label="Narración en la vista previa" checked={narrate} onChange={setNarrate} />
              <Toggle label="Subtítulos" checked={subtitles} onChange={setSubtitles} />
              <Field label="Presentador">
                <Select value={script.presenter ?? ''} onChange={(e) => setScript({ ...script, presenter: (e.target.value || null) as VideoScript['presenter'] })} className="h-9 text-xs">
                  <option value="">Sin presentador</option>
                  {Object.entries(CHARACTERS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {voice.state === 'speaking' && voice.subtitle && <p className="text-xs text-muted">Narrando: «{voice.subtitle}»</p>}
            <div className="flex gap-2 overflow-x-auto scroll-thin pb-2">
              {script.scenes.map((sc, i) => (
                <button key={sc.id} onClick={() => { setSel(i); if (tl) seek(tl.scenes[i].start + 0.6); }} className={cx('shrink-0 w-44 tile p-2.5 text-left', sel === i && 'nav-active')}>
                  <div className="flex items-center justify-between">
                    <Badge>{i + 1}</Badge>
                    <span className="text-[10px] text-muted">{sc.duration} s</span>
                  </div>
                  <div className="text-xs font-medium mt-1.5 truncate">{TEMPLATE_LABEL[sc.template]}</div>
                  <div className="text-[11px] text-muted line-clamp-2">{sc.heading || sc.question || sc.narration}</div>
                </button>
              ))}
              <button onClick={() => { setScript({ ...script, scenes: [...script.scenes, blankScene()] }); setSel(script.scenes.length); }} className="shrink-0 w-24 rounded-xl border border-dashed border-line-strong grid place-items-center text-muted hover:text-ink" aria-label="Agregar escena">
                <Plus className="size-5" />
              </button>
            </div>
          </div>
          <Panel className="p-4 space-y-3 max-h-[calc(100dvh-140px)] overflow-y-auto scroll-thin">
            {script.scenes[sel] ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-semibold">Escena {sel + 1}</h3>
                  <div className="flex">
                    <IconButton label="Subir" onClick={() => moveScene(sel, -1)}>
                      <ArrowUp className="size-4" />
                    </IconButton>
                    <IconButton label="Bajar" onClick={() => moveScene(sel, 1)}>
                      <ArrowDown className="size-4" />
                    </IconButton>
                    <IconButton label="Eliminar escena" disabled={script.scenes.length <= 1} onClick={() => { setScript({ ...script, scenes: script.scenes.filter((_, j) => j !== sel) }); setSel(Math.max(0, sel - 1)); }}>
                      <Trash className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <SceneEditor key={script.scenes[sel].id} scene={script.scenes[sel]} onChange={(sc) => updateScene(sel, sc)} />
              </>
            ) : (
              <EmptyState icon={<Clapperboard className="size-6" />} title="Sin escenas" text="Agregá una escena." />
            )}
            <Notice>{cloud ? 'La exportación incluye la narración con voz de OpenAI.' : 'La exportación incluye animaciones y subtítulos. La voz del dispositivo no se puede grabar dentro del archivo: activá la voz de OpenAI en Configuración para incluir narración.'}</Notice>
            <Button
              variant="ghost"
              icon={<Trash className="size-4" />}
              onClick={async () => {
                if (!projectId || !confirm('¿Eliminar este video?')) return;
                await db.videos.delete(projectId);
                setProjectId(null);
                setScript(null);
                setCreating(true);
              }}
            >
              Eliminar proyecto
            </Button>
          </Panel>
        </div>
      )}
      <Modal open={!!exporting} onClose={() => {}} title="Exportando video">
        <div className="space-y-3">
          <ProgressBar value={exporting?.p ?? 0} />
          <p className="text-sm">{exporting?.label}</p>
          <p className="text-xs text-muted">La grabación se hace en tiempo real: dejá la app abierta y en primer plano hasta que termine.</p>
          <Button variant="danger" onClick={() => (cancelExport.current = true)}>
            Cancelar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
