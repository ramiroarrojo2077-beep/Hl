"use client";

import { produce, type Draft } from "immer";
import { useRef } from "react";
import { create } from "zustand";
import { newId } from "@/engine/ids";
import { emptyHistory, execute, redo as historyRedo, undo as historyUndo, type History } from "@/engine/scene/history";
import { allocateName, insertEntity, namePrefix, removeEntity, ROOT_ID, worldMatrix, matrixToTransform, isEffectivelyLocked } from "@/engine/scene/doc";
import { duplicateEntity, executeOperations, groupEntities, ungroupEntity, type Operation, type OpResult } from "@/engine/scene/operations";
import type { BrushMode } from "@/engine/generation/terrain";
import type { StageId } from "@/engine/generation/pipeline";
import { NON_TRANSFORMABLE, PROTECTED_TYPES, type Entity, type WorldDoc } from "@/engine/types";

export type Tool = "select" | "move" | "rotate" | "scale" | "terrain";
export type CameraMode = "orbit" | "fly" | "firstperson" | "cinematic";
export type TerrainToolMode = BrushMode | "paint" | "addTrees" | "removeVegetation" | "road";

export interface LogEntry {
  id: number;
  at: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface StageState {
  id: StageId;
  label: string;
  status: "pending" | "running" | "done";
  ms?: number;
}

export interface AiPreview {
  prompt: string;
  operations: Operation[];
  summary: string[];
  warnings: string[];
  notUnderstood: string[];
  source: string;
}

export interface AiHistoryItem {
  id: number;
  prompt: string;
  summary: string[];
  status: "applied" | "discarded" | "failed";
  at: number;
  source: string;
}

interface ClipboardData {
  entities: Entity[];
  roots: string[];
}

export interface EditorState {
  doc: WorldDoc | null;
  history: History;
  projectId: string | null;
  savedUpdatedAt: number | null;
  selection: string[];
  tool: Tool;
  space: "world" | "local";
  snap: { grid: boolean; translate: number; rotateDeg: number; scale: number; surface: boolean };
  cameraMode: CameraMode;
  mode: "edit" | "explore";
  exploreView: "first" | "third";
  simPlaying: boolean;
  simResetToken: number;
  playback: { playing: boolean; time: number; speed: number; cameraOverride: boolean };
  brush: { mode: TerrainToolMode; radius: number; strength: number; paint: number };
  roadDraft: [number, number][];
  ui: {
    leftTab: "hierarchy" | "library" | "tools";
    rightTab: "inspector" | "ai" | "world";
    bottomTab: "timeline" | "console" | "generation";
    bottomOpen: boolean;
    showStats: boolean;
    showGrid: boolean;
    sheet: null | "hierarchy" | "inspector" | "ai" | "library" | "tools" | "world" | "timeline";
    focusToken: number;
  };
  logs: LogEntry[];
  generation: { running: boolean; stages: StageState[]; error: string | null; prompt: string } | null;
  aiPreview: AiPreview | null;
  aiBusy: boolean;
  aiHistory: AiHistoryItem[];
  clipboard: ClipboardData | null;
  transientBase: WorldDoc | null;

