import http from "node:http";
import { readFile, readdir, stat, writeFile, mkdir, rm } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { resolvePath } from "@anthropic-ai/sdk/tools/agent-toolset/node";
import {
  COMPUTADORA,
  DATOS,
  MAX_BOTS,
  ahora,
  ajustes,
  borrarBot,
  borrarHabilidad,
  borrarRegla,
  borrarRutina,
  buscarBot,
  buscarHabilidad,
  buscarReunion,
  buscarRutina,
  buscarTarea,
  cambiarAjustes,
  carpetaDeEquipo,
  conversacion,
  crearBot,
  crearRutina,
  directos,
  guardarEstado,
  guardarHabilidad,
  listarBots,
  listarHabilidades,
  listarReglas,
  listarReuniones,
  listarRutinas,
  listarTareas,
  raizMemoria,
  subarbol,
  vaciarEscrituras,
  validarJefe,
  type Bot,
  type Rutina,
} from "./almacen.ts";
import {
  CONFIG,
  detener,
  detenerTodo,
  ejecutarRutina,
  enviarMensaje,
  estadoDe,
  iniciarAgentes,
  listarAprobaciones,
  listarComandos,
  reintentarColas,
  resolverAprobacion,
} from "./agente.ts";
import { cerrarHerramientas } from "./herramientas.ts";
import { abierta, cancelarTarea, crearEquipo, iniciarEquipo, vistaTarea } from "./equipo.ts";
import { aceptarAcciones, cancelar as cancelarReunion, convocar, iniciarReuniones, intervenir, terminar as terminarReunion, vistaReunion } from "./reuniones.ts";
import { estadoCupo, ajustarLimite } from "./cupo.ts";
import { hoy, resumenGasto } from "./gasto.ts";
import { describirHorario, iniciarProgramador, normalizarHorario, proximaEjecucion } from "./rutinas.ts";
import { vistaConversacion } from "./vista.ts";
import { CATEGORIAS, ICONOS, MAX_MIEMBROS_EQUIPO, NOMBRES, PLANTILLAS, PLANTILLAS_EQUIPO } from "./plantillas.ts";
import { actualizarConexion, borrarConexion, catalogo, crearConexion, listarConexiones, probarConexion, quitarBotDeConexiones } from "./conexiones.ts";
import {
  TOPE_MAXIMO,
  activarMensajeria,
  borrarChat,
  buscarChat,
  buscarCompartido,
  cambiarApp,
  configurarChat,
  crearCompartido,
  escribirComoUsuario,
  estadoMensajeria,
  listarChats,
  listarCompartidos,
  marcarLeido,
  mensajeDeCompartido,
  quitarBotDeMensajeria,
  recibir,
  resultadoSaliente,
  esperarSalientes,
  tomarSalientes,
  vistaChat,
  type Compartido,
  type Saliente,
} from "./mensajeria.ts";
import { pedidoPorDefecto, pistaCompartido } from "./videos.ts";
import { bus, emitir } from "./eventos.ts";

const PUERTO = Number(process.env.BOTS_PUERTO ?? 3001);
// Los bots ejecutan comandos en esta máquina: por defecto solo se atiende desde ella misma.
const HOST = process.env.BOTS_HOST ?? "127.0.0.1";
const PUBLICO = new URL("../public/", import.meta.url);
const MAX_CUERPO = 1_000_000;
const MAX_ARCHIVO_TEXTO = 1_000_000;
const NOMBRES_LOCALES = ["127.0.0.1", "localhost", "::1"];

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
  cargo: z.enum(["manager", "miembro"]).optional(),
  reportaA: z.string().nullish(),
  puedeEnviarAfuera: z.boolean().optional(),
  esfuerzo: z.enum(["low", "medium", "high", "xhigh", "max"]).nullish(),
  icono: z.string().trim().regex(/^[a-z0-9-]{1,30}$/).nullish(),
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
  reunion: z
    .object({ tipo: z.enum(["standup", "discusion"]), participantes: z.array(z.string()).nullable(), confirmarAcciones: z.boolean() })
    .nullish(),
});
const DatosHabilidad = z.object({
  nombre: z.string().trim().min(1).max(80),
  descripcion: z.string().trim().max(300).default(""),
  instrucciones: z.string().trim().min(1).max(20000),
});
const Nombre = z.string().trim().min(1).max(40);
const Titulo = z.string().trim().min(1).max(80);
const Descripcion = z.string().trim().min(1).max(4000);
const IconoBot = z.string().trim().regex(/^[a-z0-9-]{1,30}$/).nullish();
const Persona = z.object({ nombre: Nombre, titulo: Titulo, descripcion: Descripcion, icono: IconoBot });
// Ver NuevoEquipo en equipo.ts: `miembros` (cada persona), `puestos` (con cantidad) o solo `plantilla`.
const DatosEquipo = z.object({
  plantilla: z.string().trim().min(1).max(60).optional(),
  manager: z.object({ nombre: Nombre.optional(), titulo: Titulo.optional(), descripcion: Descripcion.optional(), icono: IconoBot }).optional(),
  reportaA: z.string().nullish(),
  miembros: z.array(Persona).max(MAX_MIEMBROS_EQUIPO).optional(),
  puestos: z
    .array(
      z.object({
        titulo: Titulo,
        descripcion: Descripcion,
        cantidad: z.number().int().min(1).max(MAX_MIEMBROS_EQUIPO),
        nombres: z.array(Nombre).max(MAX_MIEMBROS_EQUIPO).optional(),
        icono: IconoBot,
      }),
    )
    .max(MAX_MIEMBROS_EQUIPO)
    .optional(),
  carpetaLibre: z.boolean().default(true),
});
const DatosReunion = z.object({
  titulo: z.string().trim().min(1).max(120),
  tipo: z.enum(["standup", "discusion"]),
  agenda: z.string().max(4000).default(""),
  facilitadorId: z.string(),
  participantes: z.array(z.string()).nullable().default(null),
  confirmarAcciones: z.boolean().default(false),
});
const Decision = z.enum(["una", "siempre", "negar"]);
const AlcanceSiempre = z.enum(["bot", "equipo", "global"]).optional();

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

