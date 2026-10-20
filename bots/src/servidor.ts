import http from "node:http";
import { readFile, readdir, stat, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolvePath } from "@anthropic-ai/sdk/tools/agent-toolset/node";
import {
  COMPUTADORA,
  MAX_BOTS,
  ahora,
  borrarBot,
  borrarHabilidad,
  borrarRegla,
  borrarRutina,
  buscarBot,
  buscarHabilidad,
  buscarRutina,
  conversacion,
  crearBot,
  crearRutina,
  guardarEstado,
  guardarHabilidad,
  listarBots,
  listarHabilidades,
  listarReglas,
  listarRutinas,
  raizMemoria,
  type Bot,
  type Rutina,
} from "./almacen.ts";
import {
  CONFIG,
  detener,
  ejecutarRutina,
  enviarMensaje,
  estadoDe,
  listarAprobaciones,
  listarComandos,
  resolverAprobacion,
} from "./agente.ts";
import { cerrarHerramientas } from "./herramientas.ts";
import { describirHorario, iniciarProgramador, normalizarHorario, proximaEjecucion } from "./rutinas.ts";
import { vistaConversacion } from "./vista.ts";
import { PLANTILLAS } from "./plantillas.ts";
import { bus, emitir } from "./eventos.ts";

const PUERTO = Number(process.env.BOTS_PUERTO ?? 3001);
// Los bots ejecutan comandos en esta máquina: por defecto solo se atiende desde ella misma.
const HOST = process.env.BOTS_HOST ?? "127.0.0.1";
const LOCAL = ["127.0.0.1", "localhost", "::1"].includes(HOST);
const INDEX = new URL("../public/index.html", import.meta.url);
const MAX_CUERPO = 1_000_000;
const MAX_ARCHIVO_TEXTO = 1_000_000;

class ErrorHttp extends Error {
  readonly status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

// ---- Esquemas de entrada ----

const DatosBot = z.object({
  nombre: z.string().trim().min(1).max(40),
  titulo: z.string().trim().min(1).max(80),
  descripcion: z.string().trim().min(1).max(4000),
});
const DatosHorario = z.object({
  tipo: z.string(),
  minutos: z.number().nullish(),
  hora: z.string().nullish(),
  dia: z.number().nullish(),
});
const DatosRutina = z.object({
  nombre: z.string().trim().min(1).max(80),
  instrucciones: z.string().trim().min(1).max(8000),
  habilidadId: z.string().nullish(),
  horario: DatosHorario,
  activa: z.boolean().default(true),
});
const DatosHabilidad = z.object({
  nombre: z.string().trim().min(1).max(80),
  descripcion: z.string().trim().max(300).default(""),
  instrucciones: z.string().trim().min(1).max(20000),
});

function validar<T>(esquema: z.ZodType<T>, datos: unknown): T {
  const r = esquema.safeParse(datos);
  if (!r.success) throw new ErrorHttp(400, r.error.issues.map((i) => `${i.path.join(".") || "datos"}: ${i.message}`).join("; "));
  return r.data;
}

// ---- Utilidades HTTP ----

async function leerCuerpo(req: http.IncomingMessage): Promise<unknown> {
  let total = 0;
  const partes: Buffer[] = [];
  for await (const parte of req) {
    total += (parte as Buffer).length;
    if (total > MAX_CUERPO) throw new ErrorHttp(413, "El cuerpo es demasiado grande.");
    partes.push(parte as Buffer);
  }
  if (!total) return {};
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8"));
  } catch {
    throw new ErrorHttp(400, "JSON inválido.");
  }
}

function responder(res: http.ServerResponse, status: number, datos: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(datos));
}

// Bloquea pedidos de otros sitios (CSRF) y de nombres que apuntan a esta máquina (DNS rebinding).
function verificarOrigen(req: http.IncomingMessage): void {
  const host = req.headers.host ?? "";
  if (LOCAL) {
    const nombre = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (!["127.0.0.1", "localhost", "::1"].includes(nombre)) throw new ErrorHttp(403, "Host no permitido.");
  }
  if (req.method === "GET") return;
  const origen = req.headers.origin;
  if (origen && URL.parse(origen)?.host !== host) throw new ErrorHttp(403, "Origen no permitido.");
  // Exigir JSON obliga a los navegadores a pedir permiso (CORS) antes de mandar desde otro sitio.
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new ErrorHttp(415, "Se espera Content-Type: application/json.");
  }
}

