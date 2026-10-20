import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
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
const ESTADO = path.join(DATOS, "estado.json");

export const MAX_BOTS = 50;
export const MAX_RUTINAS_POR_BOT = 50;
export const MAX_EJECUCIONES = 20;

export interface Bot {
  id: string;
  nombre: string;
  titulo: string;
  descripcion: string;
  color: string;
  creado: string;
  ultimaActividad: string | null;
  leido: string | null;
}

export type Horario =
  | { tipo: "intervalo"; minutos: number }
  | { tipo: "diaria"; hora: string }
  | { tipo: "semanal"; dia: number; hora: string };

export interface Ejecucion {
  inicio: string;
  fin: string | null;
  estado: "en_curso" | "ok" | "error";
  resumen: string;
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
}

export interface Habilidad {
  id: string;
  nombre: string;
  descripcion: string;
  instrucciones: string;
  creada: string;
}

// Regla "siempre permitir": para bash, `patron` es el programa (ej. "ls"); para el resto, "*".
export interface Regla {
  id: string;
  herramienta: "bash" | "editor" | "rutinas";
  patron: string;
  creada: string;
}

export interface Nota {
  // Cantidad de mensajes que había cuando se agregó la nota: se muestra después de ellos.
  despuesDe: number;
  tipo: "error" | "aviso";
  texto: string;
  fecha: string;
}

export interface Conversacion {
  mensajes: Anthropic.Beta.BetaMessageParam[];
  notas: Nota[];
}

interface Estado {
  bots: Bot[];
  rutinas: Rutina[];
  habilidades: Habilidad[];
  reglas: Regla[];
}

for (const dir of [DATOS, COMPUTADORA, MEMORIA, CONVERSACIONES]) mkdirSync(dir, { recursive: true });

// Escritura atómica: si el proceso se corta a mitad, el archivo anterior queda intacto.
function escribirJson(archivo: string, datos: unknown): void {
  const temporal = `${archivo}.${process.pid}.tmp`;
  writeFileSync(temporal, JSON.stringify(datos));
  renameSync(temporal, archivo);
}

function leerJson<T>(archivo: string, porDefecto: T): T {
  try {
    return JSON.parse(readFileSync(archivo, "utf8")) as T;
  } catch {
    return porDefecto;
  }
}

const estado: Estado = leerJson(ESTADO, { bots: [], rutinas: [], habilidades: [], reglas: [] });

// Una ejecución que estaba en curso cuando se apagó el servidor ya no va a terminar.
for (const r of estado.rutinas) {
  for (const e of r.ejecuciones) {
    if (e.estado === "en_curso") Object.assign(e, { estado: "error", fin: e.inicio, resumen: "Se interrumpió al reiniciar el servidor." });
  }
}

export function guardarEstado(): void {
  escribirJson(ESTADO, estado);
}

export const nuevoId = (): string => randomUUID().slice(0, 8);
export const ahora = (): string => new Date().toISOString();

// ---- Bots ----

const COLORES = ["#e8590c", "#2b8a3e", "#1971c2", "#9c36b5", "#c2255c", "#0c8599", "#5f3dc4", "#e67700"];

export const listarBots = (): Bot[] => estado.bots;
export const buscarBot = (id: string): Bot | undefined => estado.bots.find((b) => b.id === id);

export function crearBot(datos: Pick<Bot, "nombre" | "titulo" | "descripcion">): Bot {
  const bot: Bot = {
    id: nuevoId(),
    ...datos,
    color: COLORES[estado.bots.length % COLORES.length]!,
    creado: ahora(),
    ultimaActividad: null,
    leido: null,
  };
  estado.bots.push(bot);
  guardarEstado();
  return bot;
}

export function borrarBot(id: string): void {
  estado.bots = estado.bots.filter((b) => b.id !== id);
  estado.rutinas = estado.rutinas.filter((r) => r.botId !== id);
  guardarEstado();
  rmSync(path.join(CONVERSACIONES, `${id}.json`), { force: true });
  rmSync(carpetaMemoria(id), { recursive: true, force: true });
}

// ---- Conversaciones ----

const conversaciones = new Map<string, Conversacion>();

export function conversacion(botId: string): Conversacion {
  let c = conversaciones.get(botId);
  if (!c) {
    c = leerJson<Conversacion>(path.join(CONVERSACIONES, `${botId}.json`), { mensajes: [], notas: [] });
    conversaciones.set(botId, c);
  }
  return c;
}

export function guardarConversacion(botId: string): void {
  const c = conversaciones.get(botId);
  if (c && buscarBot(botId)) escribirJson(path.join(CONVERSACIONES, `${botId}.json`), c);
}

export function agregarNota(botId: string, tipo: Nota["tipo"], texto: string): void {
  const c = conversacion(botId);
  c.notas.push({ despuesDe: c.mensajes.length, tipo, texto, fecha: ahora() });
  guardarConversacion(botId);
}

// ---- Memoria ----

export const carpetaMemoria = (botId: string): string => path.join(MEMORIA, botId);
// La herramienta de memoria del SDK guarda en `<carpeta>/memories`, que el modelo ve como /memories.
export const raizMemoria = (botId: string): string => path.join(carpetaMemoria(botId), "memories");

// ---- Rutinas ----

export const listarRutinas = (botId?: string): Rutina[] =>
  botId ? estado.rutinas.filter((r) => r.botId === botId) : estado.rutinas;
export const buscarRutina = (id: string): Rutina | undefined => estado.rutinas.find((r) => r.id === id);

export function crearRutina(datos: Pick<Rutina, "botId" | "nombre" | "instrucciones" | "habilidadId" | "horario" | "activa">): Rutina {
  if (listarRutinas(datos.botId).length >= MAX_RUTINAS_POR_BOT) {
    throw new Error(`Un bot puede tener hasta ${MAX_RUTINAS_POR_BOT} rutinas.`);
  }
  const rutina: Rutina = { id: nuevoId(), ...datos, creada: ahora(), ultimaEjecucion: null, ejecuciones: [] };
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

export function agregarRegla(herramienta: Regla["herramienta"], patron: string): void {
  if (estado.reglas.some((r) => r.herramienta === herramienta && r.patron === patron)) return;
  estado.reglas.push({ id: nuevoId(), herramienta, patron, creada: ahora() });
  guardarEstado();
}

export function borrarRegla(id: string): void {
  estado.reglas = estado.reglas.filter((r) => r.id !== id);
  guardarEstado();
}