function responder(res: http.ServerResponse, status: number, datos: unknown, cabeceras: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cabeceras });
  res.end(JSON.stringify(datos));
}

const nombreHost = (req: http.IncomingMessage) => (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");

// Local = el navegador de esta misma computadora. Un túnel o el Wi-Fi llegan con otro nombre de host.
function esLocal(req: http.IncomingMessage): boolean {
  const remota = req.socket.remoteAddress ?? "";
  const loopback = remota === "::1" || remota.startsWith("127.") || remota === "::ffff:127.0.0.1";
  return loopback && NOMBRES_LOCALES.includes(nombreHost(req));
}

// Bloquea pedidos de otros sitios (CSRF): exigir JSON obliga a los navegadores a pedir permiso (CORS).
function verificarOrigen(req: http.IncomingMessage): void {
  if (req.method === "GET") return;
  const origen = req.headers.origin;
  let hostOrigen: string | null = null;
  try {
    hostOrigen = origen ? new URL(origen).host : null;
  } catch {
    // Origen ilegible: se rechaza abajo.
  }
  if (origen && hostOrigen !== req.headers.host) throw new ErrorHttp(403, "Origen no permitido.");
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new ErrorHttp(415, "Se espera Content-Type: application/json.");
  }
}

// ---- Clave y sesiones (para entrar desde el celular u otra computadora) ----

const ARCHIVO_SESIONES = path.join(DATOS, "sesiones.json");
const DURACION_SESION_MS = 30 * 86_400_000;
let sesiones: Record<string, number> = {};
try {
  sesiones = JSON.parse(readFileSync(ARCHIVO_SESIONES, "utf8"));
} catch {
  // Sin sesiones previas.
}
const guardarSesiones = () => writeFileSync(ARCHIVO_SESIONES, JSON.stringify(sesiones));
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const claveEnv = process.env.BOTS_CLAVE ?? "";
const hayClave = () => !!claveEnv || !!ajustes().claveHash;

function claveCorrecta(clave: string): boolean {
  if (claveEnv) {
    const a = Buffer.from(hashToken(clave));
    const b = Buffer.from(hashToken(claveEnv));
    return timingSafeEqual(a, b);
  }
  const guardada = ajustes().claveHash;
  if (!guardada) return false;
  const [sal, hash] = guardada.split(":");
  const calculado = scryptSync(clave, Buffer.from(sal!, "hex"), 32);
  return timingSafeEqual(calculado, Buffer.from(hash!, "hex"));
}

function leerCookie(req: http.IncomingMessage, nombre: string): string | null {
  for (const parte of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return decodeURIComponent(v.join("="));
  }
  return null;
}

function sesionValida(req: http.IncomingMessage): boolean {
  const token = leerCookie(req, "gravity_sesion");
  if (!token) return false;
  const vence = sesiones[hashToken(token)];
  return !!vence && vence > Date.now();
}

const intentosFallidos: number[] = [];

// Dentro de la app de Android, cualquier otra app del celular podría conectarse a este puerto local:
// la app arranca el motor con un token secreto y la WebView lo manda en una cookie.
const TOKEN_APP = process.env.GRAVITY_TOKEN ?? "";

function tokenAppValido(req: http.IncomingMessage): boolean {
  if (!TOKEN_APP) return true;
  const recibido = leerCookie(req, "gravity_app") ?? String(req.headers["x-gravity-token"] ?? "");
  const a = Buffer.from(hashToken(recibido));
  const b = Buffer.from(hashToken(TOKEN_APP));
  return timingSafeEqual(a, b);
}