  loadDoc(doc: WorldDoc, opts?: { projectId?: string | null; saved?: boolean }): void;
  closeDoc(): void;
  exec(label: string, recipe: (d: Draft<WorldDoc>) => void): boolean;
  beginTransient(): void;
  updateTransient(recipe: (d: Draft<WorldDoc>) => void): void;
  commitTransient(label: string, recipe: (d: Draft<WorldDoc>) => void): void;
  cancelTransient(): void;
  undo(): void;
  redo(): void;
  markSaved(projectId: string, updatedAt: number): void;
  select(ids: string[], mode?: "replace" | "add" | "toggle"): void;
  setTool(tool: Tool): void;
  setUi(patch: Partial<EditorState["ui"]>): void;
  log(level: LogEntry["level"], message: string): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  groupSelection(): void;
  ungroupSelection(): void;
  toggleVisibility(ids?: string[]): void;
  toggleLock(ids?: string[]): void;
  rename(id: string, name: string): void;
  copySelection(): void;
  paste(): void;
  applyOperations(prompt: string, ops: Operation[], source: string): OpResult | null;
  previewOperations(ops: Operation[]): OpResult;
}

let logId = 0;
let aiId = 0;

/** Selección limpia: solo entidades existentes. */
function cleanSelection(doc: WorldDoc | null, ids: string[]): string[] {
  if (!doc) return [];
  return ids.filter((id) => doc.entities[id]);
}

export const useEditor = create<EditorState>()((set, get) => ({
  doc: null,
  history: emptyHistory(),
  projectId: null,
  savedUpdatedAt: null,
  selection: [],
  tool: "move",
  space: "world",
  snap: { grid: false, translate: 1, rotateDeg: 15, scale: 0.25, surface: true },
  cameraMode: "orbit",
  mode: "edit",
  exploreView: "third",
  simPlaying: true,
  simResetToken: 0,
  playback: { playing: false, time: 0, speed: 1, cameraOverride: false },
  brush: { mode: "raise", radius: 12, strength: 1.2, paint: 1 },
  roadDraft: [],
  ui: { leftTab: "hierarchy", rightTab: "inspector", bottomTab: "console", bottomOpen: true, showStats: false, showGrid: false, sheet: null, focusToken: 0 },
  logs: [],
  generation: null,
  aiPreview: null,
  aiBusy: false,
  aiHistory: [],
  clipboard: null,
  transientBase: null,

  loadDoc(doc, opts = {}) {
    set({
      doc,
      history: emptyHistory(),
      projectId: opts.projectId ?? null,
      savedUpdatedAt: opts.saved ? doc.updatedAt : null,
      selection: [],
      aiPreview: null,
      transientBase: null,
      playback: { playing: false, time: 0, speed: 1, cameraOverride: false },
      mode: "edit",
      simResetToken: get().simResetToken + 1,
    });
  },

  closeDoc() {
    set({ doc: null, history: emptyHistory(), projectId: null, savedUpdatedAt: null, selection: [], aiPreview: null });
  },

  exec(label, recipe) {
    const { doc, history } = get();
    if (!doc) return false;
    const r = execute(doc, history, label, recipe as (d: Draft<WorldDoc>) => void);
    if (!r.changed) return false;
    set({ doc: r.doc, history: r.history, selection: cleanSelection(r.doc, get().selection) });
    return true;
  },

  beginTransient() {
    const { doc } = get();
    if (doc) set({ transientBase: doc });
  },

  updateTransient(recipe) {
    const { doc } = get();
    if (!doc) return;
    set({ doc: produce(doc, recipe) });
  },

  commitTransient(label, recipe) {
    const { transientBase, history } = get();
    if (!transientBase) return;
    const r = execute(transientBase, history, label, recipe);
    set({ doc: r.changed ? r.doc : transientBase, history: r.history, transientBase: null });
  },

  cancelTransient() {
    const { transientBase } = get();
    if (transientBase) set({ doc: transientBase, transientBase: null });
  },

  undo() {
    const { doc, history } = get();
    if (!doc) return;
    const r = historyUndo(doc, history);
    if (!r.entry) return;
    set({ doc: r.doc, history: r.history, selection: cleanSelection(r.doc, get().selection) });
    get().log("info", `Deshacer: ${r.entry.label}`);
  },

  redo() {
    const { doc, history } = get();
    if (!doc) return;
    const r = historyRedo(doc, history);
    if (!r.entry) return;
    set({ doc: r.doc, history: r.history, selection: cleanSelection(r.doc, get().selection) });
    get().log("info", `Rehacer: ${r.entry.label}`);
  },

  markSaved(projectId, updatedAt) {
    set({ projectId, savedUpdatedAt: updatedAt });
  },

  select(ids, mode = "replace") {
    const doc = get().doc;
    const valid = cleanSelection(doc, ids).filter((id) => id !== ROOT_ID);
    if (mode === "replace") set({ selection: valid });
    else if (mode === "add") set({ selection: [...new Set([...get().selection, ...valid])] });
    else {
      const cur = new Set(get().selection);
      for (const id of valid) cur.has(id) ? cur.delete(id) : cur.add(id);
      set({ selection: [...cur] });
    }
  },

  setTool(tool) {
    set({ tool });
  },

  setUi(patch) {
    set({ ui: { ...get().ui, ...patch } });
  },

  log(level, message) {
    const logs = [...get().logs, { id: ++logId, at: Date.now(), level, message }];
    set({ logs: logs.length > 400 ? logs.slice(-400) : logs });
  },

  deleteSelection() {
    const { doc, selection } = get();
    if (!doc) return;
    const ids = selection.filter((id) => doc.entities[id] && !PROTECTED_TYPES.has(doc.entities[id]!.type) && !isEffectivelyLocked(doc, id));
    if (!ids.length) return;
    const n = ids.length;
    get().exec(n === 1 ? `Eliminar ${doc.entities[ids[0]!]!.name}` : `Eliminar ${n} objetos`, (d) => {
      for (const id of ids) if (d.entities[id]) removeEntity(d as WorldDoc, id);
    });
    set({ selection: [] });
  },

  duplicateSelection() {
    const { doc, selection } = get();
    if (!doc) return;
    const ids = selection.filter((id) => doc.entities[id] && !NON_TRANSFORMABLE.has(doc.entities[id]!.type));
    if (!ids.length) return;
    let copies: string[] = [];
    get().exec(`Duplicar ${ids.length} objeto(s)`, (d) => {
      copies = ids.map((id) => duplicateEntity(d as WorldDoc, id, [3, 0, 3]));
    });
    set({ selection: copies });
  },

  groupSelection() {
    const { doc, selection } = get();
    if (!doc) return;
    const ids = selection.filter((id) => doc.entities[id] && !NON_TRANSFORMABLE.has(doc.entities[id]!.type));
    if (!ids.length) return;
    let gid = "";
    get().exec(`Agrupar ${ids.length} objetos`, (d) => {
      gid = groupEntities(d as WorldDoc, ids);
    });
    if (gid) set({ selection: [gid] });
  },

  ungroupSelection() {
    const { doc, selection } = get();
    if (!doc) return;
    const groups = selection.filter((id) => doc.entities[id]?.type === "group");
    if (!groups.length) return;
    let children: string[] = [];
    get().exec("Desagrupar", (d) => {
      for (const g of groups) children.push(...ungroupEntity(d as WorldDoc, g));
    });
    set({ selection: children });
  },

  toggleVisibility(ids) {
    const { doc, selection } = get();
    const target = ids ?? selection;
    if (!doc || !target.length) return;
    const first = doc.entities[target[0]!];
    if (!first) return;
    const visible = !first.visible;
    get().exec(visible ? "Mostrar" : "Ocultar", (d) => {
      for (const id of target) if (d.entities[id] && d.entities[id]!.type !== "world") d.entities[id]!.visible = visible;
    });
  },

  toggleLock(ids) {
    const { doc, selection } = get();
    const target = ids ?? selection;
    if (!doc || !target.length) return;
    const first = doc.entities[target[0]!];
    if (!first) return;
    const locked = !first.locked;
    get().exec(locked ? "Bloquear" : "Desbloquear", (d) => {
      for (const id of target) if (d.entities[id] && d.entities[id]!.type !== "world") d.entities[id]!.locked = locked;
    });
  },

  rename(id, name) {
    const clean = name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
    if (!clean) return;
    get().exec(`Renombrar a ${clean}`, (d) => {
      if (d.entities[id]) d.entities[id]!.name = clean;
    });
  },

  copySelection() {
    const { doc, selection } = get();
    if (!doc) return;
    const roots = selection.filter((id) => doc.entities[id] && !NON_TRANSFORMABLE.has(doc.entities[id]!.type));
    if (!roots.length) return;
    const entities: Entity[] = [];
    const visit = (id: string) => {
      const e = doc.entities[id];
      if (!e) return;
      // Las raíces copiadas guardan su transformación de mundo.
      const copy = structuredClone(e) as Entity;
      if (roots.includes(id)) copy.transform = matrixToTransform(worldMatrix(doc, id));
      entities.push(copy);
      e.children.forEach(visit);
    };
    roots.forEach(visit);
    set({ clipboard: { entities, roots } });
    get().log("info", `Copiado: ${roots.length} objeto(s)`);
  },

  paste() {
    const { clipboard, doc } = get();
    if (!clipboard || !doc) return;
    const created: string[] = [];
    get().exec(`Pegar ${clipboard.roots.length} objeto(s)`, (d) => {
      const map = new Map<string, string>();
      for (const e of clipboard.entities) map.set(e.id, newId(e.type.slice(0, 1)));
      for (const src of clipboard.entities) {
        const e = structuredClone(src) as Entity;
        e.id = map.get(src.id)!;
        e.children = [];
        e.name = allocateName(d as WorldDoc, namePrefix(e));
        const isRoot = clipboard.roots.includes(src.id);
        if (isRoot) {
          e.transform.position = [e.transform.position[0] + 3, e.transform.position[1], e.transform.position[2] + 3];
          insertEntity(d as WorldDoc, e);
          created.push(e.id);
        } else insertEntity(d as WorldDoc, e, map.get(src.parentId ?? "") ?? null);
      }
    });
    set({ selection: created });
  },

  previewOperations(ops) {
    const { doc, selection, history } = get();
    let result: OpResult = { summary: [], warnings: ["No hay mundo abierto"], created: [] };
    if (!doc) return result;
    produce(doc, (d) => {
      result = executeOperations(d as WorldDoc, ops, { selection, seed: doc.seed + history.past.length * 7919 });
    });
    return result;
  },

  applyOperations(prompt, ops, source) {
    const { doc, selection, history } = get();
    if (!doc) return null;
    let result: OpResult | null = null;
    const changed = get().exec(`IA: ${prompt.slice(0, 48)}`, (d) => {
      result = executeOperations(d as WorldDoc, ops, { selection, seed: doc.seed + history.past.length * 7919 });
    });
    const r = result as OpResult | null;
    if (r?.select) set({ selection: cleanSelection(get().doc, r.select) });
    set({
      aiHistory: [...get().aiHistory, { id: ++aiId, prompt, summary: r?.summary ?? [], status: (changed ? "applied" : "failed") as AiHistoryItem["status"], at: Date.now(), source }].slice(-100),
      aiPreview: null,
    });
    if (r) {
      for (const s of r.summary) get().log("success", s);
      for (const w of r.warnings) get().log("warn", w);
    }
    if (!changed) get().log("warn", "La instrucción no produjo cambios en el mundo");
    return r;
  },
}));

export const isDirty = (s: EditorState) => !!s.doc && s.doc.updatedAt !== s.savedUpdatedAt;

/**
 * Selector con igualdad personalizada (zustand 5 no la acepta directamente):
 * devuelve la misma referencia mientras `equal` diga que no cambió.
 */
export function useEditorWith<T>(selector: (s: EditorState) => T, equal: (a: T, b: T) => boolean): T {
  const prev = useRef<{ value: T } | null>(null);
  return useEditor((s) => {
    const next = selector(s);
    if (prev.current && equal(prev.current.value, next)) return prev.current.value;
    prev.current = { value: next };
    return next;
  });
}
