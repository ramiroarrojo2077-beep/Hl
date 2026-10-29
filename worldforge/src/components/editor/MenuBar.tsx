"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useEditor, isDirty } from "@/store/editor";
import { QUALITY, useSettings, type QualityLevel } from "@/store/settings";
import { exportGltf, exportImageSequence, exportPng, exportProjectJson, importModelFile, importProjectFile, newEmptyWorld, saveAs, saveCurrent } from "./actions";
import { Button, IconButton, Modal, cx } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { TEMPLATES } from "@/engine/generation/templates";
import { generateFromPrompt } from "./actions";

interface MenuItem {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  checked?: boolean;
  divider?: boolean;
}

function Menu({ label, items, testId }: { label: string; items: MenuItem[]; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button data-testid={testId} onClick={() => setOpen(!open)} className={cx("rounded-md px-2.5 py-1 text-xs", open ? "bg-surface-2 text-text" : "text-muted hover:text-text")}>
        {label}
      </button>
      {open && (
        <div className="animate-fade-up absolute top-full left-0 z-50 mt-1 min-w-[230px] rounded-xl border border-line bg-panel p-1 shadow-2xl">
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} className="my-1 border-t border-line" />
            ) : (
              <button
                key={i}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-text hover:bg-surface-2 disabled:opacity-35"
              >
                <span className="w-3">{it.checked && <Icon name="check" size={12} className="text-accent-2" />}</span>
                <span className="flex-1">{it.label}</span>
                {it.shortcut && <span className="text-[10px] text-muted">{it.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

const sep: MenuItem = { label: "", onClick: () => {}, divider: true };

/** Barra superior: marca, menús, nombre del proyecto, estado de guardado y Explorar. */
export function MenuBar({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const s = useEditor();
  const dirty = isDirty(s);
  const quality = useSettings((x) => x.quality);
  const projectFile = useRef<HTMLInputElement>(null);
  const modelFile = useRef<HTMLInputElement>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const doc = s.doc;

  const file: MenuItem[] = [
    { label: "Nuevo mundo desde texto…", onClick: () => setNewOpen(true) },
    { label: "Nuevo mundo vacío", onClick: () => newEmptyWorld() },
    { label: "Abrir proyecto…", onClick: () => router.push("/?tab=projects") },
    sep,
    { label: "Guardar", shortcut: "Ctrl+S", onClick: () => void saveCurrent(), disabled: !doc },
    { label: "Guardar como…", onClick: () => { setName(`${doc?.name ?? "Mundo"} (copia)`); setSaveAsOpen(true); }, disabled: !doc },
    { label: "Duplicar proyecto", onClick: () => void saveAs(`${doc?.name ?? "Mundo"} (copia)`), disabled: !doc },
    sep,
    { label: "Importar proyecto (.json)…", onClick: () => projectFile.current?.click() },
    { label: "Importar modelo (.glb/.gltf)…", onClick: () => modelFile.current?.click(), disabled: !doc },
  ];
  const edit: MenuItem[] = [
    { label: "Deshacer", shortcut: "Ctrl+Z", onClick: () => s.undo(), disabled: !s.history.past.length },
    { label: "Rehacer", shortcut: "Ctrl+Shift+Z", onClick: () => s.redo(), disabled: !s.history.future.length },
    sep,
    { label: "Copiar", shortcut: "Ctrl+C", onClick: () => s.copySelection(), disabled: !s.selection.length },
    { label: "Pegar", shortcut: "Ctrl+V", onClick: () => s.paste(), disabled: !s.clipboard },
    { label: "Duplicar", shortcut: "Ctrl+D", onClick: () => s.duplicateSelection(), disabled: !s.selection.length },
    { label: "Eliminar", shortcut: "Supr", onClick: () => s.deleteSelection(), disabled: !s.selection.length },
    sep,
    { label: "Agrupar", shortcut: "Ctrl+G", onClick: () => s.groupSelection(), disabled: !s.selection.length },
    { label: "Desagrupar", shortcut: "Ctrl+Shift+G", onClick: () => s.ungroupSelection(), disabled: !s.selection.length },
    { label: "Ocultar / mostrar", shortcut: "H", onClick: () => s.toggleVisibility(), disabled: !s.selection.length },
    { label: "Bloquear / desbloquear", shortcut: "L", onClick: () => s.toggleLock(), disabled: !s.selection.length },
    { label: "Deseleccionar", shortcut: "Esc", onClick: () => s.select([]) },
  ];
  const generate: MenuItem[] = [
    { label: "Mundo desde texto…", onClick: () => setNewOpen(true) },
    { label: "Plantillas…", onClick: () => setTemplatesOpen(true) },
    { label: "Regenerar con otra variación", onClick: () => doc && void generateFromPrompt(doc.prompt, { seed: Math.floor(Math.random() * 2 ** 31) }), disabled: !doc?.prompt },
    sep,
    { label: "Editar con IA (panel)", onClick: () => s.setUi({ rightTab: "ai", sheet: "ai" }) },
  ];
  const view: MenuItem[] = [
    { label: "Cámara: órbita", onClick: () => useEditor.setState({ cameraMode: "orbit" }), checked: s.cameraMode === "orbit" },
    { label: "Cámara: vuelo libre (WASD + Q/E)", onClick: () => useEditor.setState({ cameraMode: "fly" }), checked: s.cameraMode === "fly" },
    { label: "Cámara: primera persona", onClick: () => useEditor.setState({ cameraMode: "firstperson" }), checked: s.cameraMode === "firstperson" },
    { label: "Cámara: cinematográfica", onClick: () => useEditor.setState({ cameraMode: "cinematic" }), checked: s.cameraMode === "cinematic" },
    sep,
    { label: "Encuadrar selección", shortcut: "F", onClick: () => s.setUi({ focusToken: Date.now() }), disabled: !s.selection.length },
    { label: "Cuadrícula", onClick: () => s.setUi({ showGrid: !s.ui.showGrid }), checked: s.ui.showGrid },
    { label: "Estadísticas de rendimiento", onClick: () => s.setUi({ showStats: !s.ui.showStats }), checked: s.ui.showStats },
    { label: "Panel inferior", onClick: () => s.setUi({ bottomOpen: !s.ui.bottomOpen }), checked: s.ui.bottomOpen },
    sep,
    ...(Object.keys(QUALITY) as QualityLevel[]).map((q) => ({ label: `Calidad gráfica: ${QUALITY[q].label}`, onClick: () => useSettings.getState().setQuality(q), checked: quality === q })),
  ];
  const sim: MenuItem[] = [
    { label: s.simPlaying ? "Pausar simulación" : "Reanudar simulación", onClick: () => useEditor.setState({ simPlaying: !s.simPlaying }) },
    { label: "Reiniciar simulación", onClick: () => useEditor.setState({ simResetToken: s.simResetToken + 1 }) },
    sep,
    { label: "Personajes", onClick: () => s.exec("Personajes", (d) => void (d.simulation.npcs = !d.simulation.npcs)), checked: doc?.simulation.npcs },
    { label: "Tránsito", onClick: () => s.exec("Tránsito", (d) => void (d.simulation.traffic = !d.simulation.traffic)), checked: doc?.simulation.traffic },
    { label: "Ciclo día/noche", onClick: () => s.exec("Ciclo día/noche", (d) => void (d.environment.dayNightCycle = !d.environment.dayNightCycle)), checked: doc?.environment.dayNightCycle },
  ];
  const exp: MenuItem[] = [
    { label: "GLB (binario)", onClick: () => void exportGltf(true), disabled: !doc },
    { label: "glTF (JSON)", onClick: () => void exportGltf(false), disabled: !doc },
    { label: "Proyecto JSON", onClick: () => void exportProjectJson(), disabled: !doc },
    { label: "Captura PNG", onClick: () => exportPng(), disabled: !doc },
    { label: "Secuencia de imágenes (ZIP)", onClick: () => void exportImageSequence(), disabled: !doc },
  ];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <button onClick={() => router.push("/")} className="flex items-center gap-2 pr-2" title="Inicio" data-testid="home-link">
        <Logo />
        {!compact && <span className="text-sm font-bold tracking-wide">WORLDFORGE</span>}
      </button>
      {!compact && (
        <nav className="flex items-center">
          <Menu label="Archivo" items={file} testId="menu-file" />
          <Menu label="Editar" items={edit} testId="menu-edit" />
          <Menu label="Generar" items={generate} testId="menu-generate" />
          <Menu label="Vista" items={view} testId="menu-view" />
          <Menu label="Simulación" items={sim} testId="menu-sim" />
          <Menu label="Exportar" items={exp} testId="menu-export" />
        </nav>
      )}
      <div className="mx-auto flex min-w-0 items-center gap-2">
        <span className="truncate text-xs text-muted" data-testid="project-name">
          {doc?.name ?? ""}
        </span>
        {doc && (
          <span className={cx("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]", dirty ? "bg-warn/15 text-warn" : "bg-ok/10 text-ok")} data-testid="save-status">
            <span className={cx("h-1.5 w-1.5 rounded-full", dirty ? "bg-warn" : "bg-ok")} />
            {dirty ? "Sin guardar" : "Guardado"}
          </span>
        )}
      </div>
      <IconButton icon="save" label="Guardar (Ctrl+S)" onClick={() => void saveCurrent()} disabled={!doc} testId="save-button" />
      {!compact && <IconButton icon="stats" label="Estadísticas" active={s.ui.showStats} onClick={() => s.setUi({ showStats: !s.ui.showStats })} />}
      <Button variant="glow" icon="gamepad" onClick={() => useEditor.setState({ mode: "explore", selection: [] })} disabled={!doc} testId="explore-button" className="px-3 py-1.5 text-xs">
        {compact ? "Explorar" : "EXPLORAR MUNDO"}
      </Button>

      <input ref={projectFile} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void importProjectFile(e.target.files[0])} />
      <input ref={modelFile} type="file" accept=".glb,.gltf" className="hidden" onChange={(e) => e.target.files?.[0] && void importModelFile(e.target.files[0])} />

      <Modal open={saveAsOpen} onClose={() => setSaveAsOpen(false)} title="Guardar como">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaveAsOpen(false);
            void saveAs(name);
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" maxLength={80} />
          <Button type="submit" variant="primary">
            Guardar copia
          </Button>
        </form>
      </Modal>
      <Modal open={templatesOpen} onClose={() => setTemplatesOpen(false)} title="Plantillas" wide>
        <TemplateGrid
          onPick={(p) => {
            setTemplatesOpen(false);
            void generateFromPrompt(p);
          }}
        />
      </Modal>
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nuevo mundo desde texto">
        <NewWorld onSubmit={(p) => { setNewOpen(false); void generateFromPrompt(p); }} />
      </Modal>
    </header>
  );
}

function NewWorld({ onSubmit }: { onSubmit: (p: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSubmit(text); }}>
      <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Creá una pequeña ciudad rodeada de montañas…" className="w-full rounded-lg border border-line bg-surface p-3 text-sm outline-none focus:border-accent" />
      <Button type="submit" variant="glow" icon="sparkles" disabled={!text.trim()}>Generar con Forge 1</Button>
    </form>
  );
}

export function TemplateGrid({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {TEMPLATES.map((t) => (
        <button key={t.id} onClick={() => onPick(t.prompt)} className="group overflow-hidden rounded-xl border border-line text-left transition hover:border-accent" data-testid={`template-${t.id}`}>
          <div className="flex h-20 items-end p-3" style={{ background: `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})` }}>
            <Icon name={t.icon} size={22} className="text-white/90" />
          </div>
          <div className="space-y-1 p-3">
            <p className="text-sm font-semibold">{t.name}</p>
            <p className="text-[11px] text-muted">{t.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="wf-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6D7CFF" />
          <stop offset="1" stopColor="#00D6C9" />
        </linearGradient>
      </defs>
      <path d="M16 2l12 7v14l-12 7-12-7V9z" fill="none" stroke="url(#wf-g)" strokeWidth="2.2" />
      <path d="M8 19l5-6 3 4 2-2 6 6" fill="none" stroke="url(#wf-g)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="21" cy="11" r="2" fill="#00D6C9" />
    </svg>
  );
}
