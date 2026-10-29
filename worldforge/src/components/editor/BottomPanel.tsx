"use client";

import { useEffect, useRef, useState } from "react";
import { round } from "@/engine/math";
import { upsertKey } from "@/engine/scene/animation";
import { useEditor } from "@/store/editor";
import { canvasState } from "../viewport/Viewport";
import { exportImageSequence } from "./actions";
import { Button, IconButton, NumberField, Tabs, cx } from "../ui/controls";
import { Icon } from "../ui/Icon";

export function BottomPanel() {
  const tab = useEditor((s) => s.ui.bottomTab);
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex items-center justify-between">
        <Tabs
          value={tab}
          onChange={(v) => useEditor.getState().setUi({ bottomTab: v })}
          items={[
            { id: "timeline", label: "Línea de tiempo", icon: "film" },
            { id: "console", label: "Consola", icon: "terminal" },
            { id: "generation", label: "Generación", icon: "activity" },
          ]}
          className="flex-1"
        />
        <IconButton icon="chevronDown" label="Ocultar panel" size="sm" onClick={() => useEditor.getState().setUi({ bottomOpen: false })} className="mr-2" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "timeline" && <Timeline />}
        {tab === "console" && <Console />}
        {tab === "generation" && <GenerationStatus />}
      </div>
    </div>
  );
}

export function Console() {
  const logs = useEditor((s) => s.logs);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [logs.length]);
  return (
    <div ref={ref} className="h-full overflow-auto px-3 py-2 font-mono text-[11px]" data-testid="console">
      {logs.length === 0 && <p className="text-muted">Sin mensajes.</p>}
      {logs.map((l) => (
        <div key={l.id} className={cx("flex gap-2 py-0.5", l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warn" : l.level === "success" ? "text-ok" : "text-muted")}>
          <span className="shrink-0 text-muted/60 tabular-nums">{new Date(l.at).toLocaleTimeString()}</span>
          <span className="break-words">{l.message}</span>
        </div>
      ))}
    </div>
  );
}

export function GenerationStatus() {
  const gen = useEditor((s) => s.generation);
  if (!gen) return <p className="p-3 text-xs text-muted">Todavía no se generó ningún mundo en esta sesión.</p>;
  const done = gen.stages.filter((s) => s.status === "done").length;
  return (
    <div className="h-full overflow-auto p-3 text-xs" data-testid="generation-status">
      <p className="mb-2 truncate text-muted">“{gen.prompt}”</p>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-gradient-to-r from-accent to-accent-2 transition-all" style={{ width: `${(done / gen.stages.length) * 100}%` }} />
      </div>
      <ol className="grid gap-1 sm:grid-cols-2">
        {gen.stages.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            {s.status === "done" ? <Icon name="check" size={13} className="text-ok" /> : s.status === "running" ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" /> : <span className="h-3 w-3 rounded-full border border-line" />}
            <span className={s.status === "pending" ? "text-muted" : ""}>{s.label}</span>
            {s.ms !== undefined && <span className="ml-auto text-muted tabular-nums">{s.ms} ms</span>}
          </li>
        ))}
      </ol>
      {gen.error && <p className="mt-2 text-danger">{gen.error}</p>}
    </div>
  );
}

