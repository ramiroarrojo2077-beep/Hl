import { FORMAT_ID, FORMAT_VERSION, LIMITS, WorldDocSchema, sanitizeText, type WorldDoc } from "../types";
import { validateAndRepair } from "../generation/validator";

/**
 * Serialización versionada de proyectos. Los archivos importados se validan
 * contra el esquema, se migran si son de una versión anterior y se reparan.
 */

export interface ProjectFile {
  app: "worldforge";
  fileVersion: 1;
  exportedAt: number;
  doc: WorldDoc;
  /** Recursos binarios (modelos GLB importados) en base64. */
  assets: Record<string, string>;
}

export class ImportError extends Error {}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
/** Migraciones por versión de formato: MIGRATIONS[n] lleva de n a n + 1. */
const MIGRATIONS: Record<number, Migration> = {};

export function migrateDoc(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") throw new ImportError("El archivo no contiene un mundo válido.");
  let doc = raw as Record<string, unknown>;
  if (doc.format !== FORMAT_ID) throw new ImportError("El archivo no es un proyecto de WorldForge.");
  let v = Number(doc.formatVersion);
  if (!Number.isInteger(v) || v < 1) throw new ImportError("Versión de formato desconocida.");
  if (v > FORMAT_VERSION) throw new ImportError(`El proyecto se creó con una versión más nueva de WorldForge (formato ${v}).`);
  while (v < FORMAT_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new ImportError(`No hay migración desde la versión ${v}.`);
    doc = m(doc);
    v++;
    doc.formatVersion = v;
  }
  return doc;
}

/** Valida un documento desconocido (archivo, IndexedDB, IA) y lo deja listo para usar. */
export function parseDoc(raw: unknown): { doc: WorldDoc; warnings: string[] } {
  const migrated = migrateDoc(raw);
  const result = WorldDocSchema.safeParse(migrated);
  if (!result.success) {
    const first = result.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ImportError(`El proyecto tiene datos inválidos (${first.join("; ")}).`);
  }
  const doc = result.data;
  if (Object.keys(doc.entities).length > LIMITS.maxEntities) throw new ImportError("El proyecto supera el límite de entidades.");
  doc.name = sanitizeText(doc.name) || "Mundo importado";
  const report = validateAndRepair(doc);
  return { doc, warnings: report.issues.filter((i) => i.severity !== "info").map((i) => i.message) };
}

export function serializeProject(doc: WorldDoc, assets: Record<string, string> = {}): string {
  const file: ProjectFile = { app: "worldforge", fileVersion: 1, exportedAt: Date.now(), doc, assets };
  return JSON.stringify(file);
}

export function parseProjectFile(text: string): { doc: WorldDoc; assets: Record<string, string>; warnings: string[] } {
  if (text.length > LIMITS.maxFileBytes) throw new ImportError("El archivo es demasiado grande.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError("El archivo no es JSON válido.");
  }
  if (!raw || typeof raw !== "object") throw new ImportError("Archivo vacío o inválido.");
  const obj = raw as Record<string, unknown>;
  // Acepta tanto el contenedor de proyecto como un documento suelto.
  const docRaw = obj.app === "worldforge" ? obj.doc : obj;
  const assetsRaw = obj.app === "worldforge" && obj.assets && typeof obj.assets === "object" ? (obj.assets as Record<string, unknown>) : {};
  const assets: Record<string, string> = {};
  for (const [k, v] of Object.entries(assetsRaw)) {
    if (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(k) && /^[A-Za-z0-9+/=]*$/.test(v.slice(0, 200))) assets[k] = v;
  }
  const { doc, warnings } = parseDoc(docRaw);
  return { doc, assets, warnings };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
