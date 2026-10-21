import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

// Fuera del repo a propósito: así un comando de git que corra un bot no toca este repositorio.
export const DATOS = path.resolve((process.env.BOTS_DATOS ?? "~/gravity").replace(/^~(?=$|\/)/, os.homedir()));
// La "computadora" que comparten todos los bots: una carpeta local.
export const COMPUTADORA = path.join(DATOS, "computadora");
const MEMORIA = path.join(DATOS, "memoria");
const CONVERSACIONES = path.join(DATOS, "conversaciones");
const REUNIONES = path.join(DATOS, "reuniones");
const ESTADO = path.join(DATOS, "estado.json");
const TAREAS = path.join(DATOS, "tareas.json");

export const MAX_BOTS = 50;
export const MAX_RUTINAS_POR_BOT = 50;
export const MAX_EJECUCIONES = 20;
export const MAX_PROFUNDIDAD = 3;

export type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max";
export type Cargo = "manager" | "miembro";

export interface Bot {
  id: string;
  nombre: string;
  titulo: string;
  descripcion: string;
  color: string;
  creado: string;
  ultimaActividad: string | null;
  leido: string | null;
  cargo: Cargo;
  // Manager al que reporta; null = le reporta al usuario.
  reportaA: string | null;
  // Permiso para mandar mensajes afuera (WhatsApp, email…), cuando haya conexiones.
  puedeEnviarAfuera: boolean;
  // Esfuerzo propio; null = el de BOTS_ESFUERZO.
  esfuerzo: Esfuerzo | null;
  // Solo managers: carpeta del equipo en la computadora, relativa a ella y terminada en "/".
  carpetaEquipo: string | null;
}

export type Horario =
  | { tipo: "intervalo"; minutos: number }
  | { tipo: "diaria"; hora: string }
  | { tipo: "semanal"; dia: number; hora: string };

export interface Ejecucion {
  inicio: string;
  fin: string | null;
  estado: "en_curso" | "ok" | "error" | "salteada";
  resumen: string;
  reunionId?: string;
}

export interface PlantillaReunion {
  tipo: TipoReunion;
  // null = el equipo directo del facilitador.
  participantes: string[] | null;
  confirmarAcciones: boolean;
}

export interface Rutina {
  id: string;
  botId: string;
  nombre: string;
  instrucciones: string;
  habilidadId: string | null;
  horario: Horario;
  activa: boolean;
  creada: string;
  ultimaEjecucion: string | null;
  ejecuciones: Ejecucion[];
  // Si no es null, la rutina convoca una reunión (botId facilita, instrucciones es la agenda).
  reunion: PlantillaReunion | null;
}

export interface Habilidad {
  id: string;
  nombre: string;
  descripcion: string;
  instrucciones: string;
  creada: string;
}

export type Alcance = { tipo: "global" } | { tipo: "bot"; botId: string } | { tipo: "equipo"; managerId: string };

// Regla "siempre permitir". bash: el programa (ej. "ls"); editor: "*" o una carpeta terminada en "/";
// el resto: "*".
export interface Regla {
  id: string;
  herramienta: "bash" | "editor" | "rutinas" | "reunion";
  patron: string;
  alcance: Alcance;
  creada: string;
}

export interface Ajustes {
  maxLlamadas: number;
  maxComandos: number;
  topeDiarioUsd: number;
  pausa: boolean;
  // Dólares extra permitidos para un día puntual ("Seguir hoy hasta…").
  extra: { dia: string; usd: number } | null;
  claveHash: string | null;
}

export interface Nota {
  // Cantidad de mensajes que había cuando se agregó la nota: se muestra después de ellos.
  despuesDe: number;
  tipo: "error" | "aviso";
  texto: string;
  fecha: string;
}

// Por qué existe cada mensaje del usuario que no escribió el usuario: la interfaz arma los chips con esto
// y nunca leyendo el texto.
export interface Origen {
  indice: number;
  tipo: "rutina" | "tarea" | "resultados" | "reunion";
  etiqueta: string;
  detalle: string;
  fecha: string;
}

