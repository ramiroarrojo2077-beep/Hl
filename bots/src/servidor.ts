import http from "node:http";
import { readFile, readdir, stat, writeFile, mkdir, rm } from "node:fs/promises";
import { createReadStream, createWriteStream, readFileSync, rmSync, statSync as statArchivo, writeFileSync } from "node:fs";
import { cpus, freemem, tmpdir, totalmem } from "node:os";
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
  listarArchivados,
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
  sistemaDe,
} from "./agente.ts";
import { GRUPOS_HERRAMIENTAS, cerrarHerramientas, normalizarBloqueadas } from "./herramientas.ts";
import { iniciarTelegram } from "./telegram.ts";
import { auditar, informeComoTexto } from "./auditoria.ts";
import { buscarTodo } from "./buscador.ts";
import { leerActividad } from "./actividad.ts";
import { guardarVersion, leerVersion, listarVersiones, restaurarVersion } from "./versiones.ts";
import * as Code from "./codigo.ts";
import * as Datos from "./datos.ts";
import * as Canales from "./canales.ts";
import { resumir } from "./resumen.ts";
import * as Inv from "./investigacion.ts";
import { leerPagina } from "./herramientas.ts";
import { aplicarPropuesta, descartarPropuesta, propuestas as propuestasEvolucion } from "./evolucion.ts";
import { preguntar as preguntarDatos } from "./datos-ia.ts";
import { generarStudio, listarStudio } from "./studio.ts";
import { instalarDelMercado, vistaMercado } from "./mercado.ts";
import { borrarWebhook, crearWebhook, listarWebhooks, recibirWebhook } from "./webhooks.ts";
import { confianzaDe, cargaDe, iniciarTalento } from "./talento.ts";
import { agregarNota, nuevoId } from "./almacen.ts";
import { EVENTOS, borrarAutomatizacion, cambiarAutomatizacion, crearAutomatizacion, iniciarAutomatizaciones, listarAutomatizaciones } from "./automatizaciones.ts";
import { Propuesta, aplicar as aplicarArquitecto, proponer as proponerArquitecto } from "./arquitecto.ts";
import { ESTADOS_TAREA, agregarTarea, borrarProyecto, borrarTarea, buscarProyecto, cambiarProyecto, cambiarTarea, crearProyecto, listarProyectos, progreso, quitarBotDeProyectos, type Proyecto } from "./proyectos.ts";
import { aplicar as aplicarRespaldo, exportar as exportarRespaldo, extraer as extraerRespaldo, rutaTemporal as rutaRespaldo } from "./respaldo.ts";
import { abierta, cancelarTarea, crearEquipo, iniciarEquipo, vistaTarea } from "./equipo.ts";
import { aceptarAcciones, cancelar as cancelarReunion, convocar, iniciarReuniones, intervenir, pausar as pausarReunion, reanudar as reanudarReunion, terminar as terminarReunion, vistaReunion } from "./reuniones.ts";
import { estadoCupo, ajustarLimite } from "./cupo.ts";
import { gastoPorBotDesde, hoy, resumenGasto } from "./gasto.ts";
import { describirHorario, iniciarProgramador, normalizarHorario, proximaEjecucion } from "./rutinas.ts";
import { vistaConversacion } from "./vista.ts";
import { CATEGORIAS, ICONOS, MAX_MIEMBROS_EQUIPO, NOMBRES, PLANTILLAS, PLANTILLAS_EQUIPO } from "./plantillas.ts";
import { actualizarConexion, borrarConexion, catalogo, crearConexion, listarConexiones, probarConexion, quitarBotDeConexiones, tokenGithub } from "./conexiones.ts";
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
import { hayGemini } from "./proveedores.ts";
import { BETA_FALLBACK, MODELO, client, modeloPara, type PreferenciaModelo } from "./cliente.ts";
import { registrarUso } from "./gasto.ts";
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