// ---- Vistas ----

function vistaBot(b: Bot) {
  const e = estadoDe(b.id);
  return {
    ...b,
    ...e,
    noLeido: !!b.ultimaActividad && (!b.leido || b.ultimaActividad > b.leido),
    rutinas: listarRutinas(b.id).length,
  };
}

function vistaRutina(r: Rutina) {
  return { ...r, descripcionHorario: describirHorario(r.horario), proxima: r.activa ? proximaEjecucion(r).toISOString() : null };
}

interface Archivo {
  ruta: string;
  tamano: number;
  modificado: string;
  carpeta: boolean;
}

// Lista una carpeta recursivamente, sin ocultos ni node_modules.
async function listarArchivos(raiz: string, limite = 2000): Promise<Archivo[]> {
  const salida: Archivo[] = [];
  const recorrer = async (dir: string) => {
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entradas.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entradas) {
      if (salida.length >= limite || e.name.startsWith(".") || e.name === "node_modules") continue;
      const completa = path.join(dir, e.name);
      const info = await stat(completa).catch(() => null);
      if (!info) continue;
      salida.push({ ruta: path.relative(raiz, completa), tamano: info.size, modificado: info.mtime.toISOString(), carpeta: e.isDirectory() });
      if (e.isDirectory()) await recorrer(completa);
    }
  };
  await recorrer(raiz);
  return salida;
}

// Resuelve una ruta pedida dentro de `raiz`, siguiendo symlinks, y rechaza lo que quede afuera.
async function rutaSegura(raiz: string, ruta: string): Promise<string> {
  try {
    return await resolvePath({ workdir: raiz }, ruta);
  } catch {
    throw new ErrorHttp(400, "Ruta fuera de la carpeta.");
  }
}

