"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EXAMPLE_PROMPTS, TEMPLATES } from "@/engine/generation/templates";
import { deleteProject, listAutosaves, listProjects, loadProject, renameProject, saveProject, type ProjectMeta } from "@/engine/persistence/db";
import { newId } from "@/engine/ids";
import { parseProjectFile } from "@/engine/persistence/io";
import { useSettings, QUALITY, type QualityLevel } from "@/store/settings";
import { Logo, TemplateGrid } from "../editor/MenuBar";
import { Button, IconButton, Modal, cx } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { ParticleSphere } from "./ParticleSphere";

export default function Home() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<"build" | "play">(params.get("tab") === "projects" ? "play" : "build");
  const [prompt, setPrompt] = useState("");
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [autosaves, setAutosaves] = useState<{ id: string; name: string; savedAt: number }[]>([]);
  const [templates, setTemplates] = useState(false);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exampleIdx = useRef(0);
  const quality = useSettings((s) => s.quality);

  const refresh = async () => {
    try {
      setProjects(await listProjects());
      const metas = await listProjects();
      const autos = await listAutosaves();
      // Solo los autoguardados más nuevos que lo guardado.
      setAutosaves(autos.filter((a) => (metas.find((m) => m.id === a.id)?.updatedAt ?? 0) < a.savedAt));
    } catch {
      setProjects([]);
      setError("No se pudo acceder al almacenamiento local del navegador (IndexedDB). Los proyectos no se podrán guardar.");
    }
  };

  useEffect(() => {
    useSettings.getState().hydrate();
    void refresh();
  }, []);

  const create = (text: string) => {
    const t = text.trim();
    if (!t) return;
    router.push(`/editor?prompt=${encodeURIComponent(t.slice(0, 2000))}`);
  };

  const importFile = async (file: File) => {
    try {
      const { doc } = parseProjectFile(await file.text());
      doc.id = newId("w");
      await saveProject(doc);
      router.push(`/editor?id=${doc.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archivo inválido");
    }
  };

  return (
    <div className="dot-grid relative flex min-h-[100dvh] flex-col bg-bg text-text">
      <header className="z-10 flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-xl font-bold tracking-wide">WorldForge</span>
          <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">AI</span>
        </div>
        <IconButton icon="more" label="Ajustes" onClick={() => setSettings(true)} className="rounded-full bg-surface" size="lg" />
      </header>

      {error && (
        <div className="mx-auto mb-2 flex max-w-xl items-center gap-2 rounded-lg bg-danger/15 px-3 py-2 text-xs text-danger">
          <Icon name="x" size={14} /> {error}
          <button className="ml-auto underline" onClick={() => setError(null)}>
            Cerrar
          </button>
        </div>
      )}

      <main className="flex flex-1 flex-col items-center px-4 pb-28">
        {tab === "build" ? (
          <>
            <div className="relative flex h-[38vh] min-h-[240px] w-full max-w-2xl items-center justify-center">
              <ParticleSphere />
              <h1 className="relative text-center text-3xl leading-tight font-bold sm:text-4xl">
                ¿Qué querés
                <br />
                crear hoy?
              </h1>
            </div>
            <form
              className="w-full max-w-2xl"
              onSubmit={(e) => {
                e.preventDefault();
                create(prompt);
              }}
            >
              <div className="rounded-2xl border border-line bg-panel/90 p-3 shadow-[var(--shadow-glow)] backdrop-blur focus-within:border-accent">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      create(prompt);
                    }
                  }}
                  rows={3}
                  maxLength={2000}
                  placeholder="Creá una pequeña ciudad rodeada de montañas, con edificios, calles, árboles y personas caminando…"
                  className="w-full resize-none bg-transparent px-1 text-base outline-none placeholder:text-muted/60"
                  data-testid="home-prompt"
                />
                <div className="flex items-center gap-2">
                  <IconButton icon="plus" label="Importar proyecto" onClick={() => fileRef.current?.click()} />
                  <IconButton
                    icon="bolt"
                    label="Ejemplo al azar"
                    onClick={() => {
                      setPrompt(EXAMPLE_PROMPTS[exampleIdx.current % EXAMPLE_PROMPTS.length]!);
                      exampleIdx.current++;
                    }}
                    testId="random-prompt"
                  />
                  <span className="ml-1 hidden items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-[11px] text-muted sm:flex" title="Modelo propio de WorldForge: funciona en tu navegador, gratis y sin API">
                    <Icon name="sparkles" size={12} className="text-accent-2" /> Forge 1 · local y gratis
                  </span>
                  <Button type="submit" variant="glow" icon="sparkles" disabled={!prompt.trim()} className="ml-auto" testId="home-create">
                    Crear mundo
                  </Button>
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
            </form>
            <button onClick={() => setTemplates(true)} className="mt-5 rounded-full border border-line px-4 py-2 text-sm hover:border-accent" data-testid="view-templates">
              Ver plantillas
            </button>

            {autosaves.length > 0 && (
              <div className="mt-8 w-full max-w-2xl rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs">
                <p className="mb-2 font-semibold text-warn">Hay cambios sin guardar de una sesión anterior</p>
                {autosaves.map((a) => (
                  <button key={a.id} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-warn/10" onClick={() => router.push(`/editor?id=${a.id}`)}>
                    <span>{a.name}</span>
                    <span className="text-muted">{new Date(a.savedAt).toLocaleString()} · Recuperar →</span>
                  </button>
                ))}
              </div>
            )}

            {projects && projects.length > 0 && (
              <section className="mt-10 w-full max-w-5xl">
                <h2 className="mb-3 text-sm font-semibold text-muted">Proyectos recientes</h2>
                <ProjectGrid projects={projects.slice(0, 8)} onChange={refresh} onOpen={(id) => router.push(`/editor?id=${id}`)} />
              </section>
            )}
          </>
        ) : (
          <section className="w-full max-w-5xl pt-4">
            <h2 className="mb-1 text-2xl font-bold">Explorar</h2>
            <p className="mb-5 text-sm text-muted">Entrá a tus mundos en primera o tercera persona.</p>
            {projects === null ? (
              <p className="text-sm text-muted">Cargando…</p>
            ) : projects.length === 0 ? (
              <div className="rounded-xl border border-line p-6 text-center text-sm text-muted">
                Todavía no tenés mundos. <button className="text-accent underline" onClick={() => setTab("build")}>Creá el primero</button>.
              </div>
            ) : (
              <ProjectGrid projects={projects} onChange={refresh} onOpen={(id) => router.push(`/editor?id=${id}&explore=1`)} playMode onEdit={(id) => router.push(`/editor?id=${id}`)} />
            )}
          </section>
        )}
      </main>

      <nav className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-full border border-line bg-panel/90 p-1.5 shadow-2xl backdrop-blur">
        {(
          [
            ["build", "Crear", "grid"],
            ["play", "Explorar", "gamepad"],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)} className={cx("flex w-24 flex-col items-center gap-0.5 rounded-full py-2 text-[11px]", tab === id ? "bg-surface-2 text-text" : "text-muted")} data-testid={`home-tab-${id}`}>
            <Icon name={icon} size={20} />
            {label}
          </button>
        ))}
      </nav>

      <Modal open={templates} onClose={() => setTemplates(false)} title="Plantillas de mundos" wide>
        <p className="mb-3 text-xs text-muted">Todos se generan con el mismo motor a partir de texto y quedan totalmente editables.</p>
        <TemplateGrid onPick={(p) => create(p)} />
      </Modal>
      <Modal open={settings} onClose={() => setSettings(false)} title="Ajustes">
        <div className="space-y-4 text-sm">
          <div>
            <p className="mb-2 text-xs text-muted">Calidad gráfica (se detecta automáticamente según tu dispositivo)</p>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(QUALITY) as QualityLevel[]).map((q) => (
                <button key={q} onClick={() => useSettings.getState().setQuality(q)} className={cx("rounded-lg py-2 text-xs", quality === q ? "bg-accent text-white" : "bg-surface-2 text-muted")}>
                  {QUALITY[q].label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg bg-surface p-3 text-xs text-muted">
            <p className="mb-1 font-semibold text-text">Forge 1</p>
            Es el motor de IA propio de WorldForge: interpreta tu descripción, planifica el mundo, lo construye con geometría 3D real, lo valida y corrige lo que falte. Funciona entero en tu navegador, sin costo. Opcionalmente podés conectar un modelo abierto local (Ollama, LM Studio) desde el servidor.
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ProjectGrid({ projects, onOpen, onChange, playMode, onEdit }: { projects: ProjectMeta[]; onOpen: (id: string) => void; onChange: () => void; playMode?: boolean; onEdit?: (id: string) => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="project-grid">
      {projects.map((p) => (
        <div key={p.id} className="group overflow-hidden rounded-xl border border-line bg-panel transition hover:border-accent" data-testid={`project-${p.name}`}>
          <button className="block aspect-video w-full overflow-hidden bg-surface" onClick={() => onOpen(p.id)}>
            {p.thumbnail ? <img src={p.thumbnail} alt="" className="h-full w-full object-cover transition group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-muted"><Icon name="globe" size={28} /></div>}
          </button>
          <div className="flex items-center gap-1 p-2.5">
            <div className="min-w-0 flex-1">
              {renaming === p.id ? (
                <input
                  autoFocus
                  defaultValue={p.name}
                  className="w-full rounded border border-accent bg-surface px-1 text-sm outline-none"
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") {
                      await renameProject(p.id, (e.target as HTMLInputElement).value.trim().slice(0, 80) || p.name);
                      setRenaming(null);
                      onChange();
                    }
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => setRenaming(null)}
                />
              ) : (
                <p className="truncate text-sm font-medium">{p.name}</p>
              )}
              <p className="text-[11px] text-muted">
                {new Date(p.updatedAt).toLocaleDateString()} · {p.entityCount} objetos
              </p>
            </div>
            {playMode && onEdit ? (
              <IconButton icon="settings" label="Abrir en el editor" size="sm" onClick={() => onEdit(p.id)} />
            ) : (
              <>
                <IconButton icon="key" label="Renombrar" size="sm" onClick={() => setRenaming(p.id)} />
                <IconButton
                  icon="copy"
                  label="Duplicar"
                  size="sm"
                  onClick={async () => {
                    const r = await loadProject(p.id);
                    if (!r) return;
                    await saveProject({ ...r.doc, id: newId("w"), name: `${r.doc.name} (copia)`, createdAt: Date.now(), updatedAt: Date.now() }, p.thumbnail);
                    onChange();
                  }}
                />
                <IconButton
                  icon="trash"
                  label="Eliminar"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(`¿Eliminar "${p.name}"? No se puede deshacer.`)) return;
                    await deleteProject(p.id);
                    onChange();
                  }}
                />
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export { TEMPLATES };
