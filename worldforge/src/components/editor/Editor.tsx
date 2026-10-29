"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { discardAutosave, getAutosave } from "@/engine/persistence/db";
import { TEMPLATES } from "@/engine/generation/templates";
import type { EntityType, WorldDoc } from "@/engine/types";
import { useEditor, isDirty } from "@/store/editor";
import { useSettings } from "@/store/settings";
import { addFromLibrary, autosaveNow, generateFromPrompt, openProject, saveCurrent } from "./actions";
import { AIPanel } from "./AIPanel";
import { BottomPanel, GenerationStatus, Timeline } from "./BottomPanel";
import { ExploreOverlay } from "./ExploreOverlay";
import { HierarchyPanel } from "./HierarchyPanel";
import { Inspector, WorldSettings } from "./Inspector";
import { LibraryPanel } from "./LibraryPanel";
import { MenuBar } from "./MenuBar";
import { StatsOverlay, Toolbar } from "./Toolbar";
import { ToolsPanel } from "./ToolsPanel";
import { Button, IconButton, Modal, Tabs, cx } from "../ui/controls";
import { Icon, type IconName } from "../ui/Icon";

const Viewport = dynamic(() => import("../viewport/Viewport"), { ssr: false, loading: () => <ViewportLoading /> });

function ViewportLoading() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted">
      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
      Iniciando motor 3D…
    </div>
  );
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

/** Atajos de teclado del editor. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const s = useEditor.getState();
      if (!s.doc || s.mode !== "edit") return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        s.redo();
      } else if (mod && key === "s") {
        e.preventDefault();
        void saveCurrent();
      } else if (mod && key === "d") {
        e.preventDefault();
        s.duplicateSelection();
      } else if (mod && key === "c") s.copySelection();
      else if (mod && key === "v") s.paste();
      else if (mod && key === "g") {
        e.preventDefault();
        e.shiftKey ? s.ungroupSelection() : s.groupSelection();
      } else if (key === "delete" || key === "backspace") s.deleteSelection();
      else if (key === "escape") {
        if (s.roadDraft.length) useEditor.setState({ roadDraft: [] });
        else s.select([]);
      } else if (mod) return;
      else if (s.cameraMode === "fly" || s.cameraMode === "firstperson") return; // WASD mueve la cámara
      else if (key === "q") s.setTool("select");
      else if (key === "w") s.setTool("move");
      else if (key === "e") s.setTool("rotate");
      else if (key === "r") s.setTool("scale");
      else if (key === "t") s.setTool("terrain");
      else if (key === "f") s.setUi({ focusToken: Date.now() });
      else if (key === "h") s.toggleVisibility();
      else if (key === "l") s.toggleLock();
      else if (key === " ") {
        e.preventDefault();
        useEditor.setState({ playback: { ...s.playback, playing: !s.playback.playing } });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Autoguardado periódico para recuperar el trabajo tras un cierre inesperado. */