async function enviarArchivo(res: http.ServerResponse, archivo: string, descargar: boolean): Promise<void> {
  const info = await stat(archivo).catch(() => null);
  if (!info?.isFile()) throw new ErrorHttp(404, "No existe el archivo.");
  const contenido = await readFile(archivo);
  const esTexto = info.size <= MAX_ARCHIVO_TEXTO && !contenido.subarray(0, 8000).includes(0);
  // Nunca se sirve como HTML: un archivo creado por un bot no puede correr código en esta página.
  res.writeHead(200, {
    "Content-Type": esTexto && !descargar ? "text/plain; charset=utf-8" : "application/octet-stream",
    "Content-Disposition": `${descargar || !esTexto ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(archivo))}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "no-store",
  });
  res.end(contenido);
}

// ---- Rutas ----

type Manejador = (p: { req: http.IncomingMessage; res: http.ServerResponse; url: URL; params: string[]; cuerpo: () => Promise<unknown> }) => Promise<unknown>;

const rutas: Array<[string, RegExp, Manejador]> = [];
const ruta = (metodo: string, patron: string, manejador: Manejador) =>
  rutas.push([metodo, new RegExp(`^${patron.replace(/:\w+/g, "([\\w-]+)")}$`), manejador]);

function botDe(id: string): Bot {
  const bot = buscarBot(id);
  if (!bot) throw new ErrorHttp(404, "No existe ese bot.");
  return bot;
}

function rutinaDe(id: string): Rutina {
  const rutina = buscarRutina(id);
  if (!rutina) throw new ErrorHttp(404, "No existe esa rutina.");
  return rutina;
}

function horarioDe(datos: z.infer<typeof DatosHorario>) {
  try {
    return normalizarHorario(datos);
  } catch (err) {
    throw new ErrorHttp(400, (err as Error).message);
  }
}

ruta("GET", "/api/estado", async () => ({
  bots: listarBots().map(vistaBot),
  habilidades: listarHabilidades(),
  reglas: listarReglas(),
  aprobaciones: listarAprobaciones(),
  plantillas: PLANTILLAS,
  config: CONFIG,
}));

ruta("POST", "/api/bots", async ({ cuerpo }) => {
  if (listarBots().length >= MAX_BOTS) throw new ErrorHttp(400, `Podés tener hasta ${MAX_BOTS} bots.`);
  const bot = crearBot(validar(DatosBot, await cuerpo()));
  emitir("bots");
  return vistaBot(bot);
});

ruta("PUT", "/api/bots/:id", async ({ params, cuerpo }) => {
  const bot = botDe(params[0]!);
  Object.assign(bot, validar(DatosBot, await cuerpo()));
  guardarEstado();
  emitir("bots");
  return vistaBot(bot);
});

ruta("DELETE", "/api/bots/:id", async ({ params }) => {
  const bot = botDe(params[0]!);
  detener(bot.id);
  borrarBot(bot.id);
  await cerrarHerramientas(bot.id);
  emitir("bots");
  return { ok: true };
});

ruta("GET", "/api/bots/:id/conversacion", async ({ params }) => vistaConversacion(conversacion(botDe(params[0]!).id)));

ruta("POST", "/api/bots/:id/mensajes", async ({ params, cuerpo }) => {
  const bot = botDe(params[0]!);
  const { texto } = validar(z.object({ texto: z.string().trim().min(1).max(20000) }), await cuerpo());
  enviarMensaje(bot.id, texto);
  return { ok: true };
});

ruta("POST", "/api/bots/:id/detener", async ({ params }) => {
  detener(botDe(params[0]!).id);
  return { ok: true };
});

ruta("POST", "/api/bots/:id/leido", async ({ params }) => {
  const bot = botDe(params[0]!);
  bot.leido = ahora();
  guardarEstado();
  return { ok: true };
});

// Memoria del bot: archivos en /memories, que se pueden ver y corregir.
ruta("GET", "/api/bots/:id/memoria", async ({ params }) => {
  const raiz = raizMemoria(botDe(params[0]!).id);
  const archivos = (await listarArchivos(raiz)).filter((a) => !a.carpeta);
  return Promise.all(
    archivos.map(async (a) => ({ ...a, contenido: a.tamano <= MAX_ARCHIVO_TEXTO ? await readFile(path.join(raiz, a.ruta), "utf8") : "(archivo demasiado grande)" })),
  );
});

ruta("PUT", "/api/bots/:id/memoria", async ({ params, cuerpo }) => {
  const bot = botDe(params[0]!);
  const { ruta: relativa, contenido } = validar(z.object({ ruta: z.string().trim().min(1).max(300), contenido: z.string().max(MAX_ARCHIVO_TEXTO) }), await cuerpo());
  const raiz = raizMemoria(bot.id);
  await mkdir(raiz, { recursive: true });
  const archivo = await rutaSegura(raiz, relativa.replace(/^\/?memories\/?/, ""));
  await mkdir(path.dirname(archivo), { recursive: true });
  await writeFile(archivo, contenido);
  emitir("memoria", { botId: bot.id });
  return { ok: true };
});

ruta("DELETE", "/api/bots/:id/memoria", async ({ params, url }) => {
  const bot = botDe(params[0]!);
  const raiz = raizMemoria(bot.id);
  const archivo = await rutaSegura(raiz, url.searchParams.get("ruta") ?? "");
  if (archivo === raiz) throw new ErrorHttp(400, "Indicá un archivo.");
  await rm(archivo, { force: true });
  emitir("memoria", { botId: bot.id });
  return { ok: true };
});

ruta("GET", "/api/bots/:id/rutinas", async ({ params }) => listarRutinas(botDe(params[0]!).id).map(vistaRutina));

ruta("POST", "/api/bots/:id/rutinas", async ({ params, cuerpo }) => {
  const bot = botDe(params[0]!);
  const d = validar(DatosRutina, await cuerpo());
  if (d.habilidadId && !buscarHabilidad(d.habilidadId)) throw new ErrorHttp(400, "No existe esa habilidad.");
  let rutina: Rutina;
  try {
    rutina = crearRutina({ botId: bot.id, nombre: d.nombre, instrucciones: d.instrucciones, habilidadId: d.habilidadId ?? null, horario: horarioDe(d.horario), activa: d.activa });
  } catch (err) {
    if (err instanceof ErrorHttp) throw err;
    throw new ErrorHttp(400, (err as Error).message);
  }
  emitir("rutinas", { botId: bot.id });
  return vistaRutina(rutina);
});

ruta("PUT", "/api/rutinas/:id", async ({ params, cuerpo }) => {
  const rutina = rutinaDe(params[0]!);
  const d = validar(DatosRutina, await cuerpo());
  if (d.habilidadId && !buscarHabilidad(d.habilidadId)) throw new ErrorHttp(400, "No existe esa habilidad.");
  Object.assign(rutina, { nombre: d.nombre, instrucciones: d.instrucciones, habilidadId: d.habilidadId ?? null, horario: horarioDe(d.horario), activa: d.activa });
  guardarEstado();
  emitir("rutinas", { botId: rutina.botId });
  return vistaRutina(rutina);
});

ruta("DELETE", "/api/rutinas/:id", async ({ params }) => {
  const rutina = rutinaDe(params[0]!);
  borrarRutina(rutina.id);
  emitir("rutinas", { botId: rutina.botId });
  return { ok: true };
});

ruta("POST", "/api/rutinas/:id/ejecutar", async ({ params }) => {
  const rutina = rutinaDe(params[0]!);
  if (rutina.ejecuciones[0]?.estado === "en_curso") throw new ErrorHttp(409, "La rutina ya se está ejecutando.");
  ejecutarRutina(rutina);
  return { ok: true };
});

ruta("POST", "/api/aprobaciones/:id", async ({ params, cuerpo }) => {
  const { decision } = validar(z.object({ decision: z.enum(["una", "siempre", "negar"]) }), await cuerpo());
  if (!resolverAprobacion(params[0]!, decision)) throw new ErrorHttp(404, "Esa aprobación ya no está pendiente.");
  return { ok: true };
});

ruta("POST", "/api/habilidades", async ({ cuerpo }) => {
  const h = guardarHabilidad(validar(DatosHabilidad, await cuerpo()));
  emitir("habilidades");
  return h;
});

ruta("PUT", "/api/habilidades/:id", async ({ params, cuerpo }) => {
  if (!buscarHabilidad(params[0]!)) throw new ErrorHttp(404, "No existe esa habilidad.");
  const h = guardarHabilidad(validar(DatosHabilidad, await cuerpo()), params[0]);
  emitir("habilidades");
  return h;
});

ruta("DELETE", "/api/habilidades/:id", async ({ params }) => {
  borrarHabilidad(params[0]!);
  emitir("habilidades");
  return { ok: true };
});

ruta("DELETE", "/api/reglas/:id", async ({ params }) => {
  borrarRegla(params[0]!);
  emitir("reglas");
  return { ok: true };
});

ruta("GET", "/api/computadora", async () => ({ archivos: await listarArchivos(COMPUTADORA), comandos: listarComandos() }));

ruta("GET", "/api/computadora/archivo", async ({ url, res }) => {
  const archivo = await rutaSegura(COMPUTADORA, url.searchParams.get("ruta") ?? "");
  await enviarArchivo(res, archivo, url.searchParams.has("descargar"));
  return undefined;
});

ruta("GET", "/api/eventos", async ({ req, res }) => {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": conectado\n\n");
  const enviar = (tipo: string, datos: unknown) => res.write(`event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`);
  const latido = setInterval(() => res.write(": latido\n\n"), 25_000);
  bus.on("evento", enviar);
  req.on("close", () => {
    clearInterval(latido);
    bus.off("evento", enviar);
  });
  return undefined;
});

// ---- Servidor ----

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    verificarOrigen(req);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(await readFile(INDEX));
      return;
    }
    for (const [metodo, patron, manejador] of rutas) {
      const m = req.method === metodo ? patron.exec(url.pathname) : null;
      if (!m) continue;
      const datos = await manejador({ req, res, url, params: m.slice(1), cuerpo: () => leerCuerpo(req) });
      if (datos !== undefined) responder(res, 200, datos);
      return;
    }
    throw new ErrorHttp(404, "No encontrado.");
  } catch (err) {
    if (!(err instanceof ErrorHttp)) console.error(err);
    if (res.headersSent) return void res.end();
    responder(res, err instanceof ErrorHttp ? err.status : 500, { error: err instanceof ErrorHttp ? err.message : "Error interno." });
  }
});

iniciarProgramador(ejecutarRutina);

servidor.listen(PUERTO, HOST, () => {
  console.log(`Gravity: http://${HOST.includes(":") ? `[${HOST}]` : HOST}:${PUERTO}`);
  console.log(`Computadora de los bots: ${COMPUTADORA}`);
  if (!LOCAL) {
    console.warn(
      `ATENCIÓN: escuchando en ${HOST}. Cualquiera que llegue a esta dirección puede hablar con los bots y aprobar comandos en esta máquina.`,
    );
  }
});