/** Línea de tiempo: reproducción, claves de cámara y de objetos, velocidad. */
export function Timeline() {
  const doc = useEditor((s) => s.doc);
  const pb = useEditor((s) => s.playback);
  const selection = useEditor((s) => s.selection);
  const bar = useRef<HTMLDivElement>(null);
  const [dragKey, setDragKey] = useState<{ track: string; index: number } | null>(null);
  if (!doc) return null;
  const anim = doc.animation;
  const dur = anim.duration;
  const setPb = (patch: Partial<typeof pb>) => useEditor.setState({ playback: { ...pb, ...patch } });
  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur));
  };
  const tracks = anim.tracks.filter((t) => !selection.length || selection.includes(t.entityId));

  const addCameraKey = () => {
    const st = canvasState.current;
    if (!st) return;
    const p = st.camera.position;
    const dir = st.camera.getWorldDirection(p.clone());
    const target = p.clone().addScaledVector(dir, 30);
    const t = round(pb.time, 2);
    useEditor.getState().exec(`Clave de cámara en ${t}s`, (d) => {
      d.animation.camera = d.animation.camera.filter((k) => Math.abs(k.t - t) > 1e-3);
      d.animation.camera.push({ t, position: [round(p.x), round(p.y), round(p.z)], target: [round(target.x), round(target.y), round(target.z)], fov: 50 });
      d.animation.camera.sort((a, b) => a.t - b.t);
    });
  };

  const addSelectionKeys = () => {
    const t = round(pb.time, 2);
    useEditor.getState().exec(`Claves en ${t}s`, (d) => {
      for (const id of selection) {
        const ent = d.entities[id];
        if (!ent) continue;
        for (const prop of ["position", "rotation", "scale"] as const) {
          let track = d.animation.tracks.find((tr) => tr.entityId === id && tr.property === prop);
          if (!track) {
            track = { id: `${id}_${prop}`, entityId: id, property: prop, keys: [] };
            d.animation.tracks.push(track);
          }
          track.keys = upsertKey(track.keys, { t, value: [...ent.transform[prop]], ease: "smooth" });
        }
      }
    });
  };

  const scrubStart = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setPb({ time: timeAt(e.clientX), playing: false });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="timeline">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <IconButton icon={pb.playing ? "pause" : "play"} label={pb.playing ? "Pausa" : "Reproducir"} size="sm" onClick={() => setPb({ playing: !pb.playing })} testId="timeline-play" />
        <IconButton icon="stop" label="Detener" size="sm" onClick={() => setPb({ playing: false, time: 0, cameraOverride: false })} />
        <span className="w-20 font-mono text-[11px] tabular-nums">
          {pb.time.toFixed(2)} / {dur}s
        </span>
        <select className="rounded border border-line bg-surface px-1 py-0.5 text-[11px]" value={pb.speed} onChange={(e) => setPb({ speed: Number(e.target.value) })}>
          {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <button
          className={cx("ml-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px]", pb.cameraOverride ? "bg-accent/25 text-text" : "text-muted hover:bg-surface-2")}
          onClick={() => setPb({ cameraOverride: !pb.cameraOverride })}
          title="La cámara del visor sigue la trayectoria cinematográfica"
          data-testid="timeline-cinematic"
        >
          <Icon name="camera" size={13} /> Vista cinematográfica
        </button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" icon="camera" onClick={addCameraKey} className="px-2 py-1 text-[11px]">
            Clave de cámara
          </Button>
          <Button variant="ghost" icon="diamond" onClick={addSelectionKeys} disabled={!selection.length} className="px-2 py-1 text-[11px]">
            Clave de selección
          </Button>
          <span className="text-[11px] text-muted">Duración</span>
          <div className="w-16">
            <NumberField value={dur} min={1} max={3600} step={1} decimals={0} onCommit={(v) => useEditor.getState().exec("Duración de animación", (d) => void (d.animation.duration = v))} />
          </div>
          <Button variant="ghost" icon="image" onClick={() => void exportImageSequence()} className="px-2 py-1 text-[11px]">
            Secuencia PNG
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-1 text-[11px]">
        <div className="grid grid-cols-[130px_1fr] items-center gap-x-2">
          <div />
          <div ref={bar} className="relative h-5 cursor-ew-resize border-b border-line" onPointerDown={scrubStart} onPointerMove={(e) => e.buttons === 1 && setPb({ time: timeAt(e.clientX) })}>
            {Array.from({ length: Math.min(60, Math.floor(dur)) + 1 }, (_, i) => (i * dur) / Math.min(60, Math.floor(dur))).map((t, i) => (
              <span key={i} className="absolute bottom-0 h-2 border-l border-line" style={{ left: `${(t / dur) * 100}%` }}>
                {i % 5 === 0 && <span className="absolute -top-3 left-0.5 text-[9px] text-muted">{Math.round(t)}</span>}
              </span>
            ))}
            <span className="pointer-events-none absolute top-0 bottom-[-400px] z-10 w-px bg-accent-2" style={{ left: `${(pb.time / dur) * 100}%` }} />
          </div>
          <TrackRow label="Cámara" icon="camera" keys={anim.camera.map((k) => k.t)} dur={dur} onKeyClick={(t) => setPb({ time: t })} onKeyDelete={(i) => useEditor.getState().exec("Borrar clave de cámara", (d) => void d.animation.camera.splice(i, 1))} onKeyDrag={(i, t) => useEditor.getState().exec("Mover clave", (d) => {
            d.animation.camera[i]!.t = round(t, 2);
            d.animation.camera.sort((a, b) => a.t - b.t);
          })} bar={bar} dragKey={dragKey} setDragKey={setDragKey} trackId="camera" />
          {tracks.slice(0, 40).map((tr) => (
            <TrackRow
              key={tr.id}
              trackId={tr.id}
              label={`${doc.entities[tr.entityId]?.name ?? "?"} · ${tr.property}`}
              icon="diamond"
              keys={tr.keys.map((k) => k.t)}
              dur={dur}
              bar={bar}
              dragKey={dragKey}
              setDragKey={setDragKey}
              onKeyClick={(t) => setPb({ time: t })}
              onKeyDelete={(i) =>
                useEditor.getState().exec("Borrar clave", (d) => {
                  const t = d.animation.tracks.find((x) => x.id === tr.id);
                  if (!t) return;
                  t.keys.splice(i, 1);
                  if (!t.keys.length) d.animation.tracks = d.animation.tracks.filter((x) => x.id !== tr.id);
                })
              }
              onKeyDrag={(i, t) =>
                useEditor.getState().exec("Mover clave", (d) => {
                  const x = d.animation.tracks.find((y) => y.id === tr.id);
                  if (!x) return;
                  x.keys[i]!.t = round(t, 2);
                  x.keys.sort((a, b) => a.t - b.t);
                })
              }
            />
          ))}
        </div>
        {!anim.camera.length && !tracks.length && <p className="mt-2 text-muted">Sin claves. Agregá claves de cámara o de la selección, o pedile a la IA “creá una animación cinematográfica”.</p>}
      </div>
    </div>
  );
}