export interface Conversacion {
  mensajes: Anthropic.Beta.BetaMessageParam[];
  // Prompt del sistema congelado en el primer pedido: no puede cambiar sin invalidar el historial.
  sistema: string | null;
  // Huellas de lo que el bot ya sabe (perfil, equipo, habilidades) para avisarle solo lo que cambió.
  vistos: Record<string, string>;
  notas: Nota[];
  origenes: Origen[];
}

export type EstadoTarea =
  | "pendiente"
  | "en_curso"
  | "esperando_equipo"
  | "completa"
  | "parcial"
  | "bloqueada"
  | "fallida"
  | "cancelada"
  | "vencida";

export const TERMINALES: EstadoTarea[] = ["completa", "parcial", "bloqueada", "fallida", "cancelada", "vencida"];

export interface Tarea {
  id: string;
  loteId: string;
  trabajo: string;
  deId: string;
  paraId: string;
  paraNombre: string;
  titulo: string;
  instrucciones: string;
  entregable: string;
  estado: EstadoTarea;
  resultado: string;
  archivos: string[];
  carpeta: string;
  creada: string;
  inicio: string | null;
  fin: string | null;
  venceEn: string;
  intentos: number;
  reintentarDesde: string | null;
  presupuestoUsd: number;
  gastoUsd: number;
  // Tarea del manager dentro de la cual se delegó esta (subequipos); null si vino del chat del manager.
  padreId: string | null;
  reunionId: string | null;
  avisada: boolean;
}

export type TipoReunion = "standup" | "discusion";

export interface Turno {
  autor: string; // id de bot, "usuario" o "sistema"
  nombre: string;
  texto: string;
  fecha: string;
  ronda: number;
  paso?: boolean;
}

export interface Acta {
  resumen: string;
  decisiones: string[];
  acciones: { para: string; titulo: string; instrucciones: string; entregable: string }[];
  para_el_usuario: string[];
}

export interface Reunion {
  id: string;
  titulo: string;
  tipo: TipoReunion;
  agenda: string;
  facilitadorId: string;
  participantes: string[];
  estado: "en_curso" | "cierre" | "terminada" | "cancelada";
  ronda: number;
  hablando: string[];
  turnos: Turno[];
  acta: Acta | null;
  confirmarAcciones: boolean;
  accionesPropuestas: boolean;
  gastoUsd: number;
  creada: string;
  fin: string | null;
  rutinaId: string | null;
  error: string | null;
}

interface Estado {
  bots: Bot[];
  rutinas: Rutina[];
  habilidades: Habilidad[];
  reglas: Regla[];
  ajustes: Ajustes;
  reuniones: string[];
  // Mensajes del usuario que esperaban en cola: sobreviven a un reinicio.
  colaUsuario: { botId: string; texto: string }[];
}

for (const dir of [DATOS, COMPUTADORA, MEMORIA, CONVERSACIONES, REUNIONES]) mkdirSync(dir, { recursive: true });

export const nuevoId = (): string => randomUUID().slice(0, 8);
export const ahora = (): string => new Date().toISOString();

function leerJson<T>(archivo: string, porDefecto: T): T {
  try {
    return JSON.parse(readFileSync(archivo, "utf8")) as T;
  } catch {
    return porDefecto;
  }
}

// Escritura atómica: si el proceso se corta a mitad, el archivo anterior queda intacto.
function escribirJsonYa(archivo: string, datos: unknown): void {
  const temporal = `${archivo}.${process.pid}.tmp`;
  writeFileSync(temporal, JSON.stringify(datos));
  renameSync(temporal, archivo);
}

// Escritura diferida: junta los cambios de 250 ms y escribe una sola vez, sin trabar el servidor.
const pendientesEscritura = new Map<string, { datos: () => unknown; timer: NodeJS.Timeout }>();

function programarEscritura(archivo: string, datos: () => unknown): void {
  const previo = pendientesEscritura.get(archivo);
  if (previo) clearTimeout(previo.timer);
  const timer = setTimeout(() => {
    pendientesEscritura.delete(archivo);
    const temporal = `${archivo}.${process.pid}.tmp`;
    writeFile(temporal, JSON.stringify(datos()))
      .then(() => rename(temporal, archivo))
      .catch((err) => console.error(`No se pudo guardar ${archivo}:`, err));
  }, 250);
  pendientesEscritura.set(archivo, { datos, timer });
}

