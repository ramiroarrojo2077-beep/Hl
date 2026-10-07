import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { HOST, PROVEEDORES, PUERTO, RAIZ, TOKEN, USUARIO } from "./config.ts";
import { datos, guardar, nuevoId } from "./almacen.ts";
import { emitir, escuchar } from "./eventos.ts";
import { ErrorIA, proveedoresActivos } from "./ia.ts";
import { chat, emailEntrante, iniciarAgenda, resumenDelDia, whatsappEntrante } from "./asistente.ts";
import { cambiarActiva, descartarPropuesta, editarPropuesta, enviarPropuesta } from "./acciones.ts";
import { clima, noticias, sistema } from "./info.ts";
import { listarVoces, puedeTranscribir, sintetizar, transcribir, vozNatural } from "./voz.ts";
import { estadoEmail, iniciarEmail } from "./conectores/email.ts";
import { estadoWhatsapp, iniciarWhatsapp } from "./conectores/whatsapp.ts";
import { estadoTelegram, iniciarTelegram } from "./conectores/telegram.ts";

const PUBLICO = path.join(RAIZ, "public");
const MAX_CUERPO = 16 * 1024 * 1024;
const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const ES_LOCAL = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";

if (!ES_LOCAL && !TOKEN) {
  console.error("JARVIS_HOST permite conexiones de otras compus: definí también JARVIS_TOKEN para proteger la API.");
  process.exit(1);
}

class ErrorHttp extends Error {
  readonly estado: number;
  constructor(estado: number, message: string) {
    super(message);
    this.estado = estado;
  }
}

function responderJson(res: http.ServerResponse, estado: number, cuerpo: unknown): void {
  res.writeHead(estado, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(cuerpo));
}

async function leerCuerpo(req: http.IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > MAX_CUERPO) throw new ErrorHttp(413, "El cuerpo es demasiado grande.");
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

async function leerJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const cuerpo = (await leerCuerpo(req)).toString("utf8");
  if (!cuerpo.trim()) return {};
  try {
    const json = JSON.parse(cuerpo);
    if (json && typeof json === "object" && !Array.isArray(json)) return json;
  } catch {}
  throw new ErrorHttp(400, "El cuerpo tiene que ser un objeto JSON.");
}

function abrirSse(res: http.ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  return (evento: string, datos: unknown) => {
    if (!res.writableEnded) res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
  };
}

function estado() {
  return {
    usuario: USUARIO,
    activa: datos.activa,
    ia: proveedoresActivos(),
    voz: puedeTranscribir(),
    vozNatural: vozNatural(),
    email: estadoEmail(),
    whatsapp: estadoWhatsapp(),
    telegram: estadoTelegram(),
  };
}

// Bloquea que una página web cualquiera abierta en tu navegador use la API de Jarvis.
function autorizado(req: http.IncomingMessage, url: URL): boolean {
  const host = req.headers.host ?? "";
  if (ES_LOCAL && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false;
  const origen = req.headers.origin;
  if (origen && origen !== `http://${host}` && origen !== "null") return false;
  if (!TOKEN) return true;
  const enviado = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("token") ?? "";
  return enviado === TOKEN;
}

async function manejarChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const cuerpo = await leerJson(req);
  const mensaje = typeof cuerpo.mensaje === "string" ? cuerpo.mensaje.trim().slice(0, 8000) : "";
  if (!mensaje) throw new ErrorHttp(400, 'Falta "mensaje".');
  const canal = cuerpo.canal === "voz" ? "voz" : cuerpo.canal === "texto" ? "texto" : "api";
  const enVivo = cuerpo.stream === true || (req.headers.accept ?? "").includes("text/event-stream");

  const control = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) control.abort();
  });

  if (!enVivo) {
    const respuesta = await chat(mensaje, { canal, signal: control.signal });
    responderJson(res, 200, { respuesta });
    return;
  }
  const enviar = abrirSse(res);
  try {
    const respuesta = await chat(mensaje, {
      canal,
      signal: control.signal,
      onTexto: (delta) => enviar("texto", { delta }),
      onHerramienta: (nombre) => enviar("herramienta", { nombre }),
    });
    enviar("fin", { respuesta });
  } catch (err) {
    if (!control.signal.aborted) {
      console.error(err);
      enviar("error", { mensaje: mensajeDeError(err) });
    }
  }
  res.end();
}

function mensajeDeError(err: unknown): string {
  const texto = err instanceof Error ? err.message : String(err);
  if (err instanceof ErrorIA) {
    if (err.estado === 401 || err.estado === 403) return "La clave de la IA es inválida. Revisá el archivo .env.";
    if (err.estado === 429) return "Se terminó el cupo gratis de la IA por ahora. Probá en un rato o agregá otro proveedor en el .env.";
    if (err.estado === undefined) return texto;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|timeout|aborted/i.test(texto)) return "No me pude conectar. Revisá la conexión a internet.";
  return texto.length < 200 ? texto : "Algo falló. Probá de nuevo.";
}

