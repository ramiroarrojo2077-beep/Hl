/**
 * Servidor de EARTH NEXT:
 *  - /api/status                estado (IA, PostGIS)
 *  - /api/assistant  (POST/SSE) asistente geográfico con Claude
 *  - /api/proxy/metar           observaciones METAR (la fuente no permite CORS)
 *  - /api/places, /api/features datos geográficos en PostGIS (opcional)
 *  - archivos estáticos de dist/ en producción
 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runAssistant, aiAvailable, MODEL, type AssistantContext } from "./assistant.ts";
import { metarBbox } from "./geodata.ts";
import { initDb, dbReady, dbError, placesInBBox, placesNear, insertPlace, deletePlace, insertFeatures, featuresInBBox } from "./db.ts";

const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../dist");
const VERSION = "0.1.0";
const MAX_BODY = 64 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".xml": "application/xml",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
};

// ---------------------------------------------------------------- utilidades HTTP

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("Cuerpo demasiado grande");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** Límite simple por IP: N pedidos por ventana. */
const buckets = new Map<string, { count: number; reset: number }>();
function rateLimited(req: http.IncomingMessage, key: string, limit: number, windowMs: number): boolean {
  const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.socket.remoteAddress ?? "?").trim();
  const k = `${key}:${ip}`;
  const now = Date.now();
  const b = buckets.get(k);
  if (!b || b.reset < now) {
    buckets.set(k, { count: 1, reset: now + windowMs });
    return false;
  }
  b.count++;
  return b.count > limit;
}

function aiErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "La clave de la API de Anthropic del servidor falta o es inválida.";
  if (err instanceof Anthropic.RateLimitError) return "Demasiadas consultas al modelo. Probá en un minuto.";
  if (err instanceof Anthropic.APIConnectionError) return "No se pudo conectar con el servicio de IA.";
  if (err instanceof Anthropic.APIError) return `Error del servicio de IA (${err.status ?? "sin código"}).`;
  return err instanceof Error ? err.message : "Error inesperado.";
}

// ---------------------------------------------------------------- rutas

const AssistantBody = z.object({
  conversationId: z.string().max(64).optional(),
  message: z.string().min(1).max(4000),
  context: z.object({
    lang: z.string().max(5).default("es"),
    camera: z.object({ lat: z.number(), lon: z.number(), height: z.number(), heading: z.number(), pitch: z.number() }).optional(),
    view: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }).optional(),
    selection: z.object({ title: z.string().max(200), lat: z.number(), lon: z.number() }).nullable().optional(),
    sceneTime: z.string().max(40).optional(),
    layers: z.array(z.string().max(40)).max(30).optional(),
  }),
});

async function handleAssistant(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!aiAvailable()) return sendJson(res, 503, { error: "IA no configurada en el servidor (ANTHROPIC_API_KEY).", fallback: true });
  if (rateLimited(req, "ai", 30, 60_000)) return sendJson(res, 429, { error: "Demasiadas consultas. Esperá un minuto." });
  let body: z.infer<typeof AssistantBody>;
  try {
    body = AssistantBody.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, { error: `Pedido inválido: ${err instanceof Error ? err.message : String(err)}` });
  }
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const ctrl = new AbortController();
  res.on("close", () => ctrl.abort());
  const emit = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ping = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 15000);
  try {
    await runAssistant({ conversationId: body.conversationId, message: body.message, context: body.context as AssistantContext, emit, signal: ctrl.signal });
  } catch (err) {
    if (!ctrl.signal.aborted) {
      console.error("[assistant]", err);
      emit("error", { message: aiErrorMessage(err) });
    }
  } finally {
    clearInterval(ping);
    res.end();
  }
}

const num = (v: string | null) => (v === null || v === "" ? NaN : Number(v));