// Escribe ya todo lo pendiente (al apagar el servidor).
export function vaciarEscrituras(): void {
  for (const [archivo, p] of pendientesEscritura) {
    clearTimeout(p.timer);
    escribirJsonYa(archivo, p.datos());
  }
  pendientesEscritura.clear();
}

const AJUSTES_INICIALES: Ajustes = {
  maxLlamadas: Number(process.env.BOTS_MAX_LLAMADAS ?? 10),
  maxComandos: Number(process.env.BOTS_MAX_COMANDOS ?? 6),
  topeDiarioUsd: Number(process.env.BOTS_TOPE_DIARIO_USD ?? 20),
  pausa: false,
  extra: null,
  claveHash: null,
};

const estado: Estado = leerJson(ESTADO, {} as Estado);
estado.bots ??= [];
estado.rutinas ??= [];
estado.habilidades ??= [];
estado.reglas ??= [];
estado.reuniones ??= [];
estado.colaUsuario ??= [];
estado.ajustes = { ...AJUSTES_INICIALES, ...estado.ajustes };

// Migración de datos de versiones anteriores.
for (const b of estado.bots) {
  b.cargo ??= "miembro";
  b.reportaA ??= null;
  b.puedeEnviarAfuera ??= b.cargo === "manager";
  b.esfuerzo ??= null;
  b.carpetaEquipo ??= null;
}
for (const r of estado.reglas) r.alcance ??= { tipo: "global" };
for (const r of estado.rutinas) {
  r.reunion ??= null;
  // Una ejecución que estaba en curso cuando se apagó el servidor ya no va a terminar.
  for (const e of r.ejecuciones) {
    if (e.estado === "en_curso") Object.assign(e, { estado: "error", fin: e.inicio, resumen: "Se interrumpió al reiniciar el servidor." });
  }
}

export function guardarEstado(): void {
  programarEscritura(ESTADO, () => estado);
}

// ---- Ajustes ----

export const ajustes = (): Ajustes => estado.ajustes;

export function cambiarAjustes(cambios: Partial<Ajustes>): Ajustes {
  Object.assign(estado.ajustes, cambios);
  guardarEstado();
  return estado.ajustes;
}

// ---- Bots ----

const COLORES = ["#63D3B1", "#9DA9FF", "#C9A9FF", "#F0A6CA", "#7DD9F2", "#B5E48C", "#FFD166", "#A0C4FF"];

export const listarBots = (): Bot[] => estado.bots;
export const buscarBot = (id: string): Bot | undefined => estado.bots.find((b) => b.id === id);

export type DatosBot = Pick<Bot, "nombre" | "titulo" | "descripcion"> & Partial<Pick<Bot, "cargo" | "reportaA" | "puedeEnviarAfuera" | "esfuerzo" | "color">>;

export function crearBot(datos: DatosBot, guardar = true): Bot {
  const cargo = datos.cargo ?? "miembro";
  const id = nuevoId();
  const bot: Bot = {
    id,
    nombre: datos.nombre,
    titulo: datos.titulo,
    descripcion: datos.descripcion,
    color: datos.color ?? COLORES[estado.bots.length % COLORES.length]!,
    creado: ahora(),
    ultimaActividad: null,
    leido: null,
    cargo,
    reportaA: datos.reportaA ?? null,
    puedeEnviarAfuera: datos.puedeEnviarAfuera ?? cargo === "manager",
    esfuerzo: datos.esfuerzo ?? null,
    carpetaEquipo: cargo === "manager" ? carpetaDeEquipo(datos.nombre, id) : null,
  };
  estado.bots.push(bot);
  if (guardar) guardarEstado();
  return bot;
}

export function carpetaDeEquipo(nombre: string, id: string): string {
  const slug = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `equipos/${slug || "equipo"}-${id.slice(0, 4)}/`;
}