type Ruta = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, id: string) => Promise<void> | void;

const RUTAS: [string, RegExp, Ruta][] = [
  ["GET", /^\/api\/estado$/, (_q, res) => responderJson(res, 200, estado())],
  [
    "POST",
    /^\/api\/activa$/,
    async (req, res) => {
      const { activa } = await leerJson(req);
      if (typeof activa !== "boolean") throw new ErrorHttp(400, 'Falta "activa" (true o false).');
      cambiarActiva(activa);
      responderJson(res, 200, { activa });
    },
  ],
  [
    "GET",
    /^\/api\/eventos$/,
    (req, res) => {
      const enviar = abrirSse(res);
      enviar("estado", estado());
      const dejar = escuchar(({ tipo, datos }) => enviar(tipo, tipo === "estado" ? estado() : datos));
      const latido = setInterval(() => res.write(": latido\n\n"), 25_000);
      req.on("close", () => {
        dejar();
        clearInterval(latido);
      });
    },
  ],
  ["POST", /^\/api\/chat$/, manejarChat],
  [
    "POST",
    /^\/api\/transcribir$/,
    async (req, res) => {
      const audio = await leerCuerpo(req);
      if (audio.length < 1000) throw new ErrorHttp(400, "El audio está vacío.");
      try {
        responderJson(res, 200, { texto: await transcribir(audio, req.headers["content-type"] ?? "audio/webm") });
      } catch (err) {
        console.warn(`[voz] ${(err as Error).message}`);
        throw new ErrorHttp(502, "No pude entender el audio. Revisá GROQ_API_KEY o GEMINI_API_KEY.");
      }
    },
  ],
  [
    "POST",
    /^\/api\/hablar$/,
    async (req, res) => {
      const { texto } = await leerJson(req);
      if (typeof texto !== "string" || !texto.trim()) throw new ErrorHttp(400, 'Falta "texto".');
      if (!vozNatural()) throw new ErrorHttp(503, "La voz de ElevenLabs no está disponible.");
      try {
        const audio = await sintetizar(texto);
        res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": audio.length, "Cache-Control": "no-store" });
        res.end(audio);
      } catch (err) {
        console.warn(`[voz] ${(err as Error).message}`);
        throw new ErrorHttp(503, "La voz de ElevenLabs falló; usá la del sistema.");
      }
    },
  ],
  [
    "GET",
    /^\/api\/voces$/,
    async (_q, res) =>
      responderJson(
        res,
        200,
        (await listarVoces()).map((v) => ({ id: v.voice_id, nombre: v.name, tipo: v.category, etiquetas: v.labels })),
      ),
  ],
  ["GET", /^\/api\/historial$/, (_q, res) => responderJson(res, 200, datos.historial.slice(-100))],
  [
    "DELETE",
    /^\/api\/historial$/,
    (_q, res) => {
      datos.historial = [];
      guardar();
      responderJson(res, 200, { listo: true });
    },
  ],
  ["GET", /^\/api\/memoria$/, (_q, res) => responderJson(res, 200, datos.memoria)],
  [
    "DELETE",
    /^\/api\/memoria\/([\w-]+)$/,
    (_q, res, _u, id) => {
      datos.memoria = datos.memoria.filter((d) => d.id !== id);
      guardar();
      emitir("memoria", datos.memoria);
      responderJson(res, 200, { listo: true });
    },
  ],
  ["GET", /^\/api\/recordatorios$/, (_q, res) => responderJson(res, 200, datos.recordatorios.filter((r) => !r.avisado))],
  [
    "POST",
    /^\/api\/recordatorios$/,
    async (req, res) => {
      const { texto, cuando } = await leerJson(req);
      const fecha = new Date(String(cuando ?? ""));
      if (typeof texto !== "string" || !texto.trim() || Number.isNaN(fecha.getTime())) {
        throw new ErrorHttp(400, 'Hacen falta "texto" y "cuando" (fecha ISO 8601).');
      }
      const recordatorio = { id: nuevoId(), texto: texto.trim(), cuando: fecha.toISOString(), avisado: false };
      datos.recordatorios.push(recordatorio);
      guardar();
      emitir("recordatorios", datos.recordatorios);
      responderJson(res, 201, recordatorio);
    },
  ],
  [
    "DELETE",
    /^\/api\/recordatorios\/([\w-]+)$/,
    (_q, res, _u, id) => {
      datos.recordatorios = datos.recordatorios.filter((r) => r.id !== id);
      guardar();
      emitir("recordatorios", datos.recordatorios);
      responderJson(res, 200, { listo: true });
    },
  ],
  [
    "GET",
    /^\/api\/avisos$/,
    (_q, res, url) => responderJson(res, 200, datos.avisos.slice(-Math.min(200, Number(url.searchParams.get("cantidad")) || 30)).reverse()),
  ],
  [
    "GET",
    /^\/api\/propuestas$/,
    (_q, res, url) => {
      const filtro = url.searchParams.get("estado");
      responderJson(res, 200, datos.propuestas.filter((p) => !filtro || p.estado === filtro).reverse());
    },
  ],
  [
    "PATCH",
    /^\/api\/propuestas\/([\w-]+)$/,
    async (req, res, _u, id) => {
      const { texto, asunto } = await leerJson(req);
      responderJson(res, 200, editarPropuesta(id, { texto: texto as string | undefined, asunto: asunto as string | undefined }));
    },
  ],
  [
    "POST",
    /^\/api\/propuestas\/([\w-]+)\/enviar$/,
    async (req, res, _u, id) => {
      const { texto, asunto } = await leerJson(req);
      responderJson(res, 200, await enviarPropuesta(id, { texto: texto as string | undefined, asunto: asunto as string | undefined }));
    },
  ],
  ["POST", /^\/api\/propuestas\/([\w-]+)\/descartar$/, (_q, res, _u, id) => responderJson(res, 200, descartarPropuesta(id))],
  ["GET", /^\/api\/sistema$/, async (_q, res) => responderJson(res, 200, await sistema())],
  ["GET", /^\/api\/clima$/, async (_q, res, url) => responderJson(res, 200, await clima(url.searchParams.get("ciudad") ?? undefined))],
  ["GET", /^\/api\/noticias$/, async (_q, res, url) => responderJson(res, 200, await noticias(url.searchParams.get("tema") ?? "", 12))],
  ["GET", /^\/api\/resumen$/, async (_q, res) => responderJson(res, 200, { texto: await resumenDelDia() })],
];