// Robot y voz de las llamadas (ver Avatar en almacen.ts). Lo que falte toma el valor por defecto.
const DatosAvatar = z.object({
  activo: z.boolean().default(true),
  gestos: z.object({ apagados: z.array(z.string().max(20)).max(20).default([]), firma: z.string().max(20).nullable().default(null) }).optional(),
  accesorio: z.enum(["ninguno", "antena", "cresta", "visera"]).default("ninguno"),
  tono: z.number().min(0.5).max(2).transform((v) => Math.round(v * 100) / 100).default(1),
  estilo: z.string().trim().max(200).optional(),
  vozGemini: z.string().max(20).nullable().optional(),
  cuerpo: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  acabado: z.enum(["brillante", "mate", "metal", "ceramica"]).optional(),
  luz: z.object({ preset: z.string().max(20), intensidad: z.number().min(0).max(3), borde: z.number().min(0).max(3), exposicion: z.number().min(0.3).max(2.5), colorA: z.string().regex(/^#[0-9a-fA-F]{6}$/), colorB: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "El color va como #rrggbb.")
    .transform((c) => c.toUpperCase())
    .default("#6CD3F0"),
  expresividad: z.number().min(0).max(100).transform(Math.round).default(60),
  calidad: z.enum(["auto", "alta", "baja"]).default("auto"),
  voz: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  velocidad: z
    .number()
    .min(0.5)
    .max(2)
    .transform((v) => Math.round(v * 100) / 100)
    .default(1),
});
const DatosBot = z.object({
  nombre: z.string().trim().min(1).max(40),
  titulo: z.string().trim().min(1).max(80),
  descripcion: z.string().trim().min(1).max(4000),
  cargo: z.enum(["manager", "miembro"]).optional(),
  reportaA: z.string().nullish(),
  puedeEnviarAfuera: z.boolean().optional(),
  esfuerzo: z.enum(["low", "medium", "high", "xhigh", "max"]).nullish(),
  icono: z.string().trim().regex(/^[a-z0-9-]{1,30}$/).nullish(),
  avatar: DatosAvatar.nullish(),
  // Grupos de herramientas apagadas (ver GRUPOS_HERRAMIENTAS en herramientas.ts).
  bloqueadas: z.array(z.string().max(30)).max(20).optional(),
  ensenanza: z.boolean().optional(),
  verificacion: z.boolean().optional(),
  modelo: z.enum(["rapido", "potente"]).nullish(),
  topeDiarioUsd: z.number().min(0).max(10_000).nullish(),
  estilo: z.string().trim().max(1500).nullish(),
  idioma: z.enum(["es", "en", "pt", "fr", "it", "de"]).nullish(),
  mentorId: z.string().max(40).nullish(),
  favorito: z.boolean().optional(),
  // Misión de un especialista temporal; "" o null lo vuelve permanente.
  mision: z.string().trim().max(2000).nullish(),
});
const DatosHorario = z.object({
  tipo: z.string(),
  minutos: z.number().nullish(),
  hora: z.string().nullish(),
  dia: z.number().nullish(),
  fecha: z.string().max(10).nullish(),
});
const DatosRutina = z.object({
  nombre: z.string().trim().min(1).max(80),
  instrucciones: z.string().trim().min(1).max(8000),
  habilidadId: z.string().nullish(),
  horario: DatosHorario,
  activa: z.boolean().default(true),
  reunion: z
    .object({ tipo: z.enum(["standup", "discusion", "debate"]), participantes: z.array(z.string()).nullable(), confirmarAcciones: z.boolean() })
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
  tipo: z.enum(["standup", "discusion", "debate"]),
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
  const tipo = String(req.headers["content-type"] ?? "");
  // El respaldo se sube como zip: tampoco es un tipo "simple", así que otro sitio no puede mandarlo sin CORS.
  const esRespaldo = (req.url ?? "").startsWith("/api/respaldo/importar") && tipo.startsWith("application/zip");
  // Data Lab sube tablas como binario (CSV, Excel): tampoco es un tipo "simple".
  const esTabla = /^\/api\/(datos\/subir|code\/captura|code\/importar-zip|cloud\/recibir|conocimiento\/[\w-]+\/subir|vision\/subir|audio\/subir)/.test(req.url ?? "") && tipo.startsWith("application/octet-stream");
  if (!tipo.startsWith("application/json") && !esRespaldo && !esTabla) {
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
    confianza: confianzaDe(b.id),
    carga: cargaDe(b.id),
  };
}

function vistaRutina(r: Rutina) {
  // Un recordatorio que ya corrió no tiene próxima.
  const yaCorrio = r.horario.tipo === "una" && !!r.ultimaEjecucion;
  return { ...r, descripcionHorario: describirHorario(r.horario), proxima: r.activa && !yaCorrio ? proximaEjecucion(r).toISOString() : null };
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

async function enviarArchivo(res: http.ServerResponse, archivo: string, descargar: boolean, nombre?: string): Promise<void> {
  const info = await stat(archivo).catch(() => null);
  if (!info?.isFile()) throw new ErrorHttp(404, "No existe el archivo.");
  const contenido = await readFile(archivo);
  const esTexto = info.size <= MAX_ARCHIVO_TEXTO && !contenido.subarray(0, 8000).includes(0);
  // Nunca se sirve como HTML: un archivo creado por un bot no puede correr código en esta página.
  res.writeHead(200, {
    "Content-Type": esTexto && !descargar ? "text/plain; charset=utf-8" : "application/octet-stream",
    "Content-Disposition": `${descargar || !esTexto ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nombre ?? path.basename(archivo))}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "no-store",
  });
  res.end(contenido);
}

// Vista previa de lo que hacen los compañeros (páginas, prototipos): /vista/<token>/<ruta en la computadora>.
// El token es aleatorio por arranque y solo lo recibe la interfaz (/api/estado), así las rutas relativas
// (style.css, app.js) funcionan dentro del marco. Se sirve con CSP «sandbox»: origen opaco, sin acceso
// a Gravity ni a sus cookies, sin formularios hacia afuera ni conexiones a otros sitios.
const TOKEN_VISTA = randomBytes(18).toString("base64url");
const TIPOS_VISTA: Record<string, string> = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm" };
async function servirVista(req: http.IncomingMessage, res: http.ServerResponse, ruta: string): Promise<void> {
  const partes = ruta.split("/").slice(2);
  const token = partes.shift() ?? "";
  if (token.length !== TOKEN_VISTA.length || !timingSafeEqual(Buffer.from(token), Buffer.from(TOKEN_VISTA))) throw new ErrorHttp(404, "No encontrado.");
  let archivo: string;
  try {
    archivo = await resolvePath({ workdir: COMPUTADORA }, decodeURIComponent(partes.join("/")) || "index.html");
  } catch {
    throw new ErrorHttp(404, "No encontrado.");
  }
  const info = await stat(archivo).catch(() => null);
  if (info?.isDirectory()) archivo = path.join(archivo, "index.html");
  let datos = await readFile(archivo).catch(() => null);
  if (!datos) throw new ErrorHttp(404, "No encontrado.");
  // En las páginas se inyecta un avisador: los errores de JavaScript se le pasan a Gravity (postMessage)
  // para mostrarlos y ofrecer arreglarlos. No le da a la página ningún acceso nuevo.
  if (/\.html?$/i.test(archivo)) {
    const avisador = `<script>(function(){function m(t){try{parent.postMessage({gravityVista:1,error:String(t).slice(0,400)},"*")}catch(e){}}window.addEventListener("error",function(e){m((e.message||"Error")+(e.lineno?" (línea "+e.lineno+")":""))});window.addEventListener("unhandledrejection",function(e){m("Promesa rechazada: "+(e.reason&&e.reason.message||e.reason))});var ce=console.error;console.error=function(){m(Array.prototype.join.call(arguments," "));return ce.apply(console,arguments)}})();</script>`;
    const texto = datos.toString("utf8");
    const i = texto.search(/<head[^>]*>/i);
    datos = Buffer.from(i >= 0 ? texto.replace(/<head[^>]*>/i, (h) => h + avisador) : avisador + texto);
  }
  const cabeceras = {
    "Content-Type": TIPOS_VISTA[path.extname(archivo).toLowerCase()] ?? "application/octet-stream",
    "Content-Security-Policy": "sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; form-action 'none'; frame-ancestors 'self'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
  };
  // Rangos (audio y video): sin esto el navegador no puede saltar a otro momento del archivo.
  const rango = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (rango && (rango[1] || rango[2])) {
    const total = datos.length;
    let ini = rango[1] ? Number(rango[1]) : Math.max(0, total - Number(rango[2]));
    let fin = rango[1] && rango[2] ? Math.min(Number(rango[2]), total - 1) : total - 1;
    if (ini >= total || ini > fin) { res.writeHead(416, { ...cabeceras, "Content-Range": `bytes */${total}` }); res.end(); return; }
    ini = Math.max(0, ini); fin = Math.max(ini, fin);
    res.writeHead(206, { ...cabeceras, "Content-Range": `bytes ${ini}-${fin}/${total}`, "Content-Length": String(fin - ini + 1) });
    res.end(datos.subarray(ini, fin + 1));
    return;
  }
  res.writeHead(200, cabeceras);
  res.end(datos);
}

// Archivos públicos de la interfaz (sin sesión: íconos, manifest, service worker, fuentes y las
// bibliotecas de terceros en vendor/, como three.js para el robot de las llamadas).
const TIPOS: Record<string, string> = {
  ".webmanifest": "application/manifest+json",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".css": "text/css; charset=utf-8",
};

async function servirPublico(res: http.ServerResponse, ruta: string): Promise<boolean> {
  if (!/^\/(manifest\.webmanifest|sw\.js|(iconos|fuentes|vendor\/three|vendor\/codemirror)\/[\w-]+(\.[\w-]+)*)$/.test(ruta)) return false;
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

// La página solo puede cargar lo propio: sin scripts, estilos ni conexiones de afuera, sin <object> y sin
// quedar embebida en otro sitio. Los archivos de los bots se sirven aparte con "sandbox" (ver arriba).
const CSP_PAGINA = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
    archivados: listarArchivados().map((b) => ({ id: b.id, nombre: b.nombre, titulo: b.titulo, color: b.color, icono: b.icono, temporal: b.temporal ?? null, archivado: b.archivado })),
    habilidades: listarHabilidades(),
    reglas: listarReglas(),
    aprobaciones: listarAprobaciones(),
    plantillas: PLANTILLAS,
    plantillasEquipo: PLANTILLAS_EQUIPO,
    categorias: CATEGORIAS,
    iconos: ICONOS,
    vista: TOKEN_VISTA,
    gruposHerramientas: Object.entries(GRUPOS_HERRAMIENTAS).map(([id, g]) => ({ id, nombre: g.nombre })),
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
// Avisos para las notificaciones del celular (Motor.kt los muestra si la app no está a la vista):
// tareas que quedan bloqueadas o fallan. Se entregan una sola vez.
const avisosMotor: string[] = [];
const yaAvisadas = new Set<string>();
bus.on("evento", (tipo: string, d: { id?: string; estado?: string; titulo?: string; paraId?: string }) => {
  if (tipo !== "tarea" || !d?.id || (d.estado !== "bloqueada" && d.estado !== "fallida")) return;
  const clave = `${d.id}:${d.estado}`;
  if (yaAvisadas.has(clave)) return;
  yaAvisadas.add(clave);
  const quien = d.paraId ? (buscarBot(d.paraId)?.nombre ?? "Un compañero") : "Un compañero";
  avisosMotor.push(`${quien}: «${String(d.titulo ?? "una tarea").slice(0, 80)}» ${d.estado === "bloqueada" ? "quedó bloqueada y necesita algo de vos" : "falló"}.`);
  if (avisosMotor.length > 10) avisosMotor.shift();
});
// Otros avisos para el celular (por ejemplo, una página seguida que cambió o dejó de responder).
bus.on("evento", (tipo: string, d: { texto?: string }) => {
  if (tipo !== "aviso-motor" || !d?.texto) return;
  avisosMotor.push(String(d.texto).slice(0, 240));
  if (avisosMotor.length > 10) avisosMotor.shift();
});

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
        .filter((r) => r.activa && buscarBot(r.botId) && !(r.horario.tipo === "una" && r.ultimaEjecucion))
        .map((r) => proximaEjecucion(r).getTime());
  return {
    ocupado: trabajando > 0 || reunionesActivas > 0 || (!pausa && (enCola > 0 || tareasActivas > 0)),
    trabajando,
    // Solo las usa el celular para notificar: si el usuario las apagó, no se cuentan ni se mandan.
    aprobaciones: ajustes().avisoAprobaciones === false ? 0 : listarAprobaciones().length,
    avisos: ajustes().avisoTareas === false ? avisosMotor.splice(0) && [] : avisosMotor.splice(0),
    proximaRutina: proximas.length ? Math.min(...proximas) : null,
  };
});

ruta("POST", "/api/bots", async ({ cuerpo }) => {
  if (listarBots().length >= MAX_BOTS) throw new ErrorHttp(400, `Podés tener hasta ${MAX_BOTS} compañeros.`);
  const d = validar(DatosBot, await cuerpo());
  const error = validarJefe(null, d.reportaA ?? null);
  if (error) throw new ErrorHttp(400, error);
  const bot = crearBot({ ...d, reportaA: d.reportaA ?? null, esfuerzo: d.esfuerzo ?? null, icono: d.icono ?? null, avatar: d.avatar ?? null });
  const bloqueadas = normalizarBloqueadas(d.bloqueadas);
  if (bloqueadas.length) bot.bloqueadas = bloqueadas;
  if (d.ensenanza) bot.ensenanza = true;
  if (d.modelo) bot.modelo = d.modelo;
  if (d.estilo) bot.estilo = d.estilo;
  if (d.idioma && d.idioma !== "es") bot.idioma = d.idioma;
  if (d.mision) bot.temporal = { mision: d.mision };
  if (bloqueadas.length || d.ensenanza || d.mision || d.modelo || d.estilo || bot.idioma) guardarEstado();
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
    // El perfil no manda el estilo ni la voz de Gemini (se editan en Audio Studio): se conservan.
    avatar: d.avatar === undefined ? (bot.avatar ?? null) : d.avatar && { ...d.avatar, estilo: d.avatar.estilo ?? bot.avatar?.estilo, vozGemini: d.avatar.vozGemini === undefined ? (bot.avatar?.vozGemini ?? null) : d.avatar.vozGemini, cuerpo: d.avatar.cuerpo ?? bot.avatar?.cuerpo, acabado: d.avatar.acabado ?? bot.avatar?.acabado, luz: d.avatar.luz ?? bot.avatar?.luz },
    bloqueadas: d.bloqueadas === undefined ? normalizarBloqueadas(bot.bloqueadas) : normalizarBloqueadas(d.bloqueadas),
    ensenanza: d.ensenanza ?? bot.ensenanza ?? false,
    verificacion: d.verificacion ?? bot.verificacion ?? false,
    modelo: d.modelo === undefined ? (bot.modelo ?? null) : d.modelo,
    topeDiarioUsd: d.topeDiarioUsd === undefined ? (bot.topeDiarioUsd ?? null) : d.topeDiarioUsd || null,
    estilo: d.estilo === undefined ? (bot.estilo ?? null) : d.estilo || null,
    idioma: d.idioma === undefined ? (bot.idioma ?? null) : d.idioma === "es" ? null : d.idioma,
    mentorId: d.mentorId === undefined ? (bot.mentorId ?? null) : d.mentorId && d.mentorId !== bot.id && buscarBot(d.mentorId) ? d.mentorId : null,
    favorito: d.favorito ?? bot.favorito ?? false,
    temporal: d.mision === undefined ? (bot.temporal ?? null) : d.mision ? { mision: d.mision } : null,
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
  quitarBotDeProyectos(bot.id);
  await cerrarHerramientas(bot.id);
  emitir("bots");
  return { ok: true };
});

// Archivar: el compañero deja de trabajar y sale del equipo, pero su conversación, memoria y archivos
// quedan. Se usa sobre todo con los especialistas temporales al terminar su misión.
ruta("POST", "/api/bots/:id/archivar", async ({ params }) => {
  const bot = botDe(params[0]!);
  if (bot.archivado) return vistaBot(bot);
  if (directos(bot.id).length) throw new ErrorHttp(409, `${bot.nombre} tiene gente a cargo: reasigná su equipo antes de archivarlo.`);
  detener(bot.id);
  for (const t of listarTareas()) if (t.paraId === bot.id && abierta(t)) cancelarTarea(t.id, `${bot.nombre} fue archivado.`);
  for (const r of listarRutinas(bot.id)) r.activa = false;
  quitarBotDeMensajeria(bot.id);
  quitarBotDeProyectos(bot.id);
  bot.archivado = ahora();
  guardarEstado();
  emitir("bots");
  emitir("rutinas", { botId: bot.id });
  return vistaBot(bot);
});

ruta("POST", "/api/bots/:id/restaurar", async ({ params }) => {
  const bot = botDe(params[0]!);
  if (!bot.archivado) return vistaBot(bot);
  if (listarBots().length >= MAX_BOTS) throw new ErrorHttp(400, `Ya tenés ${MAX_BOTS} compañeros activos: archivá o borrá alguno primero.`);
  if (bot.reportaA && (!buscarBot(bot.reportaA) || buscarBot(bot.reportaA)!.archivado)) bot.reportaA = null;
  bot.archivado = null;
  guardarEstado();
  emitir("bots");
  return vistaBot(bot);
});

ruta("GET", "/api/bots/:id/conversacion", async ({ params }) => vistaConversacion(conversacion(botDe(params[0]!).id)));

ruta("POST", "/api/bots/:id/mensajes", async ({ params, cuerpo }) => {
  const bot = botDe(params[0]!);
  // `llamada`: id que arma la interfaz cuando el mensaje sale de una llamada de voz. El bot recibe la
  // pista de que lo que conteste se lee en voz alta, y el «cambio» que abre ese turno trae el mismo id.
  const { texto, llamada } = validar(
    z.object({ texto: z.string().trim().min(1).max(20000), llamada: z.string().regex(/^[\w-]{1,64}$/).optional() }),
    await cuerpo(),
  );
  enviarMensaje(bot.id, texto, llamada ? { llamada } : {});
  return { ok: true };
});

// Foto durante una llamada (o desde el chat): se guarda en llamadas/ de la computadora y se le pide al
// compañero que la mire con analizar_video (Gemini). La interfaz la achica antes de mandarla.
const MAX_FOTO = 700_000;
ruta("POST", "/api/bots/:id/foto", async ({ params, cuerpo }) => {
  const bot = botDe(params[0]!);
  const { datos, pedido, llamada } = validar(
    z.object({ datos: z.string().max(Math.ceil((MAX_FOTO * 4) / 3) + 8), pedido: z.string().trim().max(2000).nullish(), llamada: z.string().regex(/^[\w-]{1,64}$/).optional() }),
    await cuerpo(),
  );
  if (!hayGemini) throw new ErrorHttp(400, "Para que los compañeros vean fotos hace falta la clave gratis de Gemini.");
  const bytes = Buffer.from(datos, "base64");
  if (!bytes.length || bytes.length > MAX_FOTO || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new ErrorHttp(400, "La foto tiene que ser un JPEG de menos de 700 KB.");
  const nombre = `foto-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}.jpg`;
  await mkdir(path.join(COMPUTADORA, "llamadas"), { recursive: true });
  await writeFile(path.join(COMPUTADORA, "llamadas", nombre), bytes);
  const ruta = `llamadas/${nombre}`;
  enviarMensaje(bot.id, `Te mando una foto: ${ruta}. Mirala con analizar_video (fuente ${JSON.stringify(ruta)}) y ${pedido?.trim() || "decime qué ves y qué tiene que ver con lo que estamos hablando"}.`, llamada ? { llamada } : {});
  return { ok: true, ruta };
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

ruta("POST", "/api/reuniones/:id/pausar", async ({ params }) => vistaReunion(malPedido(() => pausarReunion(params[0]!)) as ReturnType<typeof pausarReunion>));

ruta("POST", "/api/reuniones/:id/reanudar", async ({ params }) => {
  const r = reanudarReunion(params[0]!);
  if (!r) throw new ErrorHttp(404, "No existe esa reunión.");
  return vistaReunion(r);
});

ruta("POST", "/api/reuniones/:id/cancelar", async ({ params }) => {
  cancelarReunion(params[0]!);
  return { ok: true };
});

ruta("POST", "/api/reuniones/:id/aceptar", async ({ params }) => ({ tareas: malPedido(() => aceptarAcciones(params[0]!)) }));

// ---- Automatizaciones condicionales ----

ruta("GET", "/api/automatizaciones", async () => ({ eventos: EVENTOS, reglas: listarAutomatizaciones() }));
ruta("POST", "/api/automatizaciones", async ({ cuerpo }) => {
  const d = validar(z.object({ nombre: z.string().trim().min(1).max(80), evento: z.enum(Object.keys(EVENTOS) as [keyof typeof EVENTOS, ...(keyof typeof EVENTOS)[]]), botId: z.string().min(1).max(64), instrucciones: z.string().trim().min(1).max(4000) }), await cuerpo());
  return malPedido(() => crearAutomatizacion(d));
});
ruta("PUT", "/api/automatizaciones/:id", async ({ params, cuerpo }) => {
  const { activa } = validar(z.object({ activa: z.boolean() }), await cuerpo());
  return malPedido(() => cambiarAutomatizacion(params[0]!, activa));
});
ruta("DELETE", "/api/automatizaciones/:id", async ({ params }) => {
  if (!borrarAutomatizacion(params[0]!)) throw new ErrorHttp(404, "No existe esa automatización.");
  return { ok: true };
});

// ---- Webhooks entrantes ----

ruta("GET", "/api/webhooks", async () => listarWebhooks());
ruta("POST", "/api/webhooks", async ({ cuerpo }) => {
  const d = validar(z.object({ nombre: z.string().trim().min(1).max(80), botId: z.string().min(1).max(64), instrucciones: z.string().trim().min(1).max(4000) }), await cuerpo());
  return malPedido(() => crearWebhook(d));
});
ruta("DELETE", "/api/webhooks/:id", async ({ params }) => {
  if (!borrarWebhook(params[0]!)) throw new ErrorHttp(404, "No existe ese webhook.");
  return { ok: true };
});

// ---- Productividad de los últimos 7 días por compañero (datos reales del motor) ----

ruta("GET", "/api/estadisticas", async () => {
  const desde = Date.now() - 7 * 86_400_000;
  const gasto = gastoPorBotDesde(7);
  const acciones = leerActividad({ limite: 500 }).filter((r) => Date.parse(r.fecha) >= desde);
  const tareas = listarTareas().filter((t) => t.fin && Date.parse(t.fin) >= desde);
  const deProyectos = listarProyectos().flatMap((p) => p.tareas).filter((t) => t.estado === "completada" && Date.parse(t.actualizada) >= desde);
  return listarBots().map((b) => ({
    botId: b.id,
    tareasCompletas: tareas.filter((t) => t.paraId === b.id && (t.estado === "completa" || t.estado === "parcial")).length + deProyectos.filter((t) => t.asignadoA === b.id).length,
    tareasTrabadas: tareas.filter((t) => t.paraId === b.id && (t.estado === "bloqueada" || t.estado === "fallida")).length,
    acciones: acciones.filter((r) => r.botId === b.id && r.tipo === "herramienta").length,
    errores: acciones.filter((r) => r.botId === b.id && r.tipo === "herramienta" && !r.ok).length,
    gastoUsd: Math.round((gasto[b.id] ?? 0) * 100) / 100,
  }));
});

// ---- Historial de acciones ----

ruta("GET", "/api/actividad", async ({ url }) => leerActividad({ botId: url.searchParams.get("botId"), limite: Number(url.searchParams.get("limite")) || 100 }));

// ---- Buscador global ----

ruta("GET", "/api/buscar", async ({ url }) => buscarTodo((url.searchParams.get("q") ?? "").slice(0, 200)));

// ---- Simulador: comparar alternativas antes de ejecutar (estimaciones del modelo, no datos reales) ----

const Simulacion = z.object({
  alternativas: z.array(z.object({
    nombre: z.string(),
    resumen: z.string(),
    pasos: z.array(z.string()),
    tiempo: z.string().describe("Estimación de duración, ej. «2 a 3 semanas»"),
    costo: z.string().describe("Estimación cualitativa o en rango, ej. «bajo (solo tiempo)»"),
    ventajas: z.array(z.string()),
    riesgos: z.array(z.string()),
  })).describe("Entre 2 y 3 alternativas distintas"),
  recomendacion: z.string().describe("Cuál conviene y por qué, en 2 o 3 oraciones"),
  supuestos: z.array(z.string()).describe("Qué se supuso por falta de datos"),
});
ruta("POST", "/api/simular", async ({ cuerpo }) => {
  const d = validar(z.object({ objetivo: z.string().trim().min(10).max(3000), alternativas: z.array(z.string().trim().max(500)).max(3).default([]) }), await cuerpo());
  const { $schema: _, ...esquema } = z.toJSONSchema(Simulacion, { reused: "inline" });
  const pedido = `Objetivo: ${d.objetivo}\n${d.alternativas.filter(Boolean).length ? `Alternativas a comparar:\n${d.alternativas.filter(Boolean).map((a, i) => `${i + 1}. ${a}`).join("\n")}` : "Proponé vos 2 o 3 alternativas realmente distintas."}`;
  try {
    const m = await client.beta.messages.create(
      { model: MODELO, max_tokens: 8000, betas: [BETA_FALLBACK], fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema" as const, schema: esquema } }, system: "Comparás alternativas para cumplir un objetivo antes de ejecutarlo. Sos concreto y honesto: los tiempos y costos son estimaciones; marcá los supuestos. Respondé en el idioma del usuario.", messages: [{ role: "user", content: pedido }] },
      { signal: AbortSignal.timeout(120_000) },
    );
    registrarUso("simulador", m);
    const texto = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    return Simulacion.parse(JSON.parse(texto));
  } catch (err) {
    throw new ErrorHttp(502, `No se pudo simular: ${String((err as Error).message).slice(0, 200)}`);
  }
});

// ---- Mercado de habilidades (catálogo local revisado) ----

ruta("GET", "/api/mercado", async () => vistaMercado());
ruta("POST", "/api/mercado/:id/instalar", async ({ params }) => {
  const h = malPedido(() => instalarDelMercado(params[0]!));
  emitir("habilidades");
  return h;
});

// ---- Gravity Studio: apps web de un archivo, generadas e iteradas por el modelo ----

ruta("GET", "/api/studio", async () => listarStudio());
ruta("POST", "/api/studio", async ({ cuerpo, req }) => {
  const d = validar(z.object({ nombre: z.string().trim().min(1).max(60), pedido: z.string().max(4000).default(""), errores: z.array(z.string().max(500)).max(20).nullish() }), await cuerpo());
  if (!d.pedido.trim() && !d.errores?.length) throw new ErrorHttp(400, "Contá qué querés crear o cambiar.");
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), 240_000);
  try {
    const r = await generarStudio(d, control.signal);
    emitir("computadora");
    return r;
  } catch (err) {
    if (control.signal.aborted) throw new ErrorHttp(504, "Tardó demasiado: probá con un pedido más chico.");
    throw new ErrorHttp(502, (err as Error).message);
  } finally {
    clearTimeout(corte);
  }
});

// ---- Laboratorio: la misma consulta con cada modelo (y opcionalmente con un compañero), lado a lado ----

ruta("POST", "/api/laboratorio", async ({ cuerpo }) => {
  const { pregunta, botId } = validar(z.object({ pregunta: z.string().trim().min(1).max(4000), botId: z.string().max(64).nullish() }), await cuerpo());
  const bot = botId ? botDe(botId) : null;
  const sistema = bot ? sistemaDe(bot) : "Respondé en el idioma del usuario, claro y directo.";
  const variantes: (PreferenciaModelo | null)[] = [null, "rapido", "potente"];
  return Promise.all(
    variantes.map(async (pref) => {
      const t0 = Date.now();
      try {
        const m = await client.beta.messages.create(
          { model: modeloPara(pref), max_tokens: 1500, betas: [BETA_FALLBACK], fallbacks: "default", output_config: { effort: "low" }, system: sistema, messages: [{ role: "user", content: pregunta }] },
          { signal: AbortSignal.timeout(90_000) },
        );
        registrarUso(bot?.id ?? "laboratorio", m);
        const texto = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
        return { variante: pref ?? "auto", modelo: m.model, ms: Date.now() - t0, texto, tokens: m.usage.output_tokens };
      } catch (err) {
        return { variante: pref ?? "auto", modelo: null, ms: Date.now() - t0, error: String((err as Error).message ?? err).slice(0, 300) };
      }
    }),
  );
});

// ---- Diagnóstico: una consulta mínima al modelo para ver si las claves andan ----

ruta("POST", "/api/diagnostico/modelo", async () => {
  const t0 = Date.now();
  try {
    const m = await client.beta.messages.create(
      { model: MODELO, max_tokens: 16, betas: [BETA_FALLBACK], fallbacks: "default", messages: [{ role: "user", content: "Respondé solo: OK" }] },
      { signal: AbortSignal.timeout(45_000) },
    );
    const texto = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    return { ok: true, proveedor: CONFIG.modelo, modelo: m.model, ms: Date.now() - t0, respuesta: texto.slice(0, 60) };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    const msj = String(e.message ?? err);
    const causa =
      e.status === 401 ? "La clave no es válida o se borró: cargala de nuevo."
      : e.status === 402 || /credit|billing|saldo|payment/i.test(msj) ? "La cuenta no tiene saldo o pide un medio de pago."
      : e.status === 429 ? "Se acabó el cupo por ahora: probá en un rato o cargá un respaldo gratis."
      : /fetch failed|ENOTFOUND|ECONNREFUSED|timeout|connection error/i.test(msj) ? "No hay conexión con el proveedor (internet o servidor propio apagado)."
      : "El proveedor devolvió un error.";
    return { ok: false, proveedor: CONFIG.modelo, ms: Date.now() - t0, causa, detalle: msj.slice(0, 300) };
  }
});

// ---- Rendimiento del motor (memoria, CPU desde la consulta anterior, tiempo prendido) ----

let cpuAntes = { uso: process.cpuUsage(), t: Date.now() };
ruta("GET", "/api/rendimiento", async () => {
  const uso = process.cpuUsage(cpuAntes.uso);
  const ms = Math.max(1, Date.now() - cpuAntes.t);
  cpuAntes = { uso: process.cpuUsage(), t: Date.now() };
  const m = process.memoryUsage();
  return {
    cpu: Math.round(((uso.user + uso.system) / 1000 / ms) * 1000) / 10, // % de un núcleo desde la consulta anterior
    memoria: { rss: m.rss, heap: m.heapUsed, sistemaTotal: totalmem(), sistemaLibre: freemem() },
    prendidoSeg: Math.round(process.uptime()),
    node: process.version,
    plataforma: `${process.platform} ${process.arch}`,
    nucleos: cpus().length,
  };
});

// ---- Auditoría (solo lectura) ----

ruta("GET", "/api/auditoria", async () => auditar());

// Le pasa el informe a un compañero para que lo analice (es un mensaje normal: queda en su chat).
ruta("POST", "/api/auditoria/analizar", async ({ cuerpo }) => {
  const { botId } = validar(z.object({ botId: z.string().min(1).max(64) }), await cuerpo());
  const bot = botDe(botId);
  enviarMensaje(bot.id, informeComoTexto(auditar()));
  return { ok: true };
});

// ---- Gravity Architect: objetivo → propuesta (no crea nada) → el usuario la revisa y la aplica ----

ruta("POST", "/api/arquitecto", async ({ cuerpo, req }) => {
  const { objetivo } = validar(z.object({ objetivo: z.string().trim().min(10, "Contá el objetivo con un poco más de detalle.").max(4000) }), await cuerpo());
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), 180_000);
  req.on("close", () => { if (!req.complete) control.abort(); });
  try {
    return await proponerArquitecto(objetivo, control.signal);
  } catch (err) {
    if (control.signal.aborted) throw new ErrorHttp(504, "La propuesta tardó demasiado. Probá de nuevo.");
    throw new ErrorHttp(502, (err as Error).message);
  } finally {
    clearTimeout(corte);
  }
});

ruta("POST", "/api/arquitecto/aplicar", async ({ cuerpo }) => {
  const { propuesta } = validar(z.object({ propuesta: Propuesta }), await cuerpo());
  return malPedido(() => aplicarArquitecto(propuesta));
});

// ---- Proyectos ----

const vistaProyecto = (p: Proyecto) => ({ ...p, progreso: progreso(p) });

function proyectoDe(id: string): Proyecto {
  const p = listarProyectos().find((x) => x.id === id);
  if (!p) throw new ErrorHttp(404, "No existe ese proyecto.");
  return p;
}

const idBot = z.string().trim().min(1).max(64).nullable().optional();
const DatosNuevoProyecto = z.object({ nombre: z.string().trim().min(1).max(120), objetivo: z.string().max(4000).default(""), coordinadorId: idBot });
const DatosCambioProyecto = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
  objetivo: z.string().max(4000).optional(),
  estado: z.enum(["activo", "pausado", "terminado", "archivado"]).optional(),
  coordinadorId: idBot,
  etiquetas: z.array(z.string().max(30)).max(10).optional(),
});
const camposTarea = {
  detalle: z.string().max(6000).optional(),
  criterio: z.string().max(1000).optional(),
  asignadoA: idBot,
  dependeDe: z.array(z.string().trim().min(1).max(32)).max(50).optional(),
  prioridad: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  vence: z.string().max(40).nullable().optional(),
};
const DatosNuevaTarea = z.object({ titulo: z.string().trim().min(1).max(200), ...camposTarea });
const DatosCambioTarea = z.object({
  titulo: z.string().trim().min(1).max(200).optional(),
  ...camposTarea,
  estado: z.enum(ESTADOS_TAREA).optional(),
  resultado: z.string().max(6000).nullable().optional(),
});

ruta("GET", "/api/proyectos", async () => listarProyectos().map(vistaProyecto));
ruta("GET", "/api/proyectos/:id", async ({ params }) => vistaProyecto(proyectoDe(params[0]!)));

ruta("POST", "/api/proyectos", async ({ cuerpo }) => {
  const d = validar(DatosNuevoProyecto, await cuerpo());
  return vistaProyecto(malPedido(() => crearProyecto(d)) as Proyecto);
});

ruta("PUT", "/api/proyectos/:id", async ({ params, cuerpo }) => {
  const d = validar(DatosCambioProyecto, await cuerpo());
  const p = proyectoDe(params[0]!);
  return vistaProyecto(malPedido(() => cambiarProyecto(p.id, d)) as Proyecto);
});

ruta("DELETE", "/api/proyectos/:id", async ({ params }) => {
  if (!borrarProyecto(proyectoDe(params[0]!).id)) throw new ErrorHttp(404, "No existe ese proyecto.");
  return { ok: true };
});

ruta("POST", "/api/proyectos/:id/tareas", async ({ params, cuerpo }) => {
  const d = validar(DatosNuevaTarea, await cuerpo());
  const p = proyectoDe(params[0]!);
  malPedido(() => agregarTarea(p.id, d));
  return vistaProyecto(p);
});

ruta("PUT", "/api/proyectos/:id/tareas/:tarea", async ({ params, cuerpo }) => {
  const d = validar(DatosCambioTarea, await cuerpo());
  const p = proyectoDe(params[0]!);
  malPedido(() => cambiarTarea(p.id, params[1]!, d));
  return vistaProyecto(p);
});

ruta("DELETE", "/api/proyectos/:id/tareas/:tarea", async ({ params }) => {
  const p = proyectoDe(params[0]!);
  if (!borrarTarea(p.id, params[1]!)) throw new ErrorHttp(404, "No existe esa tarea en el proyecto.");
  return vistaProyecto(p);
});

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
    z.object({ maxLlamadas: z.number().int().min(1).max(60), maxComandos: z.number().int().min(1).max(60), topeDiarioUsd: z.number().min(0).max(10000), autoAprobar: z.boolean(), autoResponder: z.boolean(), avisoAprobaciones: z.boolean(), avisoTareas: z.boolean(), respaldoAutomatico: z.boolean() }).partial(),
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

// Editor del usuario: guarda un archivo de texto de la computadora. Si alguien (un compañero) lo cambió
// después de abrirlo, no lo pisa: avisa con 409.
ruta("PUT", "/api/computadora/archivo", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), contenido: z.string().max(600_000), modificado: z.string().max(40).nullish() }), await cuerpo());
  const archivo = await rutaSegura(COMPUTADORA, d.ruta);
  const info = await stat(archivo).catch(() => null);
  if (info && !info.isFile()) throw new ErrorHttp(400, "Esa ruta es una carpeta.");
  if (info && d.modificado && Math.abs(info.mtimeMs - Date.parse(d.modificado)) > 2) throw new ErrorHttp(409, "El archivo cambió mientras lo editabas (quizás lo tocó un compañero). Copiá tus cambios, recargalo y volvé a intentar.");
  await mkdir(path.dirname(archivo), { recursive: true });
  guardarVersion(archivo);
  await writeFile(archivo, d.contenido);
  emitir("computadora");
  return { ok: true, modificado: (await stat(archivo)).mtime.toISOString() };
});

ruta("GET", "/api/computadora/versiones", async ({ url }) => listarVersiones(url.searchParams.get("ruta") ?? ""));
ruta("GET", "/api/computadora/version", async ({ url }) => {
  const b = malPedido(() => leerVersion(url.searchParams.get("ruta") ?? "", url.searchParams.get("id") ?? "")) as Buffer;
  return { contenido: b.subarray(0, 8000).includes(0) ? null : b.toString("utf8") };
});

// ---- Investigación: fuentes, monitor de cambios y documentos (ver investigacion.ts y documentos.ts) ----
ruta("GET", "/api/fuentes", async ({ url }) => Inv.listarFuentes(url.searchParams.get("q") ?? ""));
ruta("POST", "/api/fuentes", async ({ cuerpo }) => {
  const d = validar(z.object({ url: z.string().url().max(2000), titulo: z.string().max(200).optional(), nota: z.string().max(1000).optional(), etiquetas: z.array(z.string().max(40)).max(10).optional() }), await cuerpo());
  return malPedido(() => Inv.agregarFuente(d));
});
ruta("DELETE", "/api/fuentes", async ({ url }) => { Inv.quitarFuente(url.searchParams.get("url") ?? ""); return { ok: true }; });
const vistaMonitor = (m: Inv.Monitor) => ({ ...m, estadoTexto: Inv.estadoMonitor(m) });
ruta("GET", "/api/monitores", async () => Inv.listarMonitores().map(vistaMonitor));
ruta("POST", "/api/monitores", async ({ cuerpo }) => {
  const d = validar(z.object({ url: z.string().url().max(2000), nombre: z.string().max(80).optional(), cadaHoras: z.number().min(1).max(168).optional(), botId: z.string().max(40).nullish() }), await cuerpo());
  const m = malPedido(() => Inv.crearMonitor(d)) as Inv.Monitor;
  return vistaMonitor(await Inv.revisar(m.id, leerPagina));
});
ruta("POST", "/api/monitores/:id/revisar", async ({ params }) => { try { return vistaMonitor(await Inv.revisar(params[0]!, leerPagina)); } catch (err) { throw new ErrorHttp(404, (err as Error).message); } });
ruta("DELETE", "/api/monitores/:id", async ({ params }) => { Inv.borrarMonitor(params[0]!); return { ok: true }; });
ruta("POST", "/api/documentos/buscar", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), consulta: z.string().max(300).default("") }), await cuerpo());
  const D = await import("./documentos.ts");
  const texto = malPedido(() => D.textoDeDocumento(d.ruta)) as string;
  return { caracteres: texto.length, partes: D.cantidadPartes(texto), comienzo: texto.slice(0, 1200), resultados: d.consulta ? D.buscarEnDocumento(texto, d.consulta, 20) : [] };
});
ruta("GET", "/api/documentos", async () => {
  const D = await import("./documentos.ts");
  return (await listarArchivos(COMPUTADORA)).filter((a) => !a.carpeta && /\.(pdf|docx|odt|pptx)$/i.test(a.ruta) && D.EXT_DOCUMENTOS.test(a.ruta));
});

// ---- Creative Studio (ver creativo.ts) ----
const conCreativo = async <T>(f: (C: typeof import("./creativo.ts"), signal: AbortSignal) => Promise<T>): Promise<T> => {
  const C = await import("./creativo.ts");
  try { const r = await f(C, AbortSignal.timeout(180_000)); emitir("computadora"); return r; } catch (err) { throw new ErrorHttp(400, (err as Error).message); }
};
ruta("GET", "/api/creativo", async () => {
  const C = await import("./creativo.ts");
  const P = await import("./proveedores.ts");
  return { gemini: P.hayGemini, voces: C.VOCES_GEMINI, obras: (await listarArchivos(path.join(COMPUTADORA, "creativo"))).filter((a) => !a.carpeta).map((a) => ({ ...a, ruta: `creativo/${a.ruta}` })).sort((a, b) => b.modificado.localeCompare(a.modificado)).slice(0, 80) };
});
ruta("POST", "/api/creativo/imagen", async ({ cuerpo }) => {
  const d = validar(z.object({ pedido: z.string().trim().min(3).max(2000), base: z.string().max(500).nullish(), aspecto: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional() }), await cuerpo());
  return conCreativo((C, s) => C.generarImagen(d.pedido, { base: d.base, aspecto: d.aspecto }, s));
});
ruta("POST", "/api/creativo/voz", async ({ cuerpo }) => {
  const d = validar(z.object({ texto: z.string().trim().min(1).max(4000), voz: z.string().max(20).default("Kore"), estilo: z.string().max(200).default("") }), await cuerpo());
  return conCreativo(async (C, s) => ({ ruta: await C.generarVoz(d.texto, d.voz, d.estilo, s) }));
});
ruta("POST", "/api/creativo/presentacion", async ({ cuerpo }) => {
  const d = validar(z.object({ tema: z.string().trim().min(3).max(3000), diapositivas: z.number().int().min(3).max(30).default(8), publico: z.string().max(200).default(""), acento: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6CD3F0") }), await cuerpo());
  return conCreativo((C, s) => C.crearPresentacion(d.tema, d.diapositivas, d.publico, d.acento, s));
});
ruta("POST", "/api/creativo/presentacion/rehacer", async ({ cuerpo }) => {
  const d = validar(z.object({ json: z.string().min(1).max(500), acento: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6CD3F0") }), await cuerpo());
  return conCreativo(async (C) => ({ html: C.rehacerPresentacion(d.json, d.acento) }));
});
ruta("POST", "/api/creativo/logos", async ({ cuerpo }) => {
  const d = validar(z.object({ marca: z.string().trim().min(1).max(80), rubro: z.string().max(200).default(""), estilo: z.string().max(200).default("") }), await cuerpo());
  return conCreativo((C, s) => C.crearLogos(d.marca, d.rubro, d.estilo, s));
});
ruta("POST", "/api/creativo/animacion", async ({ cuerpo }) => {
  const d = validar(z.object({ descripcion: z.string().trim().min(5).max(3000) }), await cuerpo());
  return conCreativo(async (C, s) => ({ ruta: await C.crearAnimacion(d.descripcion, s) }));
});

// ---- Competencia de soluciones: varios compañeros resuelven lo mismo por separado y un juez compara ----
const A_COMP = path.join(DATOS, "competencias.json");
type Competencia = { id: string; pedido: string; participantes: string[]; carpeta: string; creada: string; juez: string | null };
const leerComp = async () => JSON.parse(await readFile(A_COMP, "utf8").catch(() => "[]")) as Competencia[];
ruta("GET", "/api/competencias", async () => (await leerComp()).slice(-20).reverse());
ruta("POST", "/api/competencias", async ({ cuerpo }) => {
  const d = validar(z.object({ pedido: z.string().trim().min(5).max(4000), botIds: z.array(z.string().max(40)).min(2).max(4) }), await cuerpo());
  const bots = [...new Set(d.botIds)].map(botDe);
  if (bots.length < 2) throw new ErrorHttp(400, "Elegí al menos dos compañeros distintos.");
  const c: Competencia = { id: nuevoId(), pedido: d.pedido, participantes: bots.map((b) => b.id), carpeta: `competencias/${new Date().toISOString().slice(0, 10)}-${nuevoId()}`, creada: new Date().toISOString(), juez: null };
  for (const b of bots) {
    await mkdir(path.join(COMPUTADORA, c.carpeta, b.nombre.replace(/[^\w-]+/g, "_")), { recursive: true });
    enviarMensaje(b.id, `[Competencia de soluciones] Resolvé esto por tu cuenta, con tu propio enfoque: ${d.pedido}\n\nTrabajá solo en ${c.carpeta}/${b.nombre.replace(/[^\w-]+/g, "_")}/ y no mires las carpetas de los demás (otros compañeros lo resuelven en paralelo). Al terminar dejá ahí RESUMEN.md con tu solución, cómo la verificaste, costo/tiempo estimado y sus riesgos.`);
  }
  const xs = await leerComp();
  xs.push(c);
  await writeFile(A_COMP, JSON.stringify(xs.slice(-50), null, 1));
  emitir("computadora");
  return c;
});
ruta("POST", "/api/competencias/:id/comparar", async ({ params, cuerpo }) => {
  const d = validar(z.object({ juezId: z.string().max(40) }), await cuerpo());
  const xs = await leerComp();
  const c = xs.find((x) => x.id === params[0]);
  if (!c) throw new ErrorHttp(404, "No existe esa competencia.");
  const juez = botDe(d.juezId);
  enviarMensaje(juez.id, `[Juez de competencia] Compará las soluciones independientes a: ${c.pedido}\n\nEstán en ${c.carpeta}/ (una carpeta por participante, cada una con RESUMEN.md). Leelas, verificá lo que se pueda (corré pruebas con probar_aislado si hay código) y armá en ${c.carpeta}/COMPARACION.md una tabla con criterios (cumple el pedido, calidad, riesgos, costo, tiempo), cuál recomendás y por qué, y qué tomarías de las otras. Sé imparcial: no importa quién la hizo.`);
  c.juez = juez.id;
  await writeFile(A_COMP, JSON.stringify(xs, null, 1));
  return { ok: true };
});

// ---- Mi día (ver midia.ts) ----
ruta("GET", "/api/midia", async () => {
  const M = await import("./midia.ts");
  return { hoy: M.hoy(), objetivos: M.listarObjetivos().map((o) => ({ ...o, progreso: M.progresoObjetivo(o) })), plan: M.planDe(), pendientes: M.pendientes(), resumen: M.resumenDelDia() };
});
ruta("GET", "/api/midia/calendario", async () => (await import("./midia.ts")).calendario(14));
ruta("POST", "/api/midia/objetivos", async ({ cuerpo }) => {
  const M = await import("./midia.ts");
  const d = validar(z.object({ titulo: z.string().trim().min(1).max(200), descripcion: z.string().max(2000).optional(), fechaLimite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), proyectoId: z.string().max(40).nullish(), hitos: z.array(z.string().max(200)).max(30).optional() }), await cuerpo());
  return malPedido(() => M.crearObjetivo(d));
});
ruta("PUT", "/api/midia/objetivos/:id", async ({ params, cuerpo }) => {
  const M = await import("./midia.ts");
  const d = validar(z.object({ hito: z.string().max(40).optional(), hecho: z.boolean().optional(), agregarHito: z.string().max(200).optional(), cerrar: z.boolean().optional(), borrar: z.boolean().optional() }), await cuerpo());
  return malPedido(() => M.cambiarObjetivo(params[0]!, d)) ?? { ok: true };
});
ruta("POST", "/api/midia/plan", async ({ cuerpo }) => {
  const M = await import("./midia.ts");
  const d = validar(z.object({ disponibilidad: z.string().max(500).default("") }), await cuerpo());
  try { return await M.planificar(d.disponibilidad, AbortSignal.timeout(90_000)); } catch (err) { throw new ErrorHttp(400, (err as Error).message); }
});

// ---- Gravity Labs: funciones experimentales (ver labs.ts) ----
const conLab = async <T>(f: (K: typeof import("./labs.ts")) => T | Promise<T>): Promise<T> => { const K = await import("./labs.ts"); try { return await f(K); } catch (err) { throw new ErrorHttp(400, (err as Error).message); } };
const iaLab = () => AbortSignal.timeout(240_000);
ruta("GET", "/api/labs/misiones", async () => conLab((K) => K.misiones()));
ruta("GET", "/api/labs/gemelo/:id", async ({ params }) => conLab((K) => K.gemelo(params[0]!)));
ruta("GET", "/api/labs/simular/:id", async ({ params }) => conLab((K) => K.tareasParaSimular(params[0]!)));
ruta("POST", "/api/labs/simular", async ({ cuerpo }) => {
  const d = validar(z.object({ tareas: z.array(z.object({ id: z.string().max(40), titulo: z.string().max(200), min: z.number().min(0).max(10000), probable: z.number().min(0).max(10000), max: z.number().min(0).max(10000), dependeDe: z.array(z.string().max(40)).max(50) })).min(1).max(300), corridas: z.number().int().min(200).max(20000).default(5000), personas: z.number().int().min(1).max(50).nullish() }), await cuerpo());
  return conLab((K) => K.simular(d.tareas, { corridas: d.corridas, personas: d.personas ?? undefined }));
});
ruta("POST", "/api/labs/doctor/:id", async ({ params }) => conLab((K) => K.recetar(params[0]!, iaLab())));
ruta("GET", "/api/labs/doctor/:id", async ({ params }) => conLab((K) => { const p = buscarProyecto(params[0]!); if (!p) throw new Error("No existe ese proyecto."); return K.salud(p); }));
ruta("POST", "/api/labs/arena", async ({ cuerpo }) => {
  const d = validar(z.object({ desafio: z.string().trim().min(5).max(6000), botIds: z.array(z.string().max(40)).min(2).max(4), criterios: z.string().max(500).default("") }), await cuerpo());
  return conLab((K) => K.arena(d.desafio, d.botIds, d.criterios, iaLab()));
});
ruta("GET", "/api/labs/arena", async () => conLab((K) => K.tablaArena()));
ruta("POST", "/api/labs/flujo", async ({ cuerpo }) => { const d = validar(z.object({ pedido: z.string().trim().min(5).max(3000) }), await cuerpo()); return conLab((K) => K.generarFlujo(d.pedido, iaLab())); });
ruta("POST", "/api/labs/habilidad", async ({ cuerpo }) => { const d = validar(z.object({ idea: z.string().trim().min(5).max(3000) }), await cuerpo()); return conLab((K) => K.disenarHabilidad(d.idea, iaLab())); });
ruta("POST", "/api/labs/habilidad/probar", async ({ cuerpo }) => { const d = validar(z.object({ instrucciones: z.string().min(1).max(20000), ejemplo: z.string().min(1).max(4000), botId: z.string().max(40).nullish() }), await cuerpo()); return conLab((K) => K.probarHabilidad(d, iaLab())); });
ruta("POST", "/api/labs/calidad", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().max(500).nullish(), texto: z.string().max(200_000).nullish(), criterios: z.string().max(1000).default(""), pedido: z.string().max(2000).optional() }), await cuerpo());
  return conLab((K) => K.inspeccionar(d, iaLab()));
});
ruta("GET", "/api/labs/aprender", async () => conLab((K) => K.progresoAprendizaje()));
ruta("GET", "/api/labs/nexus", async () => conLab((K) => K.nexus()));

// ---- Gravity Browser (ver navegador.ts) ----
const conNav = async <T>(f: (K: typeof import("./navegador.ts")) => T | Promise<T>): Promise<T> => { const K = await import("./navegador.ts"); try { return await f(K); } catch (err) { throw new ErrorHttp(400, (err as Error).message); } };
const iaNav = () => AbortSignal.timeout(180_000);
ruta("POST", "/api/navegador/abrir", async ({ cuerpo }) => {
  const d = validar(z.object({ url: z.string().trim().min(3).max(2000) }), await cuerpo());
  return conNav((K) => K.abrir(d.url));
});
ruta("GET", "/api/navegador/imagen", async ({ url, res }) => {
  const r = await conNav((K) => K.imagen(url.searchParams.get("url") ?? ""));
  res.writeHead(200, { "Content-Type": r.tipo, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" });
  res.end(r.datos);
  return undefined;
});
ruta("GET", "/api/navegador/buscar", async ({ url }) => conNav((K) => K.buscarWeb(url.searchParams.get("q") ?? "")));
ruta("GET", "/api/navegador/academico", async ({ url }) => conNav((K) => K.buscarAcademico(url.searchParams.get("q") ?? "")));
ruta("GET", "/api/navegador/historial", async ({ url }) => conNav((K) => K.historial(url.searchParams.get("q") ?? "")));
ruta("DELETE", "/api/navegador/historial", async () => conNav((K) => { K.borrarHistorial(); return { ok: true }; }));
ruta("GET", "/api/navegador/marcadores", async () => conNav(async (K) => ({ marcadores: K.marcadores(), proyectos: (await import("./proyectos.ts")).listarProyectos().map((p) => ({ id: p.id, nombre: p.nombre })) })));
ruta("POST", "/api/navegador/marcadores", async ({ cuerpo }) => {
  const d = validar(z.object({ url: z.string().url().max(2000), titulo: z.string().max(200).optional(), proyecto: z.string().max(40).nullish(), etiquetas: z.array(z.string().max(30)).max(15).optional(), nota: z.string().max(1000).optional() }), await cuerpo());
  return conNav(async (K) => {
    const m = K.marcar(d);
    // También queda como fuente en Investigación.
    try { (await import("./investigacion.ts")).agregarFuente({ url: m.url, titulo: m.titulo, nota: m.nota, etiquetas: m.etiquetas }); } catch { /* ya estaba */ }
    return m;
  });
});
ruta("DELETE", "/api/navegador/marcadores/:id", async ({ params }) => conNav((K) => { K.desmarcar(params[0]!); return { ok: true }; }));
ruta("POST", "/api/navegador/exportar", async ({ cuerpo }) => {
  const d = validar(z.object({ de: z.enum(["historial", "marcadores"]), proyecto: z.string().max(40).nullish(), cuaderno: z.string().max(60).nullish() }), await cuerpo());
  return conNav(async (K) => {
    const items = d.de === "historial" ? K.historial().filter((v) => v.tipo === "visita") : K.marcadores(d.proyecto ?? undefined);
    if (!items.length) throw new Error("No hay nada para exportar.");
    const md = K.referenciasMd(items, d.de === "historial" ? "Historial de investigación" : "Marcadores");
    if (d.cuaderno) { const C = await import("./conocimiento.ts"); C.agregarNota(d.cuaderno, md, "navegador"); return { cuaderno: d.cuaderno, cantidad: items.length }; }
    await mkdir(path.join(COMPUTADORA, "investigacion"), { recursive: true });
    const rel = `investigacion/${d.de}-${new Date().toISOString().slice(0, 10)}.md`;
    await writeFile(path.join(COMPUTADORA, rel), md);
    emitir("computadora");
    return { ruta: rel, cantidad: items.length };
  });
});
ruta("POST", "/api/navegador/resumir", async ({ cuerpo }) => { const d = validar(z.object({ url: z.string().max(2000) }), await cuerpo()); return conNav((K) => K.resumir(d.url, iaNav())); });
ruta("POST", "/api/navegador/comparar", async ({ cuerpo }) => { const d = validar(z.object({ urls: z.array(z.string().max(2000)).min(2).max(4) }), await cuerpo()); return conNav((K) => K.comparar(d.urls, iaNav())); });
ruta("POST", "/api/navegador/extraer", async ({ cuerpo }) => {
  const d = validar(z.object({ url: z.string().max(2000), campos: z.array(z.string().max(60)).min(1).max(20), guardar: z.boolean().default(true) }), await cuerpo());
  return conNav(async (K) => {
    const r = await K.extraer(d.url, d.campos, iaNav());
    if (!d.guardar || !r.filas.length) return r;
    await mkdir(path.join(COMPUTADORA, "datos"), { recursive: true });
    const rel = `datos/${(new URL(r.url).hostname.replace(/^www\./, "") + "-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")).replace(/[^\w.-]+/g, "_")}.csv`;
    await writeFile(path.join(COMPUTADORA, rel), K.aCsv(r.campos, r.filas));
    emitir("computadora");
    return { ...r, ruta: rel };
  });
});
ruta("POST", "/api/navegador/tabla", async ({ cuerpo }) => {
  const d = validar(z.object({ url: z.string().max(2000), filas: z.array(z.array(z.string().max(2000)).max(100)).min(1).max(5000) }), await cuerpo());
  return conNav(async (K) => {
    if (!(await K.robotsPermite(d.url))) throw new Error("El sitio no permite que programas extraigan esa página (robots.txt).");
    const campos = d.filas[0]!.map((c, i) => c || `columna ${i + 1}`);
    const filas = d.filas.slice(1).map((f) => Object.fromEntries(campos.map((c, i) => [c, f[i] ?? ""])));
    await mkdir(path.join(COMPUTADORA, "datos"), { recursive: true });
    const rel = `datos/tabla-${new URL(d.url).hostname.replace(/^www\./, "").replace(/[^\w.-]+/g, "_")}-${Date.now().toString(36)}.csv`;
    await writeFile(path.join(COMPUTADORA, rel), K.aCsv(campos, filas));
    K.anotar(d.url, new URL(d.url).hostname, "extracción", `tabla de ${filas.length} filas`);
    emitir("computadora");
    return { ruta: rel, filas: filas.length };
  });
});
ruta("POST", "/api/navegador/traducir", async ({ cuerpo }) => {
  const d = validar(z.object({ textos: z.array(z.string().max(5000)).min(1).max(600), idioma: z.string().trim().min(2).max(40) }), await cuerpo());
  return conNav(async (K) => ({ textos: await K.traducir(d.textos, d.idioma, iaNav()) }));
});
ruta("POST", "/api/navegador/formulario", async ({ cuerpo }) => {
  const d = validar(z.object({ pagina: z.string().url().max(2000), accion: z.string().max(2000), metodo: z.enum(["GET", "POST"]), campos: z.record(z.string().max(100), z.string().max(5000)) }), await cuerpo());
  return conNav((K) => K.enviarFormulario(d));
});

// ---- Gravity Audio Studio (ver audio.ts) ----
const conAu = async <T>(f: (K: typeof import("./audio.ts")) => T | Promise<T>): Promise<T> => { const K = await import("./audio.ts"); try { return await f(K); } catch (err) { throw new ErrorHttp(400, (err as Error).message); } };
ruta("GET", "/api/audio", async ({ url }) => conAu(async (K) => {
  const { hayGemini } = await import("./proveedores.ts");
  const p = url.searchParams;
  return { audios: K.biblioteca({ q: p.get("q") ?? "", etiqueta: p.get("etiqueta") ?? "", categoria: p.get("categoria") ?? "", favoritos: p.get("favoritos") === "1" }), etiquetas: K.todasLasEtiquetas(), categorias: K.CATEGORIAS, gemini: hayGemini };
}));
ruta("POST", "/api/audio/subir", async ({ req, url }) => {
  const K = await import("./audio.ts");
  const carpeta = url.searchParams.get("carpeta") === "reuniones" ? "audio/reuniones" : "audio";
  const nombre = path.basename(url.searchParams.get("nombre") ?? "audio.wav").replace(/[^\w.\- ]+/g, "_");
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) { total += (p as Buffer).length; if (total > 200 * 1024 * 1024) throw new ErrorHttp(413, "El audio pasa los 200 MB."); partes.push(p as Buffer); }
  const datos = Buffer.concat(partes);
  const tipo = K.tipoAudio(datos);
  if (!tipo) throw new ErrorHttp(400, "No es un audio WAV, MP3, OGG, WEBM, M4A o FLAC.");
  const ext = { "audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/flac": ".flac", "audio/webm": ".webm", "audio/mp4": ".m4a" }[tipo]!;
  const base = path.parse(nombre).name.slice(0, 80) || "audio";
  await mkdir(path.join(COMPUTADORA, carpeta), { recursive: true });
  let rel = `${carpeta}/${base}${ext}`;
  if (url.searchParams.get("reemplazar") !== "1") for (let n = 2; await stat(path.join(COMPUTADORA, rel)).then(() => true, () => false); n++) rel = `${carpeta}/${base}-${n}${ext}`;
  await writeFile(path.join(COMPUTADORA, rel), datos);
  const consentimiento = url.searchParams.get("consentimiento");
  if (carpeta === "audio/reuniones") {
    if (!consentimiento) { await rm(path.join(COMPUTADORA, rel), { force: true }); throw new ErrorHttp(400, "Una grabación de reunión necesita el consentimiento de los participantes."); }
    K.registrarConsentimiento(rel, consentimiento);
  }
  emitir("computadora");
  return { ruta: rel };
});
ruta("PUT", "/api/audio/meta", async ({ cuerpo }) => {
  const K = await import("./audio.ts");
  const d = validar(z.object({ ruta: z.string().min(1).max(500), etiquetas: z.array(z.string().max(30)).max(20).optional(), categoria: z.enum(K.CATEGORIAS).nullable().optional(), favorito: z.boolean().optional(), nota: z.string().max(1000).optional() }), await cuerpo());
  return conAu((A) => A.etiquetar(d.ruta, d));
});
ruta("POST", "/api/audio/transcribir", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), hablantes: z.number().int().min(1).max(20).nullish(), idioma: z.string().max(40).nullish() }), await cuerpo());
  const r = await conAu((K) => K.transcribir(d.ruta, d, AbortSignal.timeout(15 * 60_000)));
  emitir("computadora");
  return r;
});
ruta("PUT", "/api/audio/hablantes", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), nombres: z.record(z.string().max(40), z.string().max(40)) }), await cuerpo());
  const r = await conAu((K) => K.renombrarHablantes(d.ruta, d.nombres));
  emitir("computadora");
  return r;
});
ruta("POST", "/api/audio/traducir", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), idioma: z.string().trim().min(2).max(40) }), await cuerpo());
  const r = await conAu((K) => K.traducir(d.ruta, d.idioma, AbortSignal.timeout(10 * 60_000)));
  emitir("computadora");
  return r;
});
ruta("POST", "/api/audio/traducir-frase", async ({ cuerpo }) => {
  const d = validar(z.object({ texto: z.string().trim().min(1).max(4000), idioma: z.string().trim().min(2).max(40) }), await cuerpo());
  return conAu(async (K) => ({ texto: await K.traducirFrase(d.texto, d.idioma, AbortSignal.timeout(60_000)) }));
});
ruta("PUT", "/api/bots/:id/voz", async ({ params, cuerpo }) => {
  const d = validar(z.object({ voz: z.string().max(200).nullable().optional(), velocidad: z.number().min(0.5).max(2).optional(), tono: z.number().min(0.5).max(2).optional(), estilo: z.string().trim().max(200).optional(), vozGemini: z.string().max(20).nullable().optional() }), await cuerpo());
  const bot = buscarBot(params[0]!);
  if (!bot) throw new ErrorHttp(404, "No existe ese compañero.");
  const base = bot.avatar ?? { activo: true, color: "#6CD3F0", expresividad: 60, calidad: "auto" as const, voz: null, velocidad: 1, tono: 1, accesorio: "ninguno" as const };
  bot.avatar = { ...base, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) };
  guardarEstado();
  emitir("bots");
  return bot.avatar;
});
ruta("PUT", "/api/bots/:id/robot", async ({ params, cuerpo }) => {
  const d = validar(DatosAvatar.pick({ color: true, accesorio: true, calidad: true, cuerpo: true, acabado: true, luz: true }).partial(), await cuerpo());
  const bot = buscarBot(params[0]!);
  if (!bot) throw new ErrorHttp(404, "No existe ese compañero.");
  const base = bot.avatar ?? { activo: true, color: "#6CD3F0", expresividad: 60, calidad: "auto" as const, voz: null, velocidad: 1, tono: 1, accesorio: "ninguno" as const };
  bot.avatar = { ...base, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) };
  guardarEstado();
  emitir("bots");
  return bot.avatar;
});
ruta("POST", "/api/robot/guion", async ({ cuerpo }) => {
  const d = validar(z.object({ tema: z.string().trim().min(3).max(20_000), modo: z.enum(["presentar", "ensenar"]).default("presentar"), partes: z.number().int().min(2).max(12).optional(), publico: z.string().max(200).optional() }), await cuerpo());
  try { return await (await import("./robotlab.ts")).guion(d, AbortSignal.timeout(180_000)); } catch (err) { throw new ErrorHttp(400, (err as Error).message); }
});
ruta("POST", "/api/bots/:id/narrar", async ({ params, cuerpo }) => {
  const d = validar(z.object({ texto: z.string().trim().min(1).max(5000) }), await cuerpo());
  const bot = buscarBot(params[0]!);
  if (!bot) throw new ErrorHttp(404, "No existe ese compañero.");
  const C = await import("./creativo.ts");
  try { const ruta = await C.generarVoz(d.texto, bot.avatar?.vozGemini ?? "Kore", bot.avatar?.estilo ?? "", AbortSignal.timeout(120_000)); emitir("computadora"); return { ruta }; } catch (err) { throw new ErrorHttp(400, (err as Error).message); }
});

// ---- Gravity Vision (ver vision.ts) ----
ruta("GET", "/api/vision/imagenes", async ({ url }) => {
  const V = await import("./vision.ts");
  const q = (url.searchParams.get("q") ?? "").toLowerCase(), video = url.searchParams.get("video") === "1";
  const ext = video ? /\.(mp4|webm)$/i : V.EXT_IMAGEN;
  const out: { ruta: string; tamano: number; modificado: string }[] = [];
  const recorrer = async (dir: string, prof: number): Promise<void> => {
    if (prof > 6 || out.length >= 1500) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "build" || e.name === "dist") continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { await recorrer(abs, prof + 1); continue; }
      const rel = path.relative(COMPUTADORA, abs).split(path.sep).join("/");
      if (!ext.test(e.name) || (q && !rel.toLowerCase().includes(q))) continue;
      const st = await stat(abs);
      out.push({ ruta: rel, tamano: st.size, modificado: st.mtime.toISOString() });
    }
  };
  await recorrer(COMPUTADORA, 0);
  return out.sort((a, b) => b.modificado.localeCompare(a.modificado));
});
ruta("POST", "/api/vision/subir", async ({ req, url }) => {
  const V = await import("./vision.ts");
  const nombre = path.basename(url.searchParams.get("nombre") ?? "imagen.png").replace(/[^\w.\- ]+/g, "_");
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) { total += (p as Buffer).length; if (total > 40 * 1024 * 1024) throw new ErrorHttp(413, "El archivo pasa los 40 MB."); partes.push(p as Buffer); }
  const datos = Buffer.concat(partes);
  const esVideo = /\.(mp4|webm)$/i.test(nombre) && (datos.subarray(4, 8).toString("latin1") === "ftyp" || datos.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])));
  const tipo = V.tipoImagen(datos);
  if (!tipo && !esVideo) throw new ErrorHttp(400, "Subí una imagen PNG, JPG, WEBP o GIF, o un video MP4 o WEBM.");
  if (tipo && datos.length > V.MAX_BYTES) throw new ErrorHttp(413, "La imagen pasa los 5 MB.");
  const ext = esVideo ? path.extname(nombre).toLowerCase() : { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[tipo!];
  const base = path.parse(nombre).name.slice(0, 80) || "imagen";
  await mkdir(path.join(COMPUTADORA, "vision"), { recursive: true });
  let rel = `vision/${base}${ext}`;
  for (let n = 2; await stat(path.join(COMPUTADORA, rel)).then(() => true, () => false); n++) rel = `vision/${base}-${n}${ext}`;
  await writeFile(path.join(COMPUTADORA, rel), datos);
  emitir("computadora");
  return { ruta: rel };
});
ruta("POST", "/api/vision/analizar", async ({ cuerpo }) => {
  const V = await import("./vision.ts");
  const d = validar(z.object({ ruta: z.string().min(1).max(500), modo: z.enum(V.MODOS), pregunta: z.string().max(1000).optional() }), await cuerpo());
  try { const r = await V.analizar(d.ruta, d.modo, d.pregunta, AbortSignal.timeout(180_000)); if (r.guardado) emitir("computadora"); return r; } catch (err) { throw new ErrorHttp(400, (err as Error).message); }
});
ruta("GET", "/api/vision/historial", async ({ url }) => (await import("./vision.ts")).listarHistorial(url.searchParams.get("ruta") ?? undefined));
ruta("DELETE", "/api/vision/historial/:id", async ({ params }) => { (await import("./vision.ts")).borrarAnalisis(params[0]!); return { ok: true }; });

// ---- Gravity Knowledge (ver conocimiento.ts) ----
const conKn = async <T>(f: (K: typeof import("./conocimiento.ts")) => T | Promise<T>): Promise<T> => { const K = await import("./conocimiento.ts"); try { return await f(K); } catch (err) { throw new ErrorHttp(400, (err as Error).message); } };
const conKnIa = <T>(f: (K: typeof import("./conocimiento.ts"), s: AbortSignal) => Promise<T>) => conKn((K) => f(K, AbortSignal.timeout(180_000)));
ruta("GET", "/api/conocimiento", async () => conKn((K) => K.listar()));
ruta("POST", "/api/conocimiento", async ({ cuerpo }) => {
  const d = validar(z.object({ nombre: z.string().trim().min(1).max(60), tema: z.string().max(300).default("") }), await cuerpo());
  const r = await conKn((K) => K.crear(d));
  emitir("computadora");
  return r;
});
ruta("GET", "/api/conocimiento/biblioteca", async ({ url }) => conKn(async (K) => {
  const I = await import("./investigacion.ts");
  const q = url.searchParams.get("q") ?? "";
  return { documentos: K.biblioteca(q).slice(0, 500), fuentes: I.listarFuentes(q).slice(0, 200), cuadernos: K.listar().map((c) => ({ nombre: c.nombre, tema: c.tema, documentos: c.documentos, notas: c.notas.length, fichas: c.fichas.length })) };
}));
ruta("POST", "/api/conocimiento/comparar", async ({ cuerpo }) => {
  const d = validar(z.object({ a: z.string().min(1).max(500), b: z.string().min(1).max(500) }), await cuerpo());
  return conKn(async (K) => { const D = await import("./documentos.ts"); return K.comparar(D.textoDeDocumento(d.a), D.textoDeDocumento(d.b)); });
});
ruta("GET", "/api/conocimiento/:id", async ({ params }) => conKn((K) => ({ ...K.leer(params[0]!), documentos: K.documentos(params[0]!), paraHoy: K.fichasParaHoy(params[0]!).length })));
ruta("DELETE", "/api/conocimiento/:id", async ({ params }) => { await conKn((K) => K.borrar(params[0]!)); emitir("computadora"); return { ok: true }; });
ruta("POST", "/api/conocimiento/:id/documentos", async ({ params, cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500) }), await cuerpo());
  const r = await conKn((K) => K.agregarDocumento(params[0]!, d.ruta));
  emitir("computadora");
  return { nombre: r };
});
ruta("DELETE", "/api/conocimiento/:id/documentos", async ({ params, url }) => { await conKn((K) => K.quitarDocumento(params[0]!, url.searchParams.get("archivo") ?? "")); emitir("computadora"); return { ok: true }; });
ruta("POST", "/api/conocimiento/:id/subir", async ({ params, req, url }) => {
  const K = await import("./conocimiento.ts");
  const { EXT_DOCUMENTOS } = await import("./documentos.ts");
  const nombre = path.basename(url.searchParams.get("nombre") ?? "").replace(/[^\w.\- ]+/g, "_");
  if (!EXT_DOCUMENTOS.test(nombre)) throw new ErrorHttp(400, "Subí un PDF, Word, ODT, PowerPoint, texto, Markdown, CSV, JSON o HTML.");
  try { K.leer(params[0]!); } catch (err) { throw new ErrorHttp(404, (err as Error).message); }
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) { total += (p as Buffer).length; if (total > 60 * 1024 * 1024) throw new ErrorHttp(413, "El documento pasa los 60 MB."); partes.push(p as Buffer); }
  let destino = path.join(K.RAIZ, params[0]!, nombre);
  for (let n = 2; await stat(destino).then(() => true, () => false); n++) destino = path.join(K.RAIZ, params[0]!, nombre.replace(/(\.\w+)$/, `-${n}$1`));
  await writeFile(destino, Buffer.concat(partes));
  emitir("computadora");
  return { nombre: path.basename(destino) };
});
ruta("POST", "/api/conocimiento/:id/notas", async ({ params, cuerpo }) => {
  const d = validar(z.object({ texto: z.string().trim().min(1).max(8000) }), await cuerpo());
  return conKn((K) => K.agregarNota(params[0]!, d.texto));
});
ruta("DELETE", "/api/conocimiento/:id/notas/:nota", async ({ params }) => conKn((K) => { K.quitarNota(params[0]!, params[1]!); return { ok: true }; }));
ruta("PUT", "/api/conocimiento/:id/compartir", async ({ params, cuerpo }) => {
  const d = validar(z.object({ con: z.array(z.string().max(40)).max(100) }), await cuerpo());
  return conKn((K) => K.compartir(params[0]!, d.con));
});
ruta("GET", "/api/conocimiento/:id/buscar", async ({ params, url }) => conKn((K) => K.buscar(params[0]!, url.searchParams.get("q") ?? "", 12)));
ruta("POST", "/api/conocimiento/:id/preguntar", async ({ params, cuerpo }) => {
  const d = validar(z.object({ pregunta: z.string().trim().min(2).max(2000) }), await cuerpo());
  return conKnIa((K, s) => K.preguntar(params[0]!, d.pregunta, s));
});
ruta("POST", "/api/conocimiento/:id/mapa", async ({ params }) => conKnIa((K, s) => K.generarMapa(params[0]!, s)));
ruta("POST", "/api/conocimiento/:id/linea", async ({ params }) => conKnIa((K, s) => K.generarLinea(params[0]!, s)));
ruta("POST", "/api/conocimiento/:id/contradicciones", async ({ params }) => conKnIa((K, s) => K.contradicciones(params[0]!, s)));
ruta("POST", "/api/conocimiento/:id/fichas", async ({ params, cuerpo }) => {
  const d = validar(z.object({ cantidad: z.number().int().min(1).max(40).default(10), pregunta: z.string().trim().max(500).optional(), respuesta: z.string().trim().max(2000).optional() }), await cuerpo());
  if (d.pregunta && d.respuesta) return conKn((K) => [K.agregarFicha(params[0]!, { pregunta: d.pregunta!, respuesta: d.respuesta! })]);
  return conKnIa((K, s) => K.generarFichas(params[0]!, d.cantidad, s));
});
ruta("GET", "/api/conocimiento/:id/repaso", async ({ params }) => conKn((K) => K.fichasParaHoy(params[0]!)));
ruta("POST", "/api/conocimiento/:id/fichas/:ficha/repaso", async ({ params, cuerpo }) => {
  const d = validar(z.object({ acerto: z.boolean() }), await cuerpo());
  return conKn((K) => K.repasar(params[0]!, params[1]!, d.acerto));
});
ruta("DELETE", "/api/conocimiento/:id/fichas/:ficha", async ({ params }) => conKn((K) => { K.quitarFicha(params[0]!, params[1]!); return { ok: true }; }));

// ---- Gravity Cloud (ver cloud.ts) ----
const conCloud = async <T>(f: (K: typeof import("./cloud.ts")) => Promise<T>): Promise<T> => { const K = await import("./cloud.ts"); try { return await f(K); } catch (err) { throw new ErrorHttp(400, (err as Error).message); } };
ruta("GET", "/api/cloud/servidores", async () => (await import("./cloud.ts")).listarServidores());
ruta("POST", "/api/cloud/servidores", async ({ cuerpo }) => {
  const d = validar(z.object({ nombre: z.string().max(60).default(""), url: z.string().min(8).max(300), clave: z.string().min(1).max(200) }), await cuerpo());
  return conCloud(async (K) => {
    const s = K.agregarServidor(d);
    const u = await K.revisar(s.id);
    // Solo queda guardado si se pudo entrar: una clave mala o una dirección que no responde no se guardan.
    if (!u?.ok) { K.quitarServidor(s.id); throw new Error(`No pude conectarme: ${u?.error ?? "sin respuesta"}`); }
    return K.listarServidores().find((x) => x.id === s.id);
  });
});
ruta("DELETE", "/api/cloud/servidores/:id", async ({ params }) => { (await import("./cloud.ts")).quitarServidor(params[0]!); return { ok: true }; });
ruta("POST", "/api/cloud/servidores/:id/revisar", async ({ params }) => conCloud((K) => K.revisar(params[0]!)));
ruta("POST", "/api/cloud/servidores/:id/ejecutar", async ({ params, cuerpo }) => {
  const d = validar(z.object({ proyecto: z.string().min(1).max(60), comando: z.string().trim().min(1).max(2000), memoriaMb: z.number().min(64).max(65536).nullish(), cpuSeg: z.number().min(1).max(86400).nullish() }), await cuerpo());
  Code.carpetaProyecto(d.proyecto);
  return conCloud((K) => K.ejecutarRemoto(params[0]!, d.proyecto, d.comando, { memoriaMb: d.memoriaMb, cpuSeg: d.cpuSeg }));
});
ruta("POST", "/api/cloud/repartir", async ({ cuerpo }) => {
  const d = validar(z.object({ proyecto: z.string().min(1).max(60), comandos: z.array(z.string().trim().min(1).max(2000)).min(1).max(50), memoriaMb: z.number().min(64).max(65536).nullish(), cpuSeg: z.number().min(1).max(86400).nullish() }), await cuerpo());
  Code.carpetaProyecto(d.proyecto);
  return conCloud((K) => K.repartir(d.proyecto, d.comandos, { memoriaMb: d.memoriaMb, cpuSeg: d.cpuSeg }));
});
ruta("GET", "/api/cloud/servidores/:id/trabajos", async ({ params, url }) => conCloud((K) => K.trabajosRemotos(params[0]!, url.searchParams.get("p") ?? undefined)));
ruta("POST", "/api/cloud/servidores/:id/traer", async ({ params, cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), proyecto: z.string().min(1).max(60) }), await cuerpo());
  const dir = path.join(Code.carpetaProyecto(d.proyecto), "remoto");
  await mkdir(dir, { recursive: true });
  const destino = path.join(dir, path.basename(d.ruta));
  const bytes = await conCloud((K) => K.traerArchivo(params[0]!, d.ruta, destino));
  emitir("computadora");
  return { ruta: path.relative(COMPUTADORA, destino), bytes };
});
ruta("POST", "/api/cloud/servidores/:id/copia", async ({ params }) => conCloud((K) => K.enviarCopia(params[0]!)));
ruta("GET", "/api/cloud/servidores/:id/copias", async ({ params }) => conCloud((K) => K.pedir(params[0]!, "GET", "/api/cloud/copias")));
ruta("POST", "/api/cloud/servidores/:id/traer-copia", async ({ params, cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500) }), await cuerpo());
  await mkdir(path.join(COMPUTADORA, "copias-traidas"), { recursive: true });
  const rel = `copias-traidas/${path.basename(d.ruta).replace(/\.gravity$/, "")}.zip`;
  const bytes = await conCloud((K) => K.traerCopia(params[0]!, d.ruta, path.join(COMPUTADORA, rel)));
  emitir("computadora");
  return { ruta: rel, bytes };
});
ruta("GET", "/api/cloud/servidores/:id/companeros", async ({ params }) => conCloud(async (K) => ((await K.pedir(params[0]!, "GET", "/api/estado")) as { bots: { id: string; nombre: string; titulo: string; estado: string }[] }).bots.map((b) => ({ id: b.id, nombre: b.nombre, titulo: b.titulo, estado: b.estado }))));
ruta("POST", "/api/cloud/servidores/:id/mensaje", async ({ params, cuerpo }) => {
  const d = validar(z.object({ botId: z.string().max(40), texto: z.string().trim().min(1).max(8000) }), await cuerpo());
  return conCloud((K) => K.pedir(params[0]!, "POST", `/api/bots/${encodeURIComponent(d.botId)}/mensajes`, { texto: d.texto }));
});
// Del lado del Gravity remoto: recibir un proyecto (zip) y guardar copias cifradas.
ruta("POST", "/api/code/importar-zip", async ({ req, url }) => {
  const p = url.searchParams.get("p") ?? "";
  const dir = Code.carpetaProyecto(p);
  const partes: Buffer[] = [];
  let total = 0;
  for await (const x of req) { total += (x as Buffer).length; if (total > 300 * 1024 * 1024) throw new ErrorHttp(413, "El proyecto pasa los 300 MB."); partes.push(x as Buffer); }
  const zip = path.join(tmpdir(), `gravity-importar-${Date.now()}.zip`);
  await writeFile(zip, Buffer.concat(partes));
  try {
    const { extraerZip } = await import("./respaldo.ts");
    const archivos = malPedido(() => extraerZip(zip, dir, { quitarRaiz: false })) as number;
    emitir("computadora");
    return { archivos };
  } finally {
    await rm(zip, { force: true });
  }
});
ruta("POST", "/api/cloud/recibir", async ({ req }) => {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const x of req) { total += (x as Buffer).length; if (total > 2 * 1024 * 1024 * 1024) throw new ErrorHttp(413, "La copia es demasiado grande."); partes.push(x as Buffer); }
  const datos = Buffer.concat(partes);
  if (!datos.subarray(0, 16).toString().startsWith("GRAVITY-COPIA-1")) throw new ErrorHttp(400, "No es una copia cifrada de Gravity.");
  await mkdir(path.join(COMPUTADORA, "copias-recibidas"), { recursive: true });
  const rel = `copias-recibidas/copia-${new Date().toISOString().replace(/[:.]/g, "-")}.gravity`;
  await writeFile(path.join(COMPUTADORA, rel), datos);
  return { ruta: rel, bytes: datos.length };
});
ruta("GET", "/api/cloud/copias", async () => (await listarArchivos(path.join(COMPUTADORA, "copias-recibidas")).catch(() => [])).filter((a) => !a.carpeta).map((a) => ({ ...a, ruta: `copias-recibidas/${a.ruta}` })));

// ---- Gravity Evolution (experimental, ver evolucion.ts): propone; aplica solo cuando el usuario toca Aplicar ----
ruta("GET", "/api/evolucion", async () => propuestasEvolucion());
ruta("POST", "/api/evolucion/aplicar", async ({ cuerpo }) => {
  const d = validar(z.object({ id: z.string().min(1).max(200) }), await cuerpo());
  return malPedido(() => aplicarPropuesta(d.id));
});
ruta("POST", "/api/evolucion/descartar", async ({ cuerpo }) => {
  const d = validar(z.object({ id: z.string().min(1).max(200) }), await cuerpo());
  descartarPropuesta(d.id);
  return { ok: true };
});

// ---- Canales (ver canales.ts) ----

const canalDe = (id: string) => { const c = Canales.buscarCanal(id); if (!c) throw new ErrorHttp(404, "No existe ese canal."); return c; };
const vistaCanal = (c: Canales.Canal) => ({ ...c, mensajes: undefined, cantidad: c.mensajes.length, ultimo: c.mensajes.at(-1) ?? null, miembros: Canales.miembros(c).map((b) => b.id) });
ruta("GET", "/api/canales", async () => Canales.listarCanales().map(vistaCanal));
ruta("GET", "/api/canales/:id", async ({ params }) => { const c = canalDe(params[0]!); return { ...vistaCanal(c), mensajes: c.mensajes.slice(-200) }; });
ruta("POST", "/api/canales", async ({ cuerpo }) => {
  const d = validar(z.object({ nombre: z.string().trim().min(2).max(40), descripcion: z.string().trim().max(300).default("") }), await cuerpo());
  return vistaCanal(malPedido(() => Canales.crearCanal(d.nombre, d.descripcion)) as Canales.Canal);
});
ruta("DELETE", "/api/canales/:id", async ({ params }) => { malPedido(() => Canales.borrarCanal(params[0]!)); return { ok: true }; });
ruta("POST", "/api/canales/:id/mensajes", async ({ params, cuerpo }) => {
  const d = validar(z.object({ texto: z.string().trim().min(1).max(8000) }), await cuerpo());
  try { return await Canales.publicar(canalDe(params[0]!).id, "usuario", d.texto); } catch (err) { throw err instanceof ErrorHttp ? err : new ErrorHttp(400, (err as Error).message); }
});
ruta("POST", "/api/canales/:id/resumir", async ({ params }) => {
  const c = canalDe(params[0]!);
  if (c.mensajes.length < 3) throw new ErrorHttp(400, "Hay muy poco para resumir.");
  try {
    const r = await resumir(Canales.textoParaResumen(c), `Resumí el canal #${c.nombre}.`, AbortSignal.timeout(90_000));
    return await Canales.publicar(c.id, "gravity", `Resumen del canal (pedido por vos):\n${r}`);
  } catch (err) {
    throw new ErrorHttp(400, (err as Error).message);
  }
});

// Comentarios en tareas de proyecto (con @menciones).
ruta("POST", "/api/proyectos/:id/tareas/:tid/comentarios", async ({ params, cuerpo }) => {
  const d = validar(z.object({ texto: z.string().trim().min(1).max(4000) }), await cuerpo());
  const { comentarTarea } = await import("./proyectos.ts");
  try { return await comentarTarea(params[0]!, params[1]!, "usuario", d.texto); } catch (err) { throw new ErrorHttp(400, (err as Error).message); }
});

// Transferir una conversación a otro compañero sin perder el contexto: va con los últimos mensajes
// (texto del usuario y respuestas, sin herramientas ni datos de conexiones) y una nota del usuario.
ruta("POST", "/api/bots/:id/transferir", async ({ params, cuerpo }) => {
  const de = botDe(params[0]!);
  const d = validar(z.object({ a: z.string().min(1).max(40), nota: z.string().trim().max(2000).default(""), mensajes: z.number().int().min(2).max(40).default(12) }), await cuerpo());
  const a = botDe(d.a);
  if (a.id === de.id) throw new ErrorHttp(400, "Elegí a otro compañero.");
  const items = vistaConversacion(conversacion(de.id)).filter((x) => x.tipo === "usuario" || x.tipo === "bot").slice(-d.mensajes) as { tipo: string; texto: string }[];
  if (!items.length) throw new ErrorHttp(400, "La conversación está vacía.");
  const contexto = items.map((x) => `${x.tipo === "usuario" ? "Usuario" : de.nombre}: ${x.texto.slice(0, 1500)}`).join("\n");
  enviarMensaje(a.id, `[Transferencia de ${de.nombre} (${de.titulo})] El usuario te pasa esta conversación para que sigas vos.${d.nota ? `\nNota del usuario: ${d.nota}` : ""}\n\nÚltimos mensajes:\n${contexto}\n\nContinuá desde ahí: confirmá en una línea qué entendiste y seguí.`);
  agregarNota(de.id, "aviso", `Conversación transferida a ${a.nombre}.`);
  emitir("cambio", { botId: de.id });
  return { ok: true, a: a.id };
});

// ---- Gravity Data Lab (ver datos.ts) ----

const EXT_DATOS = /\.(csv|tsv|txt|json|xlsx)$/i;
const tablaDe = (ruta: string) => malPedido(() => Datos.leerTabla(ruta)) as Datos.Tabla;
const Periodo = z.enum(["dia", "semana", "mes", "trimestre", "año"]);
ruta("GET", "/api/datos/archivos", async () => (await listarArchivos(COMPUTADORA)).filter((a) => !a.carpeta && EXT_DATOS.test(a.ruta) && !a.ruta.startsWith("codigo/") && a.ruta !== "datos/tableros.json"));
ruta("POST", "/api/datos/subir", async ({ req, url }) => {
  const nombre = (url.searchParams.get("nombre") ?? "").trim();
  if (!EXT_DATOS.test(nombre)) throw new ErrorHttp(400, "Subí un .csv, .tsv, .txt, .json o .xlsx.");
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > 30 * 1024 * 1024) throw new ErrorHttp(413, "El archivo pasa los 30 MB.");
    partes.push(p as Buffer);
  }
  const dir = path.join(COMPUTADORA, "datos");
  await mkdir(dir, { recursive: true });
  const base = path.basename(nombre).replace(/[^\w.-]+/g, "_");
  let rel = `datos/${base}`;
  for (let n = 2; await stat(path.join(COMPUTADORA, rel)).then(() => true, () => false); n++) rel = `datos/${base.replace(/(\.\w+)$/, `-${n}$1`)}`;
  await writeFile(path.join(COMPUTADORA, rel), Buffer.concat(partes));
  emitir("computadora");
  return { ruta: rel };
});
ruta("POST", "/api/datos/analizar", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500) }), await cuerpo());
  const t = tablaDe(d.ruta);
  return { columnas: t.columnas, filas: t.filas.length, perfil: Datos.perfil(t), muestra: t.filas.slice(0, 50) };
});
ruta("POST", "/api/datos/consultar", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), consulta: Datos.Consulta }), await cuerpo());
  return malPedido(() => Datos.consultar(tablaDe(d.ruta), d.consulta));
});
ruta("POST", "/api/datos/comparar", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), fecha: z.string(), valor: z.string().nullable(), periodo: Periodo, metrica: z.enum(["contar", "suma", "promedio", "minimo", "maximo", "mediana"]).default("suma") }), await cuerpo());
  return malPedido(() => Datos.compararPeriodos(tablaDe(d.ruta), d.fecha, d.valor, d.periodo, d.metrica));
});
ruta("POST", "/api/datos/anomalias", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), columna: z.string() }), await cuerpo());
  return malPedido(() => Datos.anomalias(tablaDe(d.ruta), d.columna));
});
ruta("POST", "/api/datos/pronostico", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), fecha: z.string(), valor: z.string().nullable(), periodo: Periodo, pasos: z.number().int().min(1).max(12).default(3) }), await cuerpo());
  return malPedido(() => Datos.pronosticar(tablaDe(d.ruta), d.fecha, d.valor, d.periodo, d.pasos));
});
ruta("POST", "/api/datos/transformar", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), op: Datos.Transformacion, nombre: z.string().trim().max(80).nullish() }), await cuerpo());
  const t = malPedido(() => Datos.transformar(tablaDe(d.ruta), d.op)) as Datos.Tabla;
  const destino = Datos.guardarEnComputadora(`${(d.nombre || path.basename(d.ruta).replace(/\.\w+$/, "") + "-limpio").replace(/\.csv$/i, "")}.csv`, Datos.aCsv(t));
  emitir("computadora");
  return { ruta: destino, filas: t.filas.length, columnas: t.columnas };
});
ruta("POST", "/api/datos/preguntar", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), pregunta: z.string().trim().min(3).max(1000) }), await cuerpo());
  try {
    return await preguntarDatos(tablaDe(d.ruta), d.pregunta, AbortSignal.timeout(90_000));
  } catch (err) {
    throw err instanceof ErrorHttp ? err : new ErrorHttp(400, (err as Error).message);
  }
});
ruta("POST", "/api/datos/informe", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), consulta: Datos.Consulta.nullish(), anomalias: z.string().nullish(), pronostico: z.object({ fecha: z.string(), valor: z.string().nullable(), periodo: Periodo }).nullish() }), await cuerpo());
  const t = tablaDe(d.ruta);
  const md = malPedido(() => Datos.informe(d.ruta, t, {
    consulta: d.consulta ? Datos.consultar(t, d.consulta) : undefined,
    anomalias: d.anomalias ? { ...Datos.anomalias(t, d.anomalias), columna: d.anomalias } : undefined,
    pronostico: d.pronostico ? Datos.pronosticar(t, d.pronostico.fecha, d.pronostico.valor, d.pronostico.periodo) : undefined,
  })) as string;
  const destino = Datos.guardarEnComputadora(`informe-${path.basename(d.ruta).replace(/\.\w+$/, "")}.md`, md);
  emitir("computadora");
  return { ruta: destino };
});
// Tableros: gráficos guardados que se recalculan con los datos actuales cada vez que se abren.
const TABLEROS = () => path.join(COMPUTADORA, "datos", "tableros.json");
const Grafico = z.object({ id: z.string().max(40), titulo: z.string().max(120), tipo: z.enum(["barras", "lineas", "torta"]), ruta: z.string().max(500), consulta: Datos.Consulta });
const Tablero = z.object({ id: z.string().max(40), nombre: z.string().trim().min(1).max(80), graficos: z.array(Grafico).max(24) });
ruta("GET", "/api/datos/tableros", async () => {
  const xs = JSON.parse(await readFile(TABLEROS(), "utf8").catch(() => "[]")) as z.infer<typeof Tablero>[];
  return xs.map((t) => ({ ...t, graficos: t.graficos.map((g) => { try { return { ...g, resultado: Datos.consultar(Datos.leerTabla(g.ruta), g.consulta) }; } catch (err) { return { ...g, error: (err as Error).message }; } }) }));
});
ruta("PUT", "/api/datos/tableros", async ({ cuerpo }) => {
  const xs = validar(z.array(Tablero).max(30), await cuerpo());
  await mkdir(path.dirname(TABLEROS()), { recursive: true });
  await writeFile(TABLEROS(), JSON.stringify(xs, null, 2));
  return { ok: true };
});