export function borrarBot(id: string): void {
  const bot = buscarBot(id);
  // Su equipo pasa a reportarle a quien le reportaba él.
  for (const b of estado.bots) if (b.reportaA === id) b.reportaA = bot?.reportaA ?? null;
  estado.bots = estado.bots.filter((b) => b.id !== id);
  estado.rutinas = estado.rutinas.filter((r) => r.botId !== id);
  estado.reglas = estado.reglas.filter((r) => !(r.alcance.tipo === "bot" && r.alcance.botId === id) && !(r.alcance.tipo === "equipo" && r.alcance.managerId === id));
  estado.colaUsuario = estado.colaUsuario.filter((c) => c.botId !== id);
  guardarEstado();
  conversaciones.delete(id);
  for (const ext of [".jsonl", ".meta.json", ".json"]) rmSync(path.join(CONVERSACIONES, `${id}${ext}`), { force: true });
  rmSync(carpetaMemoria(id), { recursive: true, force: true });
}

// Cadena de managers hacia arriba (sin incluir al bot).
export function jefes(botId: string): Bot[] {
  const cadena: Bot[] = [];
  let actual = buscarBot(botId);
  while (actual?.reportaA) {
    const jefe = buscarBot(actual.reportaA);
    if (!jefe || cadena.includes(jefe)) break;
    cadena.push(jefe);
    actual = jefe;
  }
  return cadena;
}

export const directos = (managerId: string): Bot[] => estado.bots.filter((b) => b.reportaA === managerId);

// Todos los que están debajo de un manager, en cualquier nivel.
export function subarbol(managerId: string): Bot[] {
  const salida: Bot[] = [];
  const pendientes = [managerId];
  while (pendientes.length) {
    const id = pendientes.shift()!;
    for (const b of directos(id)) {
      if (salida.includes(b)) continue;
      salida.push(b);
      pendientes.push(b.id);
    }
  }
  return salida;
}

// Valida que un bot pueda reportarle a `reportaA` sin ciclos ni demasiados niveles. Devuelve el error o null.
export function validarJefe(botId: string | null, reportaA: string | null): string | null {
  if (!reportaA) return null;
  const jefe = buscarBot(reportaA);
  if (!jefe) return "No existe ese manager.";
  if (jefe.cargo !== "manager") return `${jefe.nombre} no es manager.`;
  if (botId && (reportaA === botId || jefes(reportaA).some((b) => b.id === botId))) return "Eso armaría un ciclo en el organigrama.";
  const profundidadJefe = jefes(reportaA).length + 1;
  const alturaPropia = botId ? alturaDe(botId) : 0;
  if (profundidadJefe + 1 + alturaPropia > MAX_PROFUNDIDAD) return `El organigrama admite hasta ${MAX_PROFUNDIDAD} niveles.`;
  return null;
}

function alturaDe(botId: string): number {
  const hijos = directos(botId);
  return hijos.length ? 1 + Math.max(...hijos.map((h) => alturaDe(h.id))) : 0;
}

// ---- Conversaciones: mensajes en JSONL (solo se agrega) + un archivo meta ----

const conversaciones = new Map<string, Conversacion>();
const MAX_EN_MEMORIA = 12;
const archivoMensajes = (botId: string) => path.join(CONVERSACIONES, `${botId}.jsonl`);
const archivoMeta = (botId: string) => path.join(CONVERSACIONES, `${botId}.meta.json`);

function cargarConversacion(botId: string): Conversacion {
  const viejo = path.join(CONVERSACIONES, `${botId}.json`);
  if (!existsSync(archivoMensajes(botId)) && existsSync(viejo)) {
    // Formato anterior: un JSON con todo. Se pasa a JSONL una sola vez.
    const anterior = leerJson<{ mensajes: Anthropic.Beta.BetaMessageParam[]; notas?: Nota[] }>(viejo, { mensajes: [] });
    writeFileSync(archivoMensajes(botId), anterior.mensajes.map((m) => JSON.stringify(m) + "\n").join(""));
    escribirJsonYa(archivoMeta(botId), { sistema: null, vistos: {}, notas: anterior.notas ?? [], origenes: [] });
    renameSync(viejo, `${viejo}.migrado`);
  }
  const mensajes: Anthropic.Beta.BetaMessageParam[] = [];
  let lineas: string[] = [];
  try {
    lineas = readFileSync(archivoMensajes(botId), "utf8").split("\n").filter(Boolean);
  } catch {
    // Conversación nueva.
  }
  for (const [i, linea] of lineas.entries()) {
    try {
      mensajes.push(JSON.parse(linea));
    } catch {
      // Una última línea cortada por un apagón se descarta: equivale a que el corte fue un instante antes.
      if (i === lineas.length - 1) writeFileSync(archivoMensajes(botId), lineas.slice(0, -1).map((l) => l + "\n").join(""));
      else throw new Error(`Conversación ${botId} dañada en la línea ${i + 1}.`);
    }
  }
  const meta = leerJson(archivoMeta(botId), { sistema: null, vistos: {}, notas: [], origenes: [] });
  return { mensajes, sistema: meta.sistema, vistos: meta.vistos ?? {}, notas: meta.notas ?? [], origenes: meta.origenes ?? [] };
}

