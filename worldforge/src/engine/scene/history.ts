import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import type { WorldDoc } from "../types";

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  at: number;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const MAX_HISTORY = 200;

export function emptyHistory(): History {
  return { past: [], future: [] };
}

export type Recipe = (draft: Draft<WorldDoc>) => void;

/**
 * Aplica una modificación al documento y la registra como un paso deshacible.
 * Toda edición del documento pasa por acá: así cada cambio es reversible.
 */
export function execute(doc: WorldDoc, history: History, label: string, recipe: Recipe): { doc: WorldDoc; history: History; changed: boolean } {
  const [next, patches, inverse] = produceWithPatches(doc, (draft) => {
    recipe(draft);
  });
  if (patches.length === 0) return { doc, history, changed: false };
  const stamped = applyPatches(next, [{ op: "replace", path: ["updatedAt"], value: Date.now() }]);
  const past = [...history.past, { label, patches, inverse, at: Date.now() }];
  if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY);
  return { doc: stamped, history: { past, future: [] }, changed: true };
}

export function undo(doc: WorldDoc, history: History): { doc: WorldDoc; history: History; entry: HistoryEntry | null } {
  const entry = history.past[history.past.length - 1];
  if (!entry) return { doc, history, entry: null };
  return {
    doc: applyPatches(doc, entry.inverse),
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] },
    entry,
  };
}

export function redo(doc: WorldDoc, history: History): { doc: WorldDoc; history: History; entry: HistoryEntry | null } {
  const entry = history.future[0];
  if (!entry) return { doc, history, entry: null };
  return {
    doc: applyPatches(doc, entry.patches),
    history: { past: [...history.past, entry], future: history.future.slice(1) },
    entry,
  };
}
