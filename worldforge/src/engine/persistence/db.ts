import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { WorldDoc } from "../types";
import { parseDoc } from "./io";

/**
 * Persistencia local en IndexedDB: proyectos, autoguardado para recuperación
 * tras un cierre inesperado, recursos binarios (GLB) y metadatos de sesión.
 */

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail: string | null;
  entityCount: number;
  doc: WorldDoc;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail: string | null;
  entityCount: number;
}

interface AutosaveRecord {
  id: string;
  savedAt: number;
  doc: WorldDoc;
}

interface AssetRecord {
  id: string;
  name: string;
  mime: string;
  data: Blob;
}

interface WorldForgeDB extends DBSchema {
  projects: { key: string; value: ProjectRecord; indexes: { updatedAt: number } };
  meta: { key: string; value: ProjectMeta };
  autosave: { key: string; value: AutosaveRecord };
  assets: { key: string; value: AssetRecord };
  session: { key: string; value: { key: string; value: unknown } };
}

const DB_NAME = "worldforge";
const DB_VERSION = 1;
let dbPromise: Promise<IDBPDatabase<WorldForgeDB>> | null = null;

function db(): Promise<IDBPDatabase<WorldForgeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WorldForgeDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const projects = database.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("updatedAt", "updatedAt");
        database.createObjectStore("meta", { keyPath: "id" });
        database.createObjectStore("autosave", { keyPath: "id" });
        database.createObjectStore("assets", { keyPath: "id" });
        database.createObjectStore("session", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

function metaOf(r: ProjectRecord): ProjectMeta {
  return { id: r.id, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt, thumbnail: r.thumbnail, entityCount: r.entityCount };
}

export async function saveProject(doc: WorldDoc, thumbnail: string | null = null): Promise<ProjectMeta> {
  const d = await db();
  const existing = await d.get("meta", doc.id);
  const record: ProjectRecord = {
    id: doc.id,
    name: doc.name,
    createdAt: existing?.createdAt ?? doc.createdAt,
    updatedAt: Date.now(),
    thumbnail: thumbnail ?? existing?.thumbnail ?? null,
    entityCount: Object.keys(doc.entities).length,
    doc,
  };
  const tx = d.transaction(["projects", "meta", "autosave"], "readwrite");
  await tx.objectStore("projects").put(record);
  await tx.objectStore("meta").put(metaOf(record));
  // Lo guardado reemplaza al autoguardado pendiente.
  await tx.objectStore("autosave").delete(doc.id);
  await tx.done;
  return metaOf(record);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const d = await db();
  const all = await d.getAll("meta");
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Carga y valida un proyecto. Devuelve null si no existe. */
export async function loadProject(id: string): Promise<{ doc: WorldDoc; warnings: string[] } | null> {
  const d = await db();
  const r = await d.get("projects", id);
  if (!r) return null;
  return parseDoc(r.doc);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["projects", "meta", "autosave"], "readwrite");
  await tx.objectStore("projects").delete(id);
  await tx.objectStore("meta").delete(id);
  await tx.objectStore("autosave").delete(id);
  await tx.done;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const d = await db();
  const r = await d.get("projects", id);
  if (!r) return;
  r.name = name;
  r.doc = { ...r.doc, name };
  r.updatedAt = Date.now();
  const tx = d.transaction(["projects", "meta"], "readwrite");
  await tx.objectStore("projects").put(r);
  await tx.objectStore("meta").put(metaOf(r));
  await tx.done;
}

export async function autosave(doc: WorldDoc): Promise<void> {
  const d = await db();
  await d.put("autosave", { id: doc.id, savedAt: Date.now(), doc });
}

export async function getAutosave(id: string): Promise<{ savedAt: number; doc: WorldDoc } | null> {
  const d = await db();
  const r = await d.get("autosave", id);
  return r ? { savedAt: r.savedAt, doc: r.doc } : null;
}

export async function listAutosaves(): Promise<{ id: string; name: string; savedAt: number }[]> {
  const d = await db();
  const all = await d.getAll("autosave");
  return all.map((a) => ({ id: a.id, name: a.doc.name, savedAt: a.savedAt })).sort((a, b) => b.savedAt - a.savedAt);
}

export async function discardAutosave(id: string): Promise<void> {
  const d = await db();
  await d.delete("autosave", id);
}

export async function putAsset(id: string, name: string, mime: string, data: Blob): Promise<void> {
  const d = await db();
  await d.put("assets", { id, name, mime, data });
}

export async function getAsset(id: string): Promise<AssetRecord | undefined> {
  const d = await db();
  return d.get("assets", id);
}

export async function setSessionValue(key: string, value: unknown): Promise<void> {
  const d = await db();
  await d.put("session", { key, value });
}

export async function getSessionValue<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return (await d.get("session", key))?.value as T | undefined;
}