export function conversacion(botId: string): Conversacion {
  let c = conversaciones.get(botId);
  if (c) {
    // Al final del Map = usada hace poco.
    conversaciones.delete(botId);
  } else {
    c = cargarConversacion(botId);
  }
  conversaciones.set(botId, c);
  return c;
}

// Saca de memoria las conversaciones que no se usan; `ocupados` son los bots trabajando ahora.
export function liberarConversaciones(ocupados: Set<string>): void {
  for (const id of conversaciones.keys()) {
    if (conversaciones.size <= MAX_EN_MEMORIA) return;
    if (!ocupados.has(id)) conversaciones.delete(id);
  }
}

export function agregarMensajes(botId: string, ...mensajes: Anthropic.Beta.BetaMessageParam[]): void {
  const c = conversacion(botId);
  c.mensajes.push(...mensajes);
  if (buscarBot(botId)) appendFileSync(archivoMensajes(botId), mensajes.map((m) => JSON.stringify(m) + "\n").join(""));
}

// Un mensaje de sistema solo puede ir al final o seguido de una respuesta del modelo. Si un turno falló justo
// después de agregarlo, nunca tuvo respuesta: se quita (no cambia nada de lo que el modelo ya razonó).
export function quitarSistemaFinal(botId: string): void {
  const c = conversacion(botId);
  let quitados = 0;
  while (c.mensajes.at(-1)?.role === "system") {
    c.mensajes.pop();
    quitados++;
  }
  if (quitados && buscarBot(botId)) writeFileSync(archivoMensajes(botId), c.mensajes.map((m) => JSON.stringify(m) + "\n").join(""));
}

export function guardarMeta(botId: string): void {
  const c = conversaciones.get(botId);
  if (!c || !buscarBot(botId)) return;
  programarEscritura(archivoMeta(botId), () => ({ sistema: c.sistema, vistos: c.vistos, notas: c.notas, origenes: c.origenes }));
}

export function agregarNota(botId: string, tipo: Nota["tipo"], texto: string): void {
  const c = conversacion(botId);
  c.notas.push({ despuesDe: c.mensajes.length, tipo, texto, fecha: ahora() });
  guardarMeta(botId);
}

// ---- Memoria ----

export const carpetaMemoria = (botId: string): string => path.join(MEMORIA, botId);
// La herramienta de memoria del SDK guarda en `<carpeta>/memories`, que el modelo ve como /memories.
export const raizMemoria = (botId: string): string => path.join(carpetaMemoria(botId), "memories");

// ---- Rutinas ----

export const listarRutinas = (botId?: string): Rutina[] =>
  botId ? estado.rutinas.filter((r) => r.botId === botId) : estado.rutinas;
export const buscarRutina = (id: string): Rutina | undefined => estado.rutinas.find((r) => r.id === id);

export function crearRutina(
  datos: Pick<Rutina, "botId" | "nombre" | "instrucciones" | "habilidadId" | "horario" | "activa"> & { reunion?: PlantillaReunion | null },
): Rutina {
  if (listarRutinas(datos.botId).length >= MAX_RUTINAS_POR_BOT) {
    throw new Error(`Un bot puede tener hasta ${MAX_RUTINAS_POR_BOT} rutinas.`);
  }
  const rutina: Rutina = { id: nuevoId(), ...datos, reunion: datos.reunion ?? null, creada: ahora(), ultimaEjecucion: null, ejecuciones: [] };
  estado.rutinas.push(rutina);
  guardarEstado();
  return rutina;
}

export function borrarRutina(id: string): void {
  estado.rutinas = estado.rutinas.filter((r) => r.id !== id);
  guardarEstado();
}