async function servirArchivo(res: http.ServerResponse, ruta: string): Promise<boolean> {
  const archivo = path.join(PUBLICO, ruta === "/" ? "index.html" : decodeURIComponent(ruta));
  if (!archivo.startsWith(PUBLICO + path.sep)) return false;
  try {
    const contenido = await readFile(archivo);
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(contenido);
    return true;
  } catch {
    return false;
  }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      if (!autorizado(req, url)) throw new ErrorHttp(401, "No autorizado.");
      for (const [metodo, patron, ruta] of RUTAS) {
        const coincidencia = url.pathname.match(patron);
        if (coincidencia && req.method === metodo) {
          await ruta(req, res, url, coincidencia[1] ?? "");
          return;
        }
      }
      throw new ErrorHttp(404, "Ruta no encontrada.");
    }
    if (req.method === "GET" && (await servirArchivo(res, url.pathname))) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
  } catch (err) {
    const estadoHttp = err instanceof ErrorHttp ? err.estado : err instanceof ErrorIA ? 503 : 500;
    if (estadoHttp === 500) console.error(err);
    else if (estadoHttp === 503) console.warn(`[ia] ${(err as Error).message}`);
    if (!res.headersSent) responderJson(res, estadoHttp, { error: err instanceof ErrorHttp ? err.message : mensajeDeError(err) });
    else res.end();
  }
});

servidor.listen(PUERTO, HOST, () => {
  console.log(`\n  J.A.R.V.I.S. en línea → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PUERTO}\n`);
  if (PROVEEDORES.length === 0) console.warn("  ⚠ No hay IA configurada: poné GEMINI_API_KEY o GROQ_API_KEY en el .env");
  else console.log(`  IA: ${PROVEEDORES.map((p) => `${p.nombre} (${p.modelo})`).join(" → ")}`);
  console.log(`  Voz: ${puedeTranscribir() ? "sí" : "no (falta GROQ_API_KEY o GEMINI_API_KEY)"}\n`);

  iniciarEmail(emailEntrante);
  iniciarWhatsapp(whatsappEntrante, transcribir);
  iniciarTelegram({
    onMensaje: (texto) => chat(texto, { canal: "telegram" }).catch((err) => mensajeDeError(err)),
    onAudio: (audio, tipo) => transcribir(audio, tipo),
    onEnviar: async (id) => {
      try {
        const p = await enviarPropuesta(id);
        return `✅ Enviado a ${p.paraNombre}.`;
      } catch (err) {
        return `❌ ${(err as Error).message}`;
      }
    },
    onDescartar: async (id) => {
      try {
        descartarPropuesta(id);
        return "🗑️ Descartado.";
      } catch (err) {
        return `❌ ${(err as Error).message}`;
      }
    },
    onEditar: (id, texto) => {
      try {
        return editarPropuesta(id, { texto });
      } catch {
        return undefined;
      }
    },
  });
  iniciarAgenda();
});
