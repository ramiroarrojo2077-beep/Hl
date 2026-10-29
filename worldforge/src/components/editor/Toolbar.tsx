"use client";

import { useEditor } from "@/store/editor";
import { useRuntime } from "@/store/runtime";
import { IconButton, cx } from "../ui/controls";

/** Herramientas de transformación y cámara, flotando sobre el visor. */
export function Toolbar({ vertical }: { vertical?: boolean }) {
  const tool = useEditor((s) => s.tool);
  const space = useEditor((s) => s.space);
  const snap = useEditor((s) => s.snap);
  const sim = useEditor((s) => s.simPlaying);
  const camMode = useEditor((s) => s.cameraMode);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const set = useEditor.getState();
  return (
    <div className={cx("glass flex gap-0.5 rounded-xl border border-line p-1 shadow-lg", vertical ? "flex-col" : "flex-row items-center")} data-testid="toolbar">
      <IconButton icon="cursor" label="Seleccionar (Q)" active={tool === "select"} onClick={() => set.setTool("select")} testId="tool-select" />
      <IconButton icon="move" label="Mover (W)" active={tool === "move"} onClick={() => set.setTool("move")} testId="tool-move" />
      <IconButton icon="rotate" label="Rotar (E)" active={tool === "rotate"} onClick={() => set.setTool("rotate")} testId="tool-rotate" />
      <IconButton icon="scale" label="Escalar (R)" active={tool === "scale"} onClick={() => set.setTool("scale")} testId="tool-scale" />
      <IconButton icon="brush" label="Terreno (T)" active={tool === "terrain"} onClick={() => { set.setTool("terrain"); set.setUi({ leftTab: "tools", sheet: "tools" }); }} testId="tool-terrain" />
      <span className={cx("bg-line", vertical ? "mx-1 my-1 h-px" : "mx-1 h-6 w-px")} />
      <IconButton icon="globe" label={space === "world" ? "Espacio: mundo" : "Espacio: local"} active={space === "local"} onClick={() => useEditor.setState({ space: space === "world" ? "local" : "world" })} />
      <IconButton icon="magnet" label="Ajustar a cuadrícula" active={snap.grid} onClick={() => useEditor.setState({ snap: { ...snap, grid: !snap.grid } })} testId="toggle-snap" />
      <IconButton icon="focus" label="Encuadrar (F)" onClick={() => set.setUi({ focusToken: Date.now() })} />
      <IconButton icon={camMode === "orbit" ? "compass" : camMode === "fly" ? "camera" : camMode === "firstperson" ? "user" : "film"} label={`Cámara: ${camMode}`} onClick={() => {
        const order = ["orbit", "fly", "firstperson", "cinematic"] as const;
        useEditor.setState({ cameraMode: order[(order.indexOf(camMode) + 1) % order.length]! });
      }} testId="camera-mode" />
      <span className={cx("bg-line", vertical ? "mx-1 my-1 h-px" : "mx-1 h-6 w-px")} />
      <IconButton icon={sim ? "pause" : "play"} label={sim ? "Pausar simulación" : "Reanudar simulación"} active={sim} onClick={() => useEditor.setState({ simPlaying: !sim })} testId="toggle-sim" />
      <IconButton icon="undo" label="Deshacer (Ctrl+Z)" disabled={!canUndo} onClick={() => set.undo()} testId="undo" />
      <IconButton icon="redo" label="Rehacer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => set.redo()} testId="redo" />
    </div>
  );
}

export function StatsOverlay() {
  const s = useRuntime((r) => r.stats);
  const time = useRuntime((r) => r.timeOfDay);
  return (
    <div className="glass pointer-events-none rounded-lg border border-line px-3 py-2 font-mono text-[11px] leading-5" data-testid="stats">
      <div className="flex justify-between gap-6">
        <span className="text-muted">FPS</span>
        <span className={s.fps >= 50 ? "text-ok" : s.fps >= 30 ? "text-warn" : "text-danger"}>{s.fps}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted">Cuadro</span>
        <span>{s.frameMs} ms</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted">Draw calls</span>
        <span>{s.drawCalls}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted">Triángulos</span>
        <span>{(s.triangles / 1000).toFixed(1)} k</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted">Objetos</span>
        <span>{s.entities}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted">Geometrías</span>
        <span>{s.geometries}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted">Hora</span>
        <span>
          {Math.floor(time)}:{String(Math.round((time % 1) * 60)).padStart(2, "0")}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-muted">
        {s.renderer}
        {s.webgpu ? " · WebGPU detectado (renderer WebGL2)" : ""}
      </div>
    </div>
  );
}
