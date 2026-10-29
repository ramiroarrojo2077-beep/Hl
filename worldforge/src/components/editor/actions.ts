"use client";

import { zipSync } from "fflate";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { interpret } from "@/engine/ai/interpreter";
import { interpretWithProvider, planWithProvider } from "@/engine/ai/provider";
import { newId } from "@/engine/ids";
import { planWorld } from "@/engine/generation/planner";
import { generateWorld, STAGES, type StageEvent } from "@/engine/generation/pipeline";
import { buildExportScene } from "@/engine/persistence/exportScene";
import { autosave, getAsset, loadProject, putAsset, saveProject } from "@/engine/persistence/db";
import { bytesToBase64, parseProjectFile, serializeProject } from "@/engine/persistence/io";
import { createEmptyDoc, FOLDERS } from "@/engine/scene/doc";
import { defaultProps, spawn } from "@/engine/scene/factory";
import { Rng } from "@/engine/rng";
import { heightAt } from "@/engine/generation/terrain";
import type { EntityType, WorldDoc } from "@/engine/types";
import { canvasState } from "@/components/viewport/Viewport";
import { useEditor } from "@/store/editor";
import { useSettings } from "@/store/settings";

const log = (level: "info" | "warn" | "error" | "success", msg: string) => useEditor.getState().log(level, msg);

// ---------------------------------------------------------------------------
// Generación
// ---------------------------------------------------------------------------

export async function generateFromPrompt(prompt: string, opts: { seed?: number } = {}): Promise<WorldDoc | null> {
  const clean = prompt.trim().slice(0, 2000);
  if (!clean) return null;
  const s = useEditor.getState();
  if (s.generation?.running) return null;
  useEditor.setState({
    generation: { running: true, prompt: clean, error: null, stages: STAGES.map((st) => ({ id: st.id, label: st.label, status: "pending" })) },
  });
  s.setUi({ bottomTab: "generation", bottomOpen: true });
  log("info", `Generando: "${clean}"`);
  try {
    let plan = planWorld(clean, opts.seed).plan;
    if (useSettings.getState().provider === "openai-compatible") {
      try {
        const r = await planWithProvider(clean);
        plan = r.plan;
        log("success", `Plan creado por el modelo conectado (${r.model})`);
      } catch (err) {
        log("warn", `Modelo conectado no disponible (${err instanceof Error ? err.message : "error"}): se usa Forge 1 local`);
      }
    }
    const result = await generateWorld(plan, {
      prompt: clean,
      onStage: (e: StageEvent) => {
        const g = useEditor.getState().generation;
        if (!g) return;
        useEditor.setState({ generation: { ...g, stages: g.stages.map((st) => (st.id === e.stage ? { ...st, status: e.status, ms: e.ms } : st)) } });
      },
      onLog: (m) => log("info", m),
    });
    for (const c of result.features) log(c.ok ? "success" : "warn", `${c.ok ? "✓" : "✗"} ${c.feature}: ${c.detail}`);
    for (const i of result.report.issues) if (i.severity !== "info") log("warn", i.message);
    useEditor.getState().loadDoc(result.doc);
    const meta = await saveProject(result.doc);
    useEditor.getState().markSaved(meta.id, result.doc.updatedAt);
    const g = useEditor.getState().generation;
    useEditor.setState({ generation: g ? { ...g, running: false } : null });
    log("success", `Mundo "${result.doc.name}" generado y guardado (${Object.keys(result.doc.entities).length} entidades)`);
    setTimeout(() => void captureThumbnailAndSave(), 1500);
    return result.doc;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    const g = useEditor.getState().generation;
    useEditor.setState({ generation: g ? { ...g, running: false, error: message } : null });
    log("error", `La generación falló: ${message}`);
    return null;
  }
}