export function registrarEjecucion(rutina: Rutina, ejecucion: Ejecucion): void {
  rutina.ejecuciones.unshift(ejecucion);
  rutina.ejecuciones.length = Math.min(rutina.ejecuciones.length, MAX_EJECUCIONES);
  guardarEstado();
}

// ---- Habilidades ----

export const listarHabilidades = (): Habilidad[] => estado.habilidades;
export const buscarHabilidad = (id: string): Habilidad | undefined => estado.habilidades.find((h) => h.id === id);

export function guardarHabilidad(datos: Pick<Habilidad, "nombre" | "descripcion" | "instrucciones">, id?: string): Habilidad {
  const existente = id ? buscarHabilidad(id) : estado.habilidades.find((h) => h.nombre === datos.nombre);
  if (existente) {
    Object.assign(existente, datos);
    guardarEstado();
    return existente;
  }
  const habilidad: Habilidad = { id: nuevoId(), ...datos, creada: ahora() };
  estado.habilidades.push(habilidad);
  guardarEstado();
  return habilidad;
}

export function borrarHabilidad(id: string): void {
  estado.habilidades = estado.habilidades.filter((h) => h.id !== id);
  for (const r of estado.rutinas) if (r.habilidadId === id) r.habilidadId = null;
  guardarEstado();
}

// ---- Reglas de aprobación ----

export const listarReglas = (): Regla[] => estado.reglas;

export function agregarRegla(herramienta: Regla["herramienta"], patron: string, alcance: Alcance = { tipo: "global" }): void {
  const igual = (a: Alcance, b: Alcance) => JSON.stringify(a) === JSON.stringify(b);
  if (estado.reglas.some((r) => r.herramienta === herramienta && r.patron === patron && igual(r.alcance, alcance))) return;
  estado.reglas.push({ id: nuevoId(), herramienta, patron, alcance, creada: ahora() });
  guardarEstado();
}

export function borrarRegla(id: string): void {
  estado.reglas = estado.reglas.filter((r) => r.id !== id);
  guardarEstado();
}

// ---- Cola de mensajes del usuario (persistida) ----

export const colaUsuario = () => estado.colaUsuario;
export function guardarColaUsuario(cola: { botId: string; texto: string }[]): void {
  estado.colaUsuario = cola;
  guardarEstado();
}

// ---- Tareas ----

const tareas: Tarea[] = leerJson(TAREAS, []);

export const listarTareas = (): Tarea[] => tareas;
export const buscarTarea = (id: string): Tarea | undefined => tareas.find((t) => t.id === id);

export function agregarTarea(t: Tarea): void {
  tareas.push(t);
  guardarTareas();
}

export function guardarTareas(): void {
  // Las tareas terminadas de hace más de 30 días se descartan.
  const limite = Date.now() - 30 * 86_400_000;
  for (let i = tareas.length - 1; i >= 0; i--) {
    const t = tareas[i]!;
    if (TERMINALES.includes(t.estado) && t.avisada && Date.parse(t.fin ?? t.creada) < limite) tareas.splice(i, 1);
  }
  programarEscritura(TAREAS, () => tareas);
}

// ---- Reuniones ----

const reuniones = new Map<string, Reunion>();
const archivoReunion = (id: string) => path.join(REUNIONES, `${id}.json`);

export function buscarReunion(id: string): Reunion | undefined {
  let r = reuniones.get(id);
  if (!r && estado.reuniones.includes(id)) {
    r = leerJson<Reunion | undefined>(archivoReunion(id), undefined);
    if (r) reuniones.set(id, r);
  }
  return r;
}

export const listarReuniones = (): Reunion[] =>
  estado.reuniones.map((id) => buscarReunion(id)).filter((r): r is Reunion => !!r);

export function agregarReunion(r: Reunion): void {
  reuniones.set(r.id, r);
  estado.reuniones.unshift(r.id);
  for (const viejo of estado.reuniones.splice(200)) {
    reuniones.delete(viejo);
    rmSync(archivoReunion(viejo), { force: true });
  }
  guardarEstado();
  guardarReunion(r);
}

export function guardarReunion(r: Reunion): void {
  programarEscritura(archivoReunion(r.id), () => r);
}