// ---- Gravity Code (ver codigo.ts): el proyecto va en ?p= o en el cuerpo, porque puede tener espacios ----

const codeDe = (url: URL) => {
  const p = url.searchParams.get("p") ?? "";
  if (!Code.listarProyectosCodigo().some((x) => x.nombre === p)) throw new ErrorHttp(404, "No existe ese proyecto.");
  return p;
};
ruta("GET", "/api/code", async () => ({ proyectos: Code.listarProyectosCodigo(), plantillas: Code.PLANTILLAS_CODIGO, carpeta: Code.CARPETA_CODIGO }));
ruta("POST", "/api/code", async ({ cuerpo }) => {
  const d = validar(z.object({ nombre: z.string().trim().min(1).max(60), plantilla: z.string().max(20).default("vacio"), descripcion: z.string().trim().max(2000).default("") }), await cuerpo());
  const p = malPedido(() => Code.crearProyectoCodigo(d.nombre, d.plantilla, d.descripcion));
  emitir("computadora");
  return p;
});
ruta("POST", "/api/code/importar", async ({ cuerpo }) => {
  const d = validar(z.object({ repo: z.string().trim().min(3).max(300), nombre: z.string().trim().max(60).nullish() }), await cuerpo());
  try {
    const p = await Code.importarGithub(d.repo, d.nombre ?? null, tokenGithub(), AbortSignal.timeout(180_000));
    emitir("computadora");
    return p;
  } catch (err) {
    throw new ErrorHttp(400, (err as Error).message);
  }
});
ruta("DELETE", "/api/code", async ({ url }) => {
  Code.borrarProyecto(codeDe(url));
  emitir("computadora");
  return { ok: true };
});
ruta("GET", "/api/code/memoria", async ({ url }) => ({ texto: Code.leerMemoriaCodigo(codeDe(url)) }));
ruta("PUT", "/api/code/memoria", async ({ url, cuerpo }) => {
  const d = validar(z.object({ texto: z.string().max(200_000) }), await cuerpo());
  Code.guardarMemoriaCodigo(codeDe(url), d.texto);
  return { ok: true };
});
ruta("GET", "/api/code/buscar", async ({ url }) => {
  const q = url.searchParams.get("q") ?? "";
  if (!q) return { coincidencias: [], recortado: false };
  return malPedido(() => Code.buscarEnProyecto(codeDe(url), q, { regex: url.searchParams.get("regex") === "1", mayusculas: url.searchParams.get("mayus") === "1" }));
});
ruta("POST", "/api/code/reemplazar", async ({ url, cuerpo }) => {
  const d = validar(z.object({ texto: z.string().min(1).max(500), reemplazo: z.string().max(5000), regex: z.boolean().default(false), mayusculas: z.boolean().default(false) }), await cuerpo());
  const r = malPedido(() => Code.reemplazarEnProyecto(codeDe(url), d.texto, d.reemplazo, d));
  emitir("computadora");
  return r;
});
ruta("POST", "/api/code/archivos", async ({ url, cuerpo }) => {
  const d = validar(z.object({ op: z.enum(["carpeta", "renombrar", "borrar"]), ruta: z.string().min(1).max(500), a: z.string().max(500).nullish() }), await cuerpo());
  const p = codeDe(url);
  malPedido(() => (d.op === "carpeta" ? Code.crearCarpeta(p, d.ruta) : d.op === "renombrar" ? Code.renombrar(p, d.ruta, d.a ?? "") : Code.borrar(p, d.ruta)));
  emitir("computadora");
  return { ok: true };
});
ruta("POST", "/api/code/ejecutar", async ({ url, cuerpo }) => {
  const d = validar(z.object({ comando: z.string().trim().min(1).max(2000), aislado: z.boolean().default(false), memoriaMb: z.number().min(64).max(65536).nullish(), cpuSeg: z.number().min(1).max(86400).nullish() }), await cuerpo());
  return malPedido(() => Code.ejecutarEnProyecto(codeDe(url), d.comando, d.aislado, () => emitir("computadora"), { memoriaMb: d.memoriaMb, cpuSeg: d.cpuSeg }));
});
ruta("GET", "/api/code/ejecuciones", async ({ url }) => Code.listarEjecuciones(url.searchParams.get("p") ?? undefined));
// Git Manager (ver git.ts). Subir, traer y abrir pull requests los hace el usuario con su botón.
ruta("GET", "/api/code/git", async ({ url }) => (await import("./git.ts")).estado(codeDe(url)));
ruta("GET", "/api/code/git/head", async ({ url }) => ({ contenido: await (await import("./git.ts")).enHead(codeDe(url), url.searchParams.get("ruta") ?? "") }));
ruta("POST", "/api/code/git", async ({ url, cuerpo }) => {
  const G = await import("./git.ts");
  const p = codeDe(url);
  const d = validar(z.object({ accion: z.enum(["iniciar", "commit", "rama", "cambiar", "unir", "remoto", "subir", "traer", "pr"]), mensaje: z.string().max(2000).default(""), rama: z.string().max(80).default(""), url: z.string().max(300).default(""), titulo: z.string().max(200).default(""), base: z.string().max(80).default("main") }), await cuerpo());
  const yo = { nombre: "Usuario de Gravity", email: "usuario@gravity.local" };
  try {
    let r = "";
    if (d.accion === "iniciar") { await G.iniciar(p); r = "Repositorio creado."; }
    else if (d.accion === "commit") r = `Commit ${(await G.commit(p, d.mensaje, yo)).slice(0, 7)}.`;
    else if (d.accion === "rama") { await G.crearRama(p, d.rama); r = `Rama ${d.rama} creada.`; }
    else if (d.accion === "cambiar") { await G.cambiarRama(p, d.rama); r = `Ahora en ${d.rama}.`; }
    else if (d.accion === "unir") r = await G.unir(p, d.rama, yo);
    else if (d.accion === "remoto") { await G.ponerRemoto(p, d.url); r = "Remoto guardado."; }
    else if (d.accion === "subir") r = await G.subir(p, tokenGithub());
    else if (d.accion === "traer") r = await G.traer(p, tokenGithub(), yo);
    else r = await G.pullRequest(p, tokenGithub(), d.titulo || d.mensaje.split("\n")[0] || "Cambios desde Gravity", d.mensaje, d.base);
    emitir("computadora");
    return { mensaje: r, estado: await G.estado(p) };
  } catch (err) {
    throw new ErrorHttp(400, (err as Error).message);
  }
});
// Equipo de programación del proyecto (ver equipo-codigo.ts).
ruta("GET", "/api/code/equipo", async ({ url }) => (await import("./equipo-codigo.ts")).estadoEquipo(codeDe(url)));
ruta("POST", "/api/code/equipo", async ({ url, cuerpo }) => {
  const E = await import("./equipo-codigo.ts");
  const d = validar(z.object({ cantidad: z.number().int().min(3).max(E.MAX_EQUIPO_CODIGO), escribirSinPermiso: z.boolean().default(true), probarSinPermiso: z.boolean().default(true) }), await cuerpo());
  const p = codeDe(url);
  malPedido(() => E.armarEquipoCodigo(p, d));
  emitir("bots"); emitir("reglas"); emitir("proyectos", {});
  return E.estadoEquipo(p);
});
ruta("POST", "/api/code/equipo/encargar", async ({ url, cuerpo }) => {
  const E = await import("./equipo-codigo.ts");
  const d = validar(z.object({ objetivo: z.string().trim().min(5).max(6000) }), await cuerpo());
  try { await E.encargar(codeDe(url), d.objetivo); } catch (err) { throw new ErrorHttp(400, (err as Error).message); }
  return { ok: true };
});
ruta("POST", "/api/code/equipo/sumar", async ({ url, cuerpo }) => {
  const E = await import("./equipo-codigo.ts");
  const d = validar(z.object({ cantidad: z.number().int().min(1).max(30), rol: z.string().max(30) }), await cuerpo());
  const p = codeDe(url);
  malPedido(() => E.sumarAlEquipo(p, d.cantidad, d.rol));
  emitir("bots");
  return E.estadoEquipo(p);
});
// Captura de pantalla para «Desde una captura» (Gravity Code Vision): queda en .gravity/capturas/.
ruta("POST", "/api/code/captura", async ({ req, url }) => {
  const p = codeDe(url);
  const partes: Buffer[] = [];
  let total = 0;
  for await (const x of req) { total += (x as Buffer).length; if (total > 12 * 1024 * 1024) throw new ErrorHttp(413, "La imagen pasa los 12 MB."); partes.push(x as Buffer); }
  const datos = Buffer.concat(partes);
  const ext = datos.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? "png" : datos[0] === 0xff && datos[1] === 0xd8 ? "jpg" : datos.subarray(8, 12).toString() === "WEBP" ? "webp" : null;
  if (!ext) throw new ErrorHttp(400, "Subí una imagen PNG, JPG o WEBP.");
  const rel = `codigo/${p}/.gravity/capturas/captura-${Date.now()}.${ext}`;
  await mkdir(path.dirname(path.join(COMPUTADORA, rel)), { recursive: true });
  await writeFile(path.join(COMPUTADORA, rel), datos);
  return { ruta: rel };
});
ruta("GET", "/api/code/entorno", async ({ url }) => Code.entorno(codeDe(url)));
ruta("GET", "/api/code/dependencias", async ({ url }) => Code.dependencias(codeDe(url)));
ruta("GET", "/api/code/problemas", async ({ url }) => {
  const p = codeDe(url);
  const e = Code.listarEjecuciones(p).find((x) => x.id === url.searchParams.get("id"));
  return e ? Code.problemas(p, e.salida) : [];
});
// Completar con IA: el usuario lo pide (no en cada tecla). Devuelve solo el código a insertar en el cursor.
ruta("POST", "/api/code/completar", async ({ url, cuerpo }) => {
  const p = codeDe(url);
  const d = validar(z.object({ ruta: z.string().max(500), antes: z.string().max(6000), despues: z.string().max(2000), pedido: z.string().max(500).default("") }), await cuerpo());
  const { client, modeloPara, BETA_FALLBACK } = await import("./cliente.ts");
  const { llamar } = await import("./cupo.ts");
  const { registrarUso } = await import("./gasto.ts");
  try {
    const m = await llamar("code", "usuario", AbortSignal.timeout(60_000), () => client.beta.messages.create({ model: modeloPara("rapido"), max_tokens: 1200, betas: [BETA_FALLBACK], fallbacks: "default", output_config: { effort: "low" },
      system: "Completás código en el cursor. Devolvé SOLO el código a insertar (sin explicaciones, sin ``` y sin repetir lo que ya está antes o después del cursor), siguiendo el estilo y el lenguaje del archivo. Si no hay nada razonable que agregar, devolvé vacío.",
      messages: [{ role: "user", content: `Proyecto: ${p}\nArchivo: ${d.ruta}${d.pedido ? `\nPedido: ${d.pedido}` : ""}\n\n<antes_del_cursor>\n${d.antes}\n</antes_del_cursor>\n<despues_del_cursor>\n${d.despues}\n</despues_del_cursor>` }] }, { signal: AbortSignal.timeout(60_000) }));
    registrarUso("code", m);
    const texto = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").replace(/^```[\w-]*\n?|```\s*$/g, "");
    return { codigo: texto };
  } catch (err) {
    throw new ErrorHttp(400, (err as Error).message);
  }
});
ruta("POST", "/api/code/desplegar", async ({ url }) => { const r = Code.prepararDespliegue(codeDe(url)); emitir("computadora"); return { creados: r }; });
// Revisión multiagente: cada revisor recibe por separado (sin ver a los otros) los archivos cambiados.
ruta("POST", "/api/code/revision", async ({ url, cuerpo }) => {
  const p = codeDe(url);
  const d = validar(z.object({ botIds: z.array(z.string().max(40)).min(1).max(4), horas: z.number().min(1).max(168).default(24) }), await cuerpo());
  const desde = Date.now() - d.horas * 3600_000;
  const archivos = (await listarArchivos(path.join(COMPUTADORA, "codigo", p))).filter((a) => !a.carpeta && Date.parse(a.modificado) >= desde).map((a) => `codigo/${p}/${a.ruta}`).slice(0, 40);
  if (!archivos.length) throw new ErrorHttp(400, `No hay archivos cambiados en las últimas ${d.horas} h.`);
  for (const id of d.botIds) {
    const b = botDe(id);
    enviarMensaje(b.id, `[Revisión de código independiente · proyecto «${p}»] Revisá estos archivos cambiados en las últimas ${d.horas} h:\n${archivos.map((x) => `- ${x}`).join("\n")}\n\nLeé la memoria técnica (codigo/${p}/.gravity/memoria.md) y los archivos. Buscá errores, problemas de seguridad, casos no cubiertos y pruebas que falten; corré las pruebas con probar_aislado. No cambies nada: entregá una lista priorizada (bloqueante / importante / menor) con archivo y línea, y si lo aprobarías. Otros revisores lo miran por separado.`);
  }
  return { archivos: archivos.length, revisores: d.botIds.length };
});
ruta("POST", "/api/code/ejecuciones/:id/detener", async ({ params }) => ({ ok: Code.detenerEjecucion(params[0]!) }));
ruta("GET", "/api/code/exportar", async ({ url, res }) => {
  const p = codeDe(url);
  const zip = path.join(tmpdir(), `gravity-code-${Date.now()}.zip`);
  try {
    Code.exportarProyecto(p, zip);
    await enviarArchivo(res, zip, true, `${p}.zip`);
  } finally {
    await rm(zip, { force: true });
  }
  return undefined;
});
ruta("POST", "/api/computadora/restaurar", async ({ cuerpo }) => {
  const d = validar(z.object({ ruta: z.string().min(1).max(500), id: z.string().min(1).max(80) }), await cuerpo());
  malPedido(() => restaurarVersion(d.ruta, d.id));
  emitir("computadora");
  return { ok: true };
});