// ---- Vistas ----

function vistaBot(b: Bot) {
  const e = estadoDe(b.id);
  return {
    ...b,
    ...e,
    noLeido: !!b.ultimaActividad && (!b.leido || b.ultimaActividad > b.leido),
    rutinas: listarRutinas(b.id).length,
    tareasAbiertas: listarTareas().filter((t) => t.paraId === b.id && abierta(t)).length,
    equipo: b.cargo === "manager" ? directos(b.id).length : 0,
    gastoHoy: resumenGasto().porBot[b.id] ?? 0,
  };
}

function vistaRutina(r: Rutina) {
  return { ...r, descripcionHorario: describirHorario(r.horario), proxima: r.activa ? proximaEjecucion(r).toISOString() : null };
}

function resumenReunion(r: ReturnType<typeof vistaReunion>) {
  const { turnos, ...resto } = r;
  return { ...resto, turnos: turnos.length };
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

// Archivos públicos de la interfaz (sin sesión: íconos, manifest, service worker y fuentes).
const TIPOS: Record<string, string> = {
  ".webmanifest": "application/manifest+json",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".css": "text/css; charset=utf-8",
};

async function servirPublico(res: http.ServerResponse, ruta: string): Promise<boolean> {
  if (!/^\/(manifest\.webmanifest|sw\.js|(iconos|fuentes)\/[\w.-]+)$/.test(ruta)) return false;
  const archivo = new URL(`.${ruta}`, PUBLICO);
  const contenido = await readFile(archivo).catch(() => null);
  if (!contenido) return false;
  res.writeHead(200, {
    "Content-Type": TIPOS[path.extname(ruta)] ?? "application/octet-stream",
    "Cache-Control": ruta === "/sw.js" ? "no-cache" : "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(contenido);
  return true;
}

const PAGINA_LOGIN = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gravity</title><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#070A12">
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070A12;color:#E8ECF5;font:15px/1.5 system-ui,sans-serif}
form{width:min(340px,calc(100% - 32px));display:grid;gap:12px}h1{margin:0 0 4px;font-size:1.4rem}p{margin:0;color:#AAB3C8}
input,button{font:inherit;padding:11px 12px;border-radius:10px;border:1px solid #2A3654;background:#111827;color:inherit}
button{background:#E8ECF5;color:#070A12;border-color:#E8ECF5;font-weight:600;cursor:pointer}.error{color:#FFB07A;min-height:1.5em}</style></head>
<body><form id="f"><h1>Gravity</h1><p>Entrá con la clave de tu Gravity.</p>
<input id="c" type="password" autocomplete="current-password" placeholder="Clave" required autofocus>
<button>Entrar</button><div class="error" id="e" role="alert"></div></form>
<script>document.getElementById("f").addEventListener("submit",async(ev)=>{ev.preventDefault();
const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clave:document.getElementById("c").value})});
if(r.ok)location.reload();else document.getElementById("e").textContent=(await r.json().catch(()=>({}))).error||"No se pudo entrar.";});</script></body></html>`;

const PAGINA_SIN_CLAVE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gravity</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070A12;color:#E8ECF5;font:15px/1.6 system-ui,sans-serif}div{max-width:420px;padding:16px}</style></head>
<body><div><h1>Falta una clave</h1><p>Para entrar a Gravity desde otro dispositivo, primero poné una clave en <b>Ajustes</b> desde la computadora donde corre (o iniciá el servidor con <code>BOTS_CLAVE</code>).</p></div></body></html>`;

// ---- Rutas ----

type Contexto = { req: http.IncomingMessage; res: http.ServerResponse; url: URL; params: string[]; cuerpo: () => Promise<unknown>; local: boolean };
type Manejador = (p: Contexto) => Promise<unknown>;

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

const malPedido = (fn: () => unknown) => {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ErrorHttp) throw err;
    throw new ErrorHttp(400, (err as Error).message);
  }
};

ruta("GET", "/api/estado", async ({ local }) => {
  const { claveHash, ...resto } = ajustes();
  const recientes = listarTareas().filter((t) => abierta(t) || Date.now() - Date.parse(t.fin ?? t.creada) < 2 * 86_400_000);
  return {
    bots: listarBots().map(vistaBot),
    habilidades: listarHabilidades(),
    reglas: listarReglas(),
    aprobaciones: listarAprobaciones(),
    plantillas: PLANTILLAS,
    plantillasEquipo: PLANTILLAS_EQUIPO,
    categorias: CATEGORIAS,
    iconos: ICONOS,
    limites: { maxBots: MAX_BOTS, maxEquipo: MAX_MIEMBROS_EQUIPO + 1 },
    nombres: NOMBRES,
    config: CONFIG,
    ajustes: { ...resto, tieneClave: !!claveHash || !!claveEnv, claveEnv: !!claveEnv },
    gasto: resumenGasto(),
    cupo: estadoCupo(),
    tareas: recientes.slice(-300).map(vistaTarea),
    reuniones: listarReuniones().slice(0, 50).map((r) => resumenReunion(vistaReunion(r))),
    local,
  };
});