function TrackRow({
  label,
  icon,
  keys,
  dur,
  onKeyClick,
  onKeyDelete,
  onKeyDrag,
  bar,
  dragKey,
  setDragKey,
  trackId,
}: {
  label: string;
  icon: "camera" | "diamond";
  keys: number[];
  dur: number;
  onKeyClick: (t: number) => void;
  onKeyDelete: (i: number) => void;
  onKeyDrag: (i: number, t: number) => void;
  bar: React.RefObject<HTMLDivElement | null>;
  dragKey: { track: string; index: number } | null;
  setDragKey: (k: { track: string; index: number } | null) => void;
  trackId: string;
}) {
  return (
    <>
      <div className="flex items-center gap-1 truncate py-1 text-muted">
        <Icon name={icon} size={11} />
        <span className="truncate">{label}</span>
      </div>
      <div className="relative h-6 rounded bg-surface/60">
        {keys.map((t, i) => (
          <button
            key={i}
            title={`${t.toFixed(2)} s · clic: ir · doble clic: borrar · arrastrar: mover`}
            className={cx("absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border", dragKey?.track === trackId && dragKey.index === i ? "border-white bg-accent-2" : "border-accent bg-accent/70 hover:bg-accent-2")}
            style={{ left: `${(t / dur) * 100}%` }}
            onClick={() => onKeyClick(t)}
            onDoubleClick={() => onKeyDelete(i)}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDragKey({ track: trackId, index: i });
            }}
            onPointerUp={(e) => {
              if (dragKey?.track === trackId && dragKey.index === i && bar.current) {
                const r = bar.current.getBoundingClientRect();
                const nt = Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
                if (Math.abs(nt - t) > 0.05) onKeyDrag(i, nt);
              }
              setDragKey(null);
            }}
          />
        ))}
      </div>
    </>
  );
}