// ---- Copia de seguridad (ver respaldo.ts) ----

ruta("GET", "/api/respaldo", async ({ res }) => {
  const zip = path.join(tmpdir(), `gravity-respaldo-${Date.now()}.zip`);
  try {
    exportarRespaldo(zip);
  } catch (err) {
    rmSync(zip, { force: true });
    throw new ErrorHttp(500, (err as Error).message);
  }
  const dia = new Date().toISOString().slice(0, 10);
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Length": String(statArchivo(zip).size),
    "Content-Disposition": `attachment; filename="gravity-respaldo-${dia}.zip"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const flujo = createReadStream(zip);
  flujo.pipe(res);
  flujo.on("close", () => rmSync(zip, { force: true }));
  return undefined;
});

const MAX_RESPALDO = 2.2 * 1024 * 1024 * 1024;

ruta("POST", "/api/respaldo/importar", async ({ req }) => {
  const zip = path.join(tmpdir(), `gravity-importar-${Date.now()}.zip`);
  await new Promise<void>((resolve, reject) => {
    let total = 0;
    const salida = createWriteStream(zip);
    req.on("data", (trozo: Buffer) => {
      total += trozo.length;
      if (total > MAX_RESPALDO) {
        req.destroy();
        salida.destroy();
        reject(new ErrorHttp(413, "El respaldo es demasiado grande."));
      }
    });
    req.on("error", reject);
    salida.on("error", reject);
    salida.on("finish", () => resolve());
    req.pipe(salida);
  }).catch((err) => {
    rmSync(zip, { force: true });
    throw err;
  });
  const destino = rutaRespaldo("restaurado");
  let resumen;
  try {
    resumen = extraerRespaldo(zip, destino);
  } catch (err) {
    throw new ErrorHttp(400, (err as Error).message);
  } finally {
    rmSync(zip, { force: true });
  }
  // Se responde primero; después se frena todo, se cambia la carpeta y el motor se reinicia
  // (en el celular lo vuelve a prender la app; en la compu hay que abrir Gravity de nuevo).
  setTimeout(() => {
    detenerTodo();
    const anterior = aplicarRespaldo(destino);
    console.log(`Respaldo restaurado. Los datos anteriores quedaron en ${anterior}.`);
    process.exit(0);
  }, 800);
  return { ok: true, archivos: resumen.archivos, reinicia: true };
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
  if (req.method === "GET" && url.pathname.startsWith("/vista/")) return servirVista(req, res, url.pathname);
  // La app de Android comprueba que en el puerto está este motor (y no otra app) antes de mandar el token.
  if (req.method === "GET" && url.pathname === "/api/hola" && TOKEN_APP) {
    const reto = url.searchParams.get("reto") ?? "";
    if (!/^[0-9a-f]{16,128}$/.test(reto)) throw new ErrorHttp(400, "Reto inválido.");
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end(createHmac("sha256", TOKEN_APP).update(reto).digest("hex"));
    return;
  }
  // Webhooks entrantes: los llama un servicio de afuera, sin sesión. El token secreto de la URL autoriza
  // solo encargarle el trabajo configurado a un compañero, con los datos como contenido de afuera.
  if (req.method === "POST" && url.pathname.startsWith("/api/gancho/")) {
    const r = await recibirWebhook(url.pathname.slice("/api/gancho/".length), await leerCuerpo(req));
    if (r === "no") throw new ErrorHttp(404, "No encontrado.");
    if (r === "tope") throw new ErrorHttp(429, "Demasiadas llamadas: probá en un rato.");
    responder(res, 202, { ok: true });
    return;
  }
  if (!tokenAppValido(req)) throw new ErrorHttp(401, "Acceso no autorizado.");

  // Fuera de esta computadora hace falta clave y sesión.
  if (!local) {
    if (!hayClave()) {
      if (url.pathname.startsWith("/api/")) throw new ErrorHttp(403, "Falta configurar una clave en Ajustes.");
      res.writeHead(403, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP_PAGINA });
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
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP_PAGINA });
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
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP_PAGINA, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
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
iniciarTelegram();
iniciarAutomatizaciones();
iniciarTalento();
Canales.iniciarCanales();
Inv.iniciarMonitores(leerPagina);
void import("./cloud.ts").then((K) => K.iniciarMonitorServidores());

// Al apagar: se escribe todo lo pendiente antes de salir.
for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => {
    vaciarEscrituras();
    Canales.vaciarCanales();
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