function useAutosave() {
  useEffect(() => {
    const t = setInterval(() => void autosaveNow(), 15000);
    const onHide = () => {
      if (document.visibilityState === "hidden") void autosaveNow();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (isDirty(useEditor.getState())) {
        void autosaveNow();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
}

export default function Editor() {
  const router = useRouter();
  const params = useSearchParams();
  const doc = useEditor((s) => s.doc);
  const mode = useEditor((s) => s.mode);
  const ui = useEditor((s) => s.ui);
  const generation = useEditor((s) => s.generation);
  const projectId = useEditor((s) => s.projectId);
  const mobile = useIsMobile();
  const [recovery, setRecovery] = useState<{ savedAt: number; doc: WorldDoc } | null>(null);
  const started = useRef(false);

  useShortcuts();
  useAutosave();

  useEffect(() => {
    useSettings.getState().hydrate();
  }, []);

  // Carga inicial: proyecto existente, plantilla o generación desde texto.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const id = params.get("id");
    const prompt = params.get("prompt");
    const template = params.get("template");
    const explore = params.get("explore") === "1";
    void (async () => {
      if (id) {
        const ok = await openProject(id);
        if (!ok) return router.replace("/");
        const auto = await getAutosave(id);
        const current = useEditor.getState().doc;
        if (auto && current && auto.savedAt > current.updatedAt && auto.doc.updatedAt > current.updatedAt) setRecovery(auto);
        if (explore) useEditor.setState({ mode: "explore" });
        return;
      }
      const text = prompt ?? TEMPLATES.find((t) => t.id === template)?.prompt;
      if (text) {
        const result = await generateFromPrompt(text);
        if (result) router.replace(`/editor?id=${result.id}`);
        return;
      }
      if (!useEditor.getState().doc) router.replace("/");
    })();
  }, [params, router]);

  // Mantiene la URL apuntando al proyecto abierto (recargar vuelve a abrirlo).
  useEffect(() => {
    if (projectId && params.get("id") !== projectId && !params.get("prompt") && !params.get("template")) router.replace(`/editor?id=${projectId}`);
  }, [projectId, params, router]);

  const onDrop = (payload: string, point: [number, number, number]) => {
    try {
      const { type, variant } = JSON.parse(payload) as { type: EntityType; variant?: string };
      addFromLibrary(type, variant, point);
    } catch {
      // carga inválida: se ignora
    }
  };

  const generating = generation?.running ?? false;
  const viewport = (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <Viewport onDropAsset={onDrop} />
      {mode === "edit" && doc && (
        <>
          <div className={cx("absolute z-10", mobile ? "top-2 left-2" : "top-3 left-1/2 -translate-x-1/2")}>
            <Toolbar vertical={mobile} />
          </div>
          {ui.showStats && (
            <div className="absolute top-3 right-3 z-10">
              <StatsOverlay />
            </div>
          )}
        </>
      )}
      {mode === "explore" && <ExploreOverlay />}
      {generating && <GenerationOverlay />}
      {!doc && !generating && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          Cargando…
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg text-text">
      {mode === "edit" && <MenuBar compact={mobile} />}
      {mobile ? (
        <MobileLayout viewport={viewport} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {mode === "edit" && (
            <aside className="flex w-[272px] shrink-0 flex-col border-r border-line bg-panel">
              <Tabs
                value={ui.leftTab}
                onChange={(v) => useEditor.getState().setUi({ leftTab: v })}
                items={[
                  { id: "hierarchy", label: "Jerarquía", icon: "layers" },
                  { id: "library", label: "Biblioteca", icon: "grid" },
                  { id: "tools", label: "Herramientas", icon: "wrench" },
                ]}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                {ui.leftTab === "hierarchy" && <HierarchyPanel />}
                {ui.leftTab === "library" && <LibraryPanel />}
                {ui.leftTab === "tools" && <ToolsPanel />}
              </div>
            </aside>
          )}
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">{viewport}</div>
            {mode === "edit" &&
              (ui.bottomOpen ? (
                <div className="h-[220px] shrink-0 border-t border-line">
                  <BottomPanel />
                </div>
              ) : (
                <button className="flex h-7 shrink-0 items-center justify-center gap-1 border-t border-line bg-panel text-[11px] text-muted hover:text-text" onClick={() => useEditor.getState().setUi({ bottomOpen: true })}>
                  <Icon name="chevronRight" size={12} className="-rotate-90" /> Línea de tiempo · Consola · Generación
                </button>
              ))}
          </main>
          {mode === "edit" && (
            <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-panel">
              <Tabs
                value={ui.rightTab}
                onChange={(v) => useEditor.getState().setUi({ rightTab: v })}
                items={[
                  { id: "inspector", label: "Inspector", icon: "settings" },
                  { id: "ai", label: "IA", icon: "sparkles" },
                  { id: "world", label: "Mundo", icon: "globe" },
                ]}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                {ui.rightTab === "inspector" && <Inspector />}
                {ui.rightTab === "ai" && <AIPanel />}
                {ui.rightTab === "world" && <WorldSettings />}
              </div>
            </aside>
          )}
        </div>
      )}
      <Modal open={!!recovery} onClose={() => setRecovery(null)} title="Recuperar cambios">
        <div className="space-y-3 text-sm">
          <p>Encontramos cambios sin guardar de {recovery ? new Date(recovery.savedAt).toLocaleString() : ""} (probablemente la pestaña se cerró sin guardar).</p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              icon="undo"
              onClick={() => {
                if (recovery) {
                  useEditor.getState().loadDoc(recovery.doc, { projectId, saved: false });
                  useEditor.getState().log("success", "Cambios recuperados del autoguardado");
                }
                setRecovery(null);
              }}
            >
              Recuperar
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (projectId) void discardAutosave(projectId);
                setRecovery(null);
              }}
            >
              Descartar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function GenerationOverlay() {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/70 backdrop-blur-sm" data-testid="generation-overlay">
      <div className="w-[min(520px,92vw)] rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
          <Icon name="sparkles" className="text-accent-2" /> Forge 1 está construyendo tu mundo
        </div>
        <div className="h-[300px]">
          <GenerationStatus />
        </div>
      </div>
    </div>
  );
}

type Sheet = NonNullable<ReturnType<typeof useEditor.getState>["ui"]["sheet"]>;
const SHEETS: { id: Sheet; label: string; icon: IconName }[] = [
  { id: "hierarchy", label: "Objetos", icon: "layers" },
  { id: "library", label: "Agregar", icon: "plus" },
  { id: "ai", label: "IA", icon: "sparkles" },
  { id: "inspector", label: "Editar", icon: "settings" },
  { id: "world", label: "Mundo", icon: "globe" },
];

/** Versión móvil: visor a pantalla completa, navegación inferior y paneles deslizables. */
function MobileLayout({ viewport }: { viewport: React.ReactNode }) {
  const sheet = useEditor((s) => s.ui.sheet);
  const mode = useEditor((s) => s.mode);
  const selection = useEditor((s) => s.selection);
  const set = (v: Sheet | null) => useEditor.getState().setUi({ sheet: v });
  // Al seleccionar algo en el visor se ofrece el inspector.
  useEffect(() => {
    if (selection.length && !sheet) return;
  }, [selection, sheet]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">{viewport}</div>
      {mode === "edit" && selection.length > 0 && !sheet && (
        <div className="absolute right-2 bottom-20 z-20 flex gap-1">
          <IconButton icon="settings" label="Editar selección" className="glass" size="lg" onClick={() => set("inspector")} />
          <IconButton icon="copy" label="Duplicar" className="glass" size="lg" onClick={() => useEditor.getState().duplicateSelection()} />
          <IconButton icon="trash" label="Eliminar" className="glass" size="lg" onClick={() => useEditor.getState().deleteSelection()} />
        </div>
      )}
      {mode === "edit" && sheet && (
        <div className="animate-fade-up absolute inset-x-0 bottom-16 z-30 flex h-[62%] flex-col rounded-t-2xl border-t border-line bg-panel shadow-2xl" data-testid={`sheet-${sheet}`}>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="h-1 w-10 rounded-full bg-line" />
            <span className="text-xs font-semibold">{SHEETS.find((s) => s.id === sheet)?.label ?? (sheet === "tools" ? "Herramientas" : "Línea de tiempo")}</span>
            <IconButton icon="x" label="Cerrar" size="sm" onClick={() => set(null)} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {sheet === "hierarchy" && <HierarchyPanel />}
            {sheet === "library" && <LibraryPanel />}
            {sheet === "ai" && <AIPanel />}
            {sheet === "inspector" && <Inspector />}
            {sheet === "world" && <WorldSettings />}
            {sheet === "tools" && <ToolsPanel />}
            {sheet === "timeline" && <Timeline />}
          </div>
        </div>
      )}
      {mode === "edit" && (
        <nav className="flex h-16 shrink-0 items-center justify-around border-t border-line bg-panel px-2 pb-[env(safe-area-inset-bottom)]">
          {SHEETS.map((s) => (
            <button key={s.id} onClick={() => set(sheet === s.id ? null : s.id)} className={cx("flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px]", sheet === s.id ? "text-accent" : "text-muted")} data-testid={`mobile-${s.id}`}>
              <Icon name={s.icon} size={20} />
              {s.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