// Para la app de Android: si hay trabajo en marcha mantiene el celular despierto; si no, programa
// una alarma para la próxima rutina. Liviano a propósito: se consulta cada 30 segundos.
ruta("GET", "/api/motor", async () => {
  const { pausa } = ajustes();
  const estados = listarBots().map((b) => estadoDe(b.id));
  const trabajando = estados.filter((e) => e.estado === "trabajando").length;
  const enCola = estados.reduce((n, e) => n + e.enCola, 0);
  const reunionesActivas = listarReuniones().filter((r) => r.estado === "en_curso" || r.estado === "cierre").length;
  const tareasActivas = listarTareas().filter((t) => abierta(t) && t.estado !== "bloqueada").length;
  const proximas = pausa
    ? []
    : listarRutinas()
        .filter((r) => r.activa && buscarBot(r.botId))
        .map((r) => proximaEjecucion(r).getTime());
  return {
    ocupado: trabajando > 0 || reunionesActivas > 0 || (!pausa && (enCola > 0 || tareasActivas > 0)),
    trabajando,
    aprobaciones: listarAprobaciones().length,
    proximaRutina: proximas.length ? Math.min(...proximas) : null,
  };
});

ruta("POST", "/api/bots", async ({ cuerpo }) => {
  if (listarBots().length >= MAX_BOTS) throw new ErrorHttp(400, `Podés tener hasta ${MAX_BOTS} compañeros.`);
  const d = validar(DatosBot, await cuerpo());
  const error = validarJefe(null, d.reportaA ?? null);
  if (error) throw new ErrorHttp(400, error);
  const bot = crearBot({ ...d, reportaA: d.reportaA ?? null, esfuerzo: d.esfuerzo ?? null, icono: d.icono ?? null });
  emitir("bots");
  return vistaBot(bot);
});

ruta("POST", "/api/equipos", async ({ cuerpo }) => {
  const d = validar(DatosEquipo, await cuerpo());
  const { manager, miembros } = malPedido(() => crearEquipo({ ...d, reportaA: d.reportaA ?? null })) as ReturnType<typeof crearEquipo>;
  emitir("bots");
  emitir("reglas");
  return { manager: vistaBot(manager), miembros: miembros.map(vistaBot) };
});

ruta("PUT", "/api/bots/:id", async ({ params, cuerpo }) => {
  const bot = botDe(params[0]!);
  const d = validar(DatosBot, await cuerpo());
  const reportaA = d.reportaA === undefined ? bot.reportaA : d.reportaA;
  const cargo = d.cargo ?? bot.cargo;
  if (cargo !== "manager" && bot.cargo === "manager" && directos(bot.id).length) {
    throw new ErrorHttp(409, `${bot.nombre} tiene gente a cargo: reasigná su equipo antes de quitarle el cargo de manager.`);
  }
  const error = validarJefe(bot.id, reportaA ?? null);
  if (error) throw new ErrorHttp(400, error);
  Object.assign(bot, {
    nombre: d.nombre,
    titulo: d.titulo,
    descripcion: d.descripcion,
    cargo,
    reportaA: reportaA ?? null,
    puedeEnviarAfuera: d.puedeEnviarAfuera ?? bot.puedeEnviarAfuera,
    esfuerzo: d.esfuerzo === undefined ? bot.esfuerzo : d.esfuerzo,
    icono: d.icono === undefined ? bot.icono : d.icono,
  });
  if (cargo === "manager" && !bot.carpetaEquipo) bot.carpetaEquipo = carpetaDeEquipo(bot.nombre, bot.id);
  guardarEstado();
  emitir("bots");
  return vistaBot(bot);
});