export function newEmptyWorld(): WorldDoc {
  const doc = createEmptyDoc("Mundo vacío", 64, 200);
  doc.terrain.biome = "temperate";
  spawn(doc, { id: newId("l"), type: "light", name: "Sun", props: { kind: "sun", color: "#fff4e0", intensity: 1, distance: 0, angle: 0.5, castShadow: true }, parentId: FOLDERS.lighting.id });
  spawn(doc, { id: newId("s"), type: "spawn", props: {}, transform: { position: [0, 0, 10] }, parentId: FOLDERS.cameras.id });
  useEditor.getState().loadDoc(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Edición por texto (IA)
// ---------------------------------------------------------------------------

export async function previewInstruction(prompt: string): Promise<void> {
  const s = useEditor.getState();
  if (!s.doc || !prompt.trim()) return;
  useEditor.setState({ aiBusy: true });
  try {
    let ops = null;
    let source = "Forge 1 (local)";
    let notUnderstood: string[] = [];
    if (useSettings.getState().provider === "openai-compatible") {
      try {
        const r = await interpretWithProvider(prompt, s.doc, s.selection);
        ops = r.operations;
        source = `Modelo conectado (${r.model})`;
      } catch (err) {
        log("warn", `Modelo conectado no disponible: ${err instanceof Error ? err.message : "error"}. Se usa Forge 1 local.`);
      }
    }
    if (!ops) {
      const r = interpret(prompt, { doc: s.doc, selection: s.selection });
      ops = r.operations;
      notUnderstood = r.notUnderstood;
    }
    if (!ops.length) {
      useEditor.setState({
        aiPreview: { prompt, operations: [], summary: [], warnings: ["No entendí la instrucción. Probá con frases como “hacé este edificio más alto”, “agregá 20 árboles alrededor del lago” o “poné lluvia”."], notUnderstood, source },
      });
      return;
    }
    const preview = useEditor.getState().previewOperations(ops);
    useEditor.setState({ aiPreview: { prompt, operations: ops, summary: preview.summary, warnings: preview.warnings, notUnderstood, source } });
  } finally {
    useEditor.setState({ aiBusy: false });
  }
}

export function applyPreview() {
  const s = useEditor.getState();
  const p = s.aiPreview;
  if (!p || !p.operations.length) return;
  s.applyOperations(p.prompt, p.operations, p.source);
}

export function discardPreview() {
  const s = useEditor.getState();
  const p = s.aiPreview;
  if (p) useEditor.setState({ aiPreview: null, aiHistory: [...s.aiHistory, { id: Date.now(), prompt: p.prompt, summary: p.summary, status: "discarded", at: Date.now(), source: p.source }] });
}

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

export async function saveCurrent(): Promise<boolean> {
  const s = useEditor.getState();
  if (!s.doc) return false;
  try {
    const thumb = captureThumbnail();
    const meta = await saveProject(s.doc, thumb);
    useEditor.getState().markSaved(meta.id, s.doc.updatedAt);
    log("success", `Proyecto guardado: ${s.doc.name}`);
    return true;
  } catch (err) {
    log("error", `No se pudo guardar: ${err instanceof Error ? err.message : "error"}`);
    return false;
  }
}

export async function saveAs(name: string): Promise<string | null> {
  const s = useEditor.getState();
  if (!s.doc) return null;
  const copy: WorldDoc = { ...structuredClone(s.doc), id: newId("w"), name: name.trim().slice(0, 80) || `${s.doc.name} (copia)`, createdAt: Date.now(), updatedAt: Date.now() };
  const meta = await saveProject(copy, captureThumbnail());
  useEditor.getState().loadDoc(copy, { projectId: meta.id, saved: true });
  log("success", `Guardado como "${copy.name}"`);
  return meta.id;
}

export async function openProject(id: string): Promise<boolean> {
  const r = await loadProject(id);
  if (!r) {
    log("error", "No se encontró el proyecto");
    return false;
  }
  useEditor.getState().loadDoc(r.doc, { projectId: id, saved: true });
  for (const w of r.warnings) log("warn", w);
  log("info", `Abierto: ${r.doc.name}`);
  return true;
}

export async function autosaveNow(): Promise<void> {
  const s = useEditor.getState();
  if (!s.doc || s.doc.updatedAt === s.savedUpdatedAt) return;
  await autosave(s.doc);
}

async function captureThumbnailAndSave() {
  const s = useEditor.getState();
  if (!s.doc || s.doc.updatedAt !== s.savedUpdatedAt) return;
  const thumb = captureThumbnail();
  if (thumb) await saveProject(s.doc, thumb);
}

/** Captura del visor en miniatura (JPEG 320x180). */
export function captureThumbnail(): string | null {
  const st = canvasState.current;
  if (!st) return null;
  try {
    st.gl.render(st.scene, st.camera);
    const src = st.gl.domElement;
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 180;
    const ctx = c.getContext("2d")!;
    const ratio = Math.max(320 / src.width, 180 / src.height);
    const w = src.width * ratio, h = src.height * ratio;
    ctx.drawImage(src, (320 - w) / 2, (180 - h) / 2, w, h);
    return c.toDataURL("image/jpeg", 0.75);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Importar
// ---------------------------------------------------------------------------

export async function importProjectFile(file: File): Promise<boolean> {
  try {
    const text = await file.text();
    const { doc, assets, warnings } = parseProjectFile(text);
    // Recursos binarios embebidos.
    for (const [id, b64] of Object.entries(assets)) {
      const meta = doc.assets[id];
      await putAsset(id, meta?.name ?? id, meta?.mime ?? "model/gltf-binary", new Blob([base64ToArrayBuffer(b64)], { type: meta?.mime ?? "model/gltf-binary" }));
    }
    doc.id = newId("w");
    doc.updatedAt = Date.now();
    const meta = await saveProject(doc);
    useEditor.getState().loadDoc(doc, { projectId: meta.id, saved: true });
    for (const w of warnings) log("warn", w);
    log("success", `Proyecto importado: ${doc.name}`);
    return true;
  } catch (err) {
    log("error", `No se pudo importar: ${err instanceof Error ? err.message : "archivo inválido"}`);
    return false;
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const s = atob(b64);
  const buf = new ArrayBuffer(s.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i);
  return buf;
}

const MAX_MODEL_BYTES = 50 * 1024 * 1024;

export async function importModelFile(file: File, at?: [number, number, number]): Promise<boolean> {
  const s = useEditor.getState();
  if (!s.doc) return false;
  if (file.size > MAX_MODEL_BYTES) {
    log("error", "El modelo supera los 50 MB");
    return false;
  }
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  const isGlb = head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46; // "glTF"
  const isGltf = !isGlb && file.name.toLowerCase().endsWith(".gltf");
  if (!isGlb && !isGltf) {
    log("error", "Formato no soportado: usá archivos .glb o .gltf autocontenidos");
    return false;
  }
  if (isGltf) {
    try {
      const json = JSON.parse(new TextDecoder().decode(buf)) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
      const external = [...(json.buffers ?? []), ...(json.images ?? [])].some((b) => b.uri && !b.uri.startsWith("data:"));
      if (external) {
        log("error", "El .gltf referencia archivos externos: exportalo como .glb o con recursos embebidos");
        return false;
      }
    } catch {
      log("error", "El archivo .gltf no es JSON válido");
      return false;
    }
  }
  const id = newId("a");
  const mime = isGlb ? "model/gltf-binary" : "model/gltf+json";
  await putAsset(id, file.name, mime, new Blob([buf], { type: mime }));
  const pos = at ?? viewCenterOnTerrain();
  const name = file.name.replace(/\.(glb|gltf)$/i, "").replace(/[^\w-]+/g, "_").slice(0, 40) || "Model";
  let created = "";
  s.exec(`Importar ${file.name}`, (d) => {
    d.assets[id] = { id, name: file.name.slice(0, 120), mime, size: file.size };
    const e = spawn(d as WorldDoc, { id: newId("m"), type: "model", name, props: { assetId: id, assetName: file.name.slice(0, 120) }, transform: { position: pos }, parentId: FOLDERS.models.id });
    created = e.id;
  });
  if (created) useEditor.getState().select([created]);
  log("success", `Modelo importado: ${file.name}`);
  return true;
}

// ---------------------------------------------------------------------------
// Agregar desde la biblioteca
// ---------------------------------------------------------------------------

export function viewCenterOnTerrain(): [number, number, number] {
  const st = canvasState.current;
  const doc = useEditor.getState().doc;
  if (!st || !doc) return [0, 0, 0];
  const cam = st.camera;
  const dir = cam.getWorldDirection(cam.position.clone()).normalize();
  // Avanza por el rayo hasta tocar el terreno.
  const p = cam.position.clone();
  for (let k = 0; k < 400; k++) {
    p.addScaledVector(dir, 2);
    if (Math.abs(p.x) > doc.terrain.size / 2 || Math.abs(p.z) > doc.terrain.size / 2) break;
    const h = heightAt(doc.terrain, p.x, p.z);
    if (p.y <= h) return [round(p.x), round(h), round(p.z)];
  }
  const fallback = cam.position.clone().addScaledVector(dir.setY(0).normalize(), 30);
  const h = heightAt(doc.terrain, Math.max(-doc.terrain.size / 2, Math.min(doc.terrain.size / 2, fallback.x)), Math.max(-doc.terrain.size / 2, Math.min(doc.terrain.size / 2, fallback.z)));
  return [round(fallback.x), round(h), round(fallback.z)];
}

const round = (v: number) => Math.round(v * 100) / 100;

export function addFromLibrary(type: EntityType, variant: string | undefined, at?: [number, number, number]) {
  const s = useEditor.getState();
  if (!s.doc) return;
  const pos = at ?? viewCenterOnTerrain();
  const rng = new Rng(Date.now() & 0x7fffffff);
  const style = (Object.values(s.doc.entities).find((e) => e.type === "building") as { props?: { style?: string } } | undefined)?.props?.style ?? "modern";
  let id = "";
  s.exec(`Agregar ${variant ?? type}`, (d) => {
    const props = defaultProps(type, variant, rng, style as never);
    const y = type === "light" ? pos[1] + 4 : pos[1];
    const e = spawn(d as WorldDoc, { id: newId(type.slice(0, 1)), type, props: props as never, transform: { position: [pos[0], y, pos[2]] } });
    if (e.type === "npc") e.props.behavior = d.navigation.nodes.length ? "sidewalk" : "wander";
    id = e.id;
  });
  if (id) useEditor.getState().select([id]);
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

function download(data: BlobPart, filename: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const fileBase = (doc: WorldDoc) => doc.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "worldforge";

export async function exportGltf(binary: boolean): Promise<void> {
  const doc = useEditor.getState().doc;
  if (!doc) return;
  log("info", `Exportando ${binary ? "GLB" : "glTF"}...`);
  try {
    const { root, animations, warnings } = buildExportScene(doc);
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(root, { binary, animations, onlyVisible: true, maxTextureSize: 1024 });
    if (binary) download(result as ArrayBuffer, `${fileBase(doc)}.glb`, "model/gltf-binary");
    else download(JSON.stringify(result), `${fileBase(doc)}.gltf`, "model/gltf+json");
    for (const w of warnings) log("warn", w);
    log("success", `Exportado ${binary ? "GLB" : "glTF"}`);
  } catch (err) {
    log("error", `No se pudo exportar: ${err instanceof Error ? err.message : "error"}`);
  }
}

export async function exportProjectJson(): Promise<void> {
  const doc = useEditor.getState().doc;
  if (!doc) return;
  const assets: Record<string, string> = {};
  for (const id of Object.keys(doc.assets)) {
    const a = await getAsset(id);
    if (a) assets[id] = bytesToBase64(new Uint8Array(await a.data.arrayBuffer()));
  }
  download(serializeProject(doc, assets), `${fileBase(doc)}.worldforge.json`, "application/json");
  log("success", "Proyecto exportado como JSON");
}

export function exportPng(): void {
  const doc = useEditor.getState().doc;
  const st = canvasState.current;
  if (!doc || !st) return;
  st.gl.render(st.scene, st.camera);
  st.gl.domElement.toBlob((blob) => {
    if (blob) download(blob, `${fileBase(doc)}.png`, "image/png");
    log("success", "Captura PNG exportada");
  }, "image/png");
}

/** Renderiza la línea de tiempo cuadro por cuadro y la descarga como ZIP de PNG. */
export async function exportImageSequence(fps = 12, maxSeconds = 20): Promise<void> {
  const s = useEditor.getState();
  const doc = s.doc;
  const st = canvasState.current;
  if (!doc || !st) return;
  const duration = Math.min(doc.animation.duration, maxSeconds);
  const frames = Math.max(1, Math.round(duration * fps));
  log("info", `Renderizando ${frames} cuadros...`);
  const files: Record<string, Uint8Array> = {};
  const prev = s.playback;
  for (let i = 0; i < frames; i++) {
    useEditor.setState({ playback: { playing: false, time: i / fps, speed: 1, cameraOverride: true } });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    st.gl.render(st.scene, st.camera);
    const blob = await new Promise<Blob | null>((r) => st.gl.domElement.toBlob(r, "image/png"));
    if (blob) files[`frame_${String(i).padStart(4, "0")}.png`] = new Uint8Array(await blob.arrayBuffer());
  }
  useEditor.setState({ playback: { ...prev, cameraOverride: false } });
  const zip = zipSync(files, { level: 0 });
  download(zip, `${fileBase(doc)}_secuencia.zip`, "application/zip");
  log("success", `Secuencia exportada: ${frames} cuadros a ${fps} fps`);
}