async function handlePlaces(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (!dbReady()) return sendJson(res, 503, { error: "PostGIS no configurado (DATABASE_URL).", detail: dbError() });
  if (req.method === "GET") {
    const near = url.searchParams.get("near");
    if (near) {
      const [lat, lon] = near.split(",").map(Number);
      const radius = Math.min(500_000, num(url.searchParams.get("radius")) || 5000);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendJson(res, 400, { error: "near=lat,lon" });
      return sendJson(res, 200, await placesNear(lat!, lon!, radius));
    }
    const bbox = (url.searchParams.get("bbox") ?? "-180,-90,180,90").split(",").map(Number);
    if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) return sendJson(res, 400, { error: "bbox=oeste,sur,este,norte" });
    return sendJson(res, 200, await placesInBBox(bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!, url.searchParams.get("collection") ?? undefined));
  }
  if (req.method === "POST") {
    if (rateLimited(req, "places", 120, 60_000)) return sendJson(res, 429, { error: "Demasiados pedidos" });
    const schema = z.object({ name: z.string().min(1).max(200), collection: z.string().max(100).optional(), note: z.string().max(2000).optional(), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), camera: z.unknown().optional() });
    try {
      const p = schema.parse(await readBody(req));
      return sendJson(res, 201, await insertPlace(p));
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (req.method === "DELETE") {
    const id = Number(url.pathname.split("/").pop());
    if (!Number.isInteger(id)) return sendJson(res, 400, { error: "id inválido" });
    return sendJson(res, (await deletePlace(id)) ? 200 : 404, { ok: true });
  }
  sendJson(res, 405, { error: "Método no permitido" });
}

async function handleFeatures(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (!dbReady()) return sendJson(res, 503, { error: "PostGIS no configurado (DATABASE_URL)." });
  const project = (url.searchParams.get("project") ?? "default").slice(0, 80);
  if (req.method === "GET") {
    const b = (url.searchParams.get("bbox") ?? "-180,-90,180,90").split(",").map(Number);
    if (b.length !== 4 || b.some((v) => !Number.isFinite(v))) return sendJson(res, 400, { error: "bbox inválido" });
    return sendJson(res, 200, await featuresInBBox(project, b[0]!, b[1]!, b[2]!, b[3]!));
  }
  if (req.method === "POST") {
    try {
      const fc = z.object({ type: z.literal("FeatureCollection"), features: z.array(z.object({ geometry: z.unknown(), properties: z.unknown().optional() })).max(5000) }).parse(await readBody(req));
      return sendJson(res, 201, { inserted: await insertFeatures(project, fc) });
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  sendJson(res, 405, { error: "Método no permitido" });
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  let file = path.join(DIST, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!file.startsWith(DIST)) return sendJson(res, 403, { error: "Prohibido" });
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("no es archivo");
  } catch {
    // SPA: rutas desconocidas sirven index.html
    if (path.extname(rel)) return sendJson(res, 404, { error: "No encontrado" });
    file = path.join(DIST, "index.html");
  }
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : ext === ".html" ? "no-cache" : "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

/** Orígenes permitidos para usar la API desde otra app (p. ej. la app Android: https://localhost). */
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "https://localhost,capacitor://localhost,http://localhost")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && (CORS_ORIGINS.includes("*") || CORS_ORIGINS.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
  }
  try {
    if (url.pathname === "/api/status") return sendJson(res, 200, { ok: true, ai: aiAvailable(), model: aiAvailable() ? MODEL : undefined, postgis: dbReady(), version: VERSION });
    if (url.pathname === "/api/assistant" && req.method === "POST") return await handleAssistant(req, res);
    if (url.pathname === "/api/proxy/metar") {
      if (rateLimited(req, "metar", 60, 60_000)) return sendJson(res, 429, { error: "Demasiados pedidos" });
      const data = await metarBbox(url.searchParams.get("bbox") ?? "");
      res.setHeader("Cache-Control", "public, max-age=300");
      return sendJson(res, 200, data);
    }
    if (url.pathname.startsWith("/api/places")) return await handlePlaces(req, res, url);
    if (url.pathname.startsWith("/api/features")) return await handleFeatures(req, res, url);
    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Ruta desconocida" });
    if (req.method === "GET" || req.method === "HEAD") return await serveStatic(req, res, url);
    sendJson(res, 405, { error: "Método no permitido" });
  } catch (err) {
    console.error("[server]", err);
    if (!res.headersSent) sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
    else res.end();
  }
});

await initDb();
server.listen(PORT, () => {
  console.log(`EARTH NEXT API en http://localhost:${PORT} · IA: ${aiAvailable() ? MODEL : "no configurada (modo básico)"} · PostGIS: ${dbReady() ? "sí" : "no"}`);
});