ruta("DELETE", "/api/bots/:id", async ({ params }) => {
  const bot = botDe(params[0]!);
  detener(bot.id);
  for (const t of listarTareas()) if (t.paraId === bot.id && abierta(t)) cancelarTarea(t.id, `${bot.nombre} fue eliminado.`);
  borrarBot(bot.id);
  quitarBotDeConexiones(bot.id);
  quitarBotDeMensajeria(bot.id);
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

// Detiene a un manager y a todo su equipo.
ruta("POST", "/api/bots/:id/detener-equipo", async ({ params }) => {
  const bot = botDe(params[0]!);
  for (const b of [bot, ...subarbol(bot.id)]) detener(b.id);
  for (const t of listarTareas()) if (t.deId === bot.id && abierta(t)) cancelarTarea(t.id, "Se detuvo el equipo.");
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
  const rutina = malPedido(() =>
    crearRutina({ botId: bot.id, nombre: d.nombre, instrucciones: d.instrucciones, habilidadId: d.habilidadId ?? null, horario: horarioDe(d.horario), activa: d.activa, reunion: d.reunion ?? null }),
  ) as Rutina;
  emitir("rutinas", { botId: bot.id });
  return vistaRutina(rutina);
});

ruta("PUT", "/api/rutinas/:id", async ({ params, cuerpo }) => {
  const rutina = rutinaDe(params[0]!);
  const d = validar(DatosRutina, await cuerpo());
  if (d.habilidadId && !buscarHabilidad(d.habilidadId)) throw new ErrorHttp(400, "No existe esa habilidad.");
  Object.assign(rutina, {
    nombre: d.nombre,
    instrucciones: d.instrucciones,
    habilidadId: d.habilidadId ?? null,
    horario: horarioDe(d.horario),
    activa: d.activa,
    reunion: d.reunion === undefined ? rutina.reunion : d.reunion,
  });
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

// ---- Tareas ----

ruta("GET", "/api/tareas", async ({ url }) => {
  const botId = url.searchParams.get("botId");
  return listarTareas()
    .filter((t) => !botId || t.deId === botId || t.paraId === botId)
    .slice(-500)
    .map(vistaTarea);
});

ruta("POST", "/api/tareas/:id/cancelar", async ({ params }) => {
  const t = buscarTarea(params[0]!);
  if (!t) throw new ErrorHttp(404, "No existe esa tarea.");
  if (!cancelarTarea(t.id, "Cancelada por el usuario.")) throw new ErrorHttp(409, "La tarea ya estaba cerrada.");
  return { ok: true };
});

// ---- Aprobaciones ----

ruta("POST", "/api/aprobaciones/lote", async ({ cuerpo }) => {
  const { ids, decision, alcance } = validar(z.object({ ids: z.array(z.string()).min(1).max(200), decision: Decision, alcance: AlcanceSiempre }), await cuerpo());
  const resueltas = ids.filter((id) => resolverAprobacion(id, decision, alcance)).length;
  return { resueltas };
});

ruta("POST", "/api/aprobaciones/:id", async ({ params, cuerpo }) => {
  const { decision, alcance } = validar(z.object({ decision: Decision, alcance: AlcanceSiempre }), await cuerpo());
  if (!resolverAprobacion(params[0]!, decision, alcance)) throw new ErrorHttp(404, "Esa aprobación ya no está pendiente.");
  return { ok: true };
});

// ---- Reuniones ----

ruta("GET", "/api/reuniones", async () => listarReuniones().slice(0, 100).map((r) => resumenReunion(vistaReunion(r))));

ruta("GET", "/api/reuniones/:id", async ({ params }) => {
  const r = buscarReunion(params[0]!);
  if (!r) throw new ErrorHttp(404, "No existe esa reunión.");
  return vistaReunion(r);
});

ruta("POST", "/api/reuniones", async ({ cuerpo }) => {
  const d = validar(DatosReunion, await cuerpo());
  const r = malPedido(() => convocar(d)) as ReturnType<typeof convocar>;
  return vistaReunion(r);
});

ruta("POST", "/api/reuniones/:id/mensajes", async ({ params, cuerpo }) => {
  const { texto } = validar(z.object({ texto: z.string().trim().min(1).max(4000) }), await cuerpo());
  return vistaReunion(malPedido(() => intervenir(params[0]!, texto)) as ReturnType<typeof intervenir>);
});

ruta("POST", "/api/reuniones/:id/terminar", async ({ params }) => {
  terminarReunion(params[0]!);
  return { ok: true };
});

ruta("POST", "/api/reuniones/:id/cancelar", async ({ params }) => {
  cancelarReunion(params[0]!);
  return { ok: true };
});

ruta("POST", "/api/reuniones/:id/aceptar", async ({ params }) => ({ tareas: malPedido(() => aceptarAcciones(params[0]!)) }));

// ---- Habilidades y reglas ----

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

// ---- Ajustes, gasto y control general ----

ruta("PUT", "/api/ajustes", async ({ cuerpo }) => {
  const d = validar(
    z.object({ maxLlamadas: z.number().int().min(1).max(30), maxComandos: z.number().int().min(1).max(30), topeDiarioUsd: z.number().min(0).max(10000), autoAprobar: z.boolean(), autoResponder: z.boolean() }).partial(),
    await cuerpo(),
  );
  const a = cambiarAjustes(d);
  if (d.maxLlamadas) ajustarLimite(d.maxLlamadas);
  reintentarColas();
  emitir("ajustes");
  return { ...a, claveHash: undefined };
});

ruta("POST", "/api/ajustes/seguir-hoy", async ({ cuerpo }) => {
  const { usd } = validar(z.object({ usd: z.number().min(0).max(10000) }), await cuerpo());
  cambiarAjustes({ extra: { dia: hoy(), usd } });
  reintentarColas();
  emitir("ajustes");
  return { ok: true };
});

ruta("POST", "/api/pausa", async ({ cuerpo }) => {
  const { pausa } = validar(z.object({ pausa: z.boolean() }), await cuerpo());
  cambiarAjustes({ pausa });
  if (!pausa) reintentarColas();
  emitir("ajustes");
  return { ok: true };
});

ruta("POST", "/api/detener-todo", async () => {
  cambiarAjustes({ pausa: true });
  detenerTodo();
  for (const r of listarReuniones()) if (r.estado === "en_curso") cancelarReunion(r.id);
  emitir("ajustes");
  return { ok: true };
});

// La clave solo se puede definir desde la propia computadora o con una sesión válida.
ruta("POST", "/api/ajustes/clave", async ({ cuerpo }) => {
  if (claveEnv) throw new ErrorHttp(409, "La clave está fijada con BOTS_CLAVE en el servidor.");
  const { clave } = validar(z.object({ clave: z.string().min(8, "Usá al menos 8 caracteres.").max(200) }), await cuerpo());
  const sal = randomBytes(16);
  cambiarAjustes({ claveHash: `${sal.toString("hex")}:${scryptSync(clave, sal, 32).toString("hex")}` });
  // Cambiar la clave cierra las sesiones abiertas en otros dispositivos.
  sesiones = {};
  guardarSesiones();
  emitir("ajustes");
  return { ok: true };
});

// ---- Conexiones con apps de afuera ----

ruta("GET", "/api/conexiones", async () => ({ tipos: catalogo(), conexiones: listarConexiones() }));

ruta("POST", "/api/conexiones", async ({ cuerpo }) => {
  const d = validar(
    z.object({ tipo: z.string(), nombre: z.string().max(60).default(""), datos: z.record(z.string(), z.string().max(4000)), bots: z.array(z.string()).max(60).default([]) }),
    await cuerpo(),
  );
  try {
    return await crearConexion(d.tipo, d.nombre, d.datos, d.bots);
  } catch (err) {
    throw new ErrorHttp(400, (err as Error).message);
  }
});

ruta("PUT", "/api/conexiones/:id", async ({ params, cuerpo }) => {
  const d = validar(z.object({ nombre: z.string().max(60).optional(), bots: z.array(z.string()).max(60).optional() }), await cuerpo());
  return malPedido(() => actualizarConexion(params[0]!, d));
});

ruta("DELETE", "/api/conexiones/:id", async ({ params }) => {
  await borrarConexion(params[0]!);
  return { ok: true };
});

ruta("POST", "/api/conexiones/:id/probar", async ({ params }) => {
  try {
    return await probarConexion(params[0]!);
  } catch (err) {
    throw new ErrorHttp(404, (err as Error).message);
  }
});

ruta("GET", "/api/computadora", async () => ({ archivos: await listarArchivos(COMPUTADORA), comandos: listarComandos() }));

ruta("GET", "/api/computadora/archivo", async ({ url, res }) => {
  const archivo = await rutaSegura(COMPUTADORA, url.searchParams.get("ruta") ?? "");
  await enviarArchivo(res, archivo, url.searchParams.has("descargar"));
  return undefined;
});

// ---- Mensajería por las notificaciones del celular (ver mensajeria.ts) ----
// La app de Android manda lo que llega, toma las respuestas listas y avisa cómo salió cada envío.

const Paquete = z.string().trim().max(200).regex(/^[A-Za-z]\w*(\.\w+)+$/, "Paquete de Android inválido.");
const DatosEntrante = z.object({
  app: Paquete,
  appNombre: z.string().trim().max(60).default(""),
  clave: z.string().min(3).max(300),
  conversacion: z.string().trim().max(200).default(""),
  esGrupo: z.boolean().default(false),
  puedeResponder: z.boolean().default(false),
  mensajes: z.array(z.object({ de: z.string().max(200).default(""), texto: z.string().max(20_000), hora: z.number().finite(), propio: z.boolean().default(false) })).max(100),
});
const DatosChat = z.object({
  botId: z.string().nullable(),
  modo: z.enum(["leer", "atender", "charlar", "apagado"]),
  // ISO o milisegundos; sin hasta, charlar dura 2 horas (null = sin fin).
  hasta: z.union([z.string().max(40), z.number()]).nullish(),
  maxPorHora: z.number().int().min(1).max(TOPE_MAXIMO).nullish(),
  firmar: z.boolean().optional(),
});
const DatosCompartido = z.object({
  tipo: z.enum(["texto", "enlace", "archivo"]),
  // La app manda hasta 100.000 caracteres; se guardan los primeros 20.000.
  texto: z.string().max(100_000).nullish(),
  url: z.string().max(4000).nullish(),
  ruta: z.string().max(500).nullish(),
  nombre: z.string().max(300).nullish(),
  mime: z.string().max(100).nullish(),
});

// Las claves llevan "|", espacios y acentos: en la ruta van con encodeURIComponent (o se usa el id de 16 letras).
const CLAVE_CHAT = "([^/]+)";
function chatDe(param: string) {
  let ref: string;
  try {
    ref = decodeURIComponent(param);
  } catch {
    throw new ErrorHttp(400, "Clave mal codificada.");
  }
  const c = buscarChat(ref);
  if (!c) throw new ErrorHttp(404, "No existe esa conversación.");
  return c;
}

ruta("POST", "/api/mensajeria/entrante", async ({ cuerpo }) => {
  const d = validar(DatosEntrante, await cuerpo());
  return malPedido(() => recibir(d));
});

// ?esperar=N: la app deja el pedido abierto hasta N segundos y se le responde apenas hay algo para mandar.
ruta("GET", "/api/mensajeria/salientes", async ({ url }) => esperarSalientes(Math.min(25, Math.max(0, Number(url.searchParams.get("esperar")) || 0)) * 1000));

ruta("POST", "/api/mensajeria/salientes/:id/resultado", async ({ params, cuerpo }) => {
  const { ok, error } = validar(z.object({ ok: z.boolean(), error: z.string().max(500).nullish() }), await cuerpo());
  if (!resultadoSaliente(params[0]!, ok, error ?? null)) throw new ErrorHttp(404, "No existe ese envío.");
  return { ok: true };
});

ruta("GET", "/api/mensajeria/estado", async () => estadoMensajeria());

ruta("PUT", "/api/mensajeria/estado", async ({ cuerpo }) => activarMensajeria(validar(z.object({ activa: z.boolean() }), await cuerpo()).activa));

ruta("PUT", "/api/mensajeria/apps", async ({ cuerpo }) => {
  const d = validar(z.object({ paquete: Paquete, activa: z.boolean(), nombre: z.string().trim().min(1).max(60).optional() }), await cuerpo());
  return malPedido(() => cambiarApp(d.paquete, d.activa, d.nombre));
});

ruta("GET", "/api/mensajeria/conversaciones", async () => listarChats());

ruta("GET", `/api/mensajeria/conversaciones/${CLAVE_CHAT}`, async ({ params, url }) => {
  const c = chatDe(params[0]!);
  const vista = vistaChat(c.id, Math.min(200, Math.max(1, Number(url.searchParams.get("cantidad")) || 200)));
  marcarLeido(c);
  return vista;
});

ruta("PUT", `/api/mensajeria/conversaciones/${CLAVE_CHAT}`, async ({ params, cuerpo }) => {
  const c = chatDe(params[0]!);
  const d = validar(DatosChat, await cuerpo());
  malPedido(() => configurarChat(c.id, d));
  return vistaChat(c.id, 50);
});

ruta("DELETE", `/api/mensajeria/conversaciones/${CLAVE_CHAT}`, async ({ params }) => {
  borrarChat(chatDe(params[0]!).id);
  return { ok: true };
});

ruta("POST", `/api/mensajeria/conversaciones/${CLAVE_CHAT}/escribir`, async ({ params, cuerpo }) => {
  const c = chatDe(params[0]!);
  const { texto } = validar(z.object({ texto: z.string().trim().min(1).max(4000) }), await cuerpo());
  const s = malPedido(() => escribirComoUsuario(c.id, texto)) as Saliente;
  return { id: s.id, estado: s.estado };
});

// ---- Compartido desde otras apps (la app copia los archivos en compartidos/ de la computadora) ----

function compartidoDe(id: string): Compartido {
  const c = buscarCompartido(id);
  if (!c) throw new ErrorHttp(404, "No existe eso compartido.");
  return c;
}

ruta("POST", "/api/compartido", async ({ cuerpo }) => {
  const d = validar(DatosCompartido, await cuerpo());
  const c = malPedido(() => crearCompartido(d)) as Compartido;
  return { id: c.id };
});

ruta("GET", "/api/compartidos", async () => listarCompartidos());

ruta("GET", "/api/compartido/:id", async ({ params }) => compartidoDe(params[0]!));

// Se lo pasa a un bot como mensaje del usuario, con el pedido (opcional) y lo compartido como contenido externo.
ruta("POST", "/api/compartido/:id/enviar", async ({ params, cuerpo }) => {
  const c = compartidoDe(params[0]!);
  // El pedido llega como `texto` (contrato con la app) o `pedido`; sin pedido, un video o audio va con uno por defecto.
  const { botId, pedido, texto } = validar(
    z.object({ botId: z.string(), pedido: z.string().trim().max(8000).nullish(), texto: z.string().trim().max(8000).nullish() }),
    await cuerpo(),
  );
  const bot = botDe(botId);
  enviarMensaje(bot.id, mensajeDeCompartido(c, bot.id, pedido || texto || pedidoPorDefecto(c)) + pistaCompartido(c));
  return { ok: true };
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

async function atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const local = esLocal(req);
  verificarOrigen(req);

  if (req.method === "GET" && (await servirPublico(res, url.pathname))) return;
  // La app de Android comprueba que en el puerto está este motor (y no otra app) antes de mandar el token.
  if (req.method === "GET" && url.pathname === "/api/hola" && TOKEN_APP) {
    const reto = url.searchParams.get("reto") ?? "";
    if (!/^[0-9a-f]{16,128}$/.test(reto)) throw new ErrorHttp(400, "Reto inválido.");
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end(createHmac("sha256", TOKEN_APP).update(reto).digest("hex"));
    return;
  }
  if (!tokenAppValido(req)) throw new ErrorHttp(401, "Acceso no autorizado.");

  // Fuera de esta computadora hace falta clave y sesión.
  if (!local) {
    if (!hayClave()) {
      if (url.pathname.startsWith("/api/")) throw new ErrorHttp(403, "Falta configurar una clave en Ajustes.");
      res.writeHead(403, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(PAGINA_SIN_CLAVE);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/login") {
      const ahoraMs = Date.now();
      while (intentosFallidos.length && ahoraMs - intentosFallidos[0]! > 10 * 60_000) intentosFallidos.shift();
      if (intentosFallidos.length >= 10) throw new ErrorHttp(429, "Demasiados intentos. Esperá unos minutos.");
      const { clave } = validar(z.object({ clave: z.string().max(200) }), await leerCuerpo(req));
      if (!claveCorrecta(clave)) {
        intentosFallidos.push(ahoraMs);
        throw new ErrorHttp(401, "Clave incorrecta.");
      }
      const token = randomBytes(32).toString("base64url");
      sesiones[hashToken(token)] = ahoraMs + DURACION_SESION_MS;
      for (const [h, vence] of Object.entries(sesiones)) if (vence < ahoraMs) delete sesiones[h];
      guardarSesiones();
      const seguro = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
      responder(res, 200, { ok: true }, { "Set-Cookie": `gravity_sesion=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACION_SESION_MS / 1000}${seguro}` });
      return;
    }
    if (!sesionValida(req)) {
      if (url.pathname.startsWith("/api/")) throw new ErrorHttp(401, "Iniciá sesión.");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(PAGINA_LOGIN);
      return;
    }
  }
  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = leerCookie(req, "gravity_sesion");
    if (token) delete sesiones[hashToken(token)];
    guardarSesiones();
    responder(res, 200, { ok: true }, { "Set-Cookie": "gravity_sesion=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(await readFile(new URL("index.html", PUBLICO)));
    return;
  }
  for (const [metodo, patron, manejador] of rutas) {
    const m = req.method === metodo ? patron.exec(url.pathname) : null;
    if (!m) continue;
    const datos = await manejador({ req, res, url, params: m.slice(1), cuerpo: () => leerCuerpo(req), local });
    if (datos !== undefined) responder(res, 200, datos);
    return;
  }
  throw new ErrorHttp(404, "No encontrado.");
}

const servidor = http.createServer(async (req, res) => {
  try {
    await atender(req, res);
  } catch (err) {
    if (!(err instanceof ErrorHttp)) console.error(err);
    if (res.headersSent) return void res.end();
    responder(res, err instanceof ErrorHttp ? err.status : 500, { error: err instanceof ErrorHttp ? err.message : "Error interno." });
  }
});

iniciarReuniones();
iniciarAgentes();
iniciarEquipo();
iniciarProgramador(ejecutarRutina);

// Al apagar: se escribe todo lo pendiente antes de salir.
for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => {
    vaciarEscrituras();
    process.exit(0);
  });
}

servidor.listen(PUERTO, HOST, () => {
  console.log(`Gravity: http://${HOST.includes(":") ? `[${HOST}]` : HOST}:${PUERTO}`);
  console.log(`Computadora de los bots: ${COMPUTADORA}`);
  if (!NOMBRES_LOCALES.includes(HOST)) {
    console.warn(`Escuchando en ${HOST}: desde otros dispositivos se entra con clave${hayClave() ? "" : " (todavía no hay una: configurala en Ajustes)"}.`);
  }
});
