import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CARPETA_DATOS, type Importancia } from "./config.ts";

export type Canal = "email" | "whatsapp" | "telegram" | "recordatorio" | "jarvis";

export interface Mensaje {
  rol: "user" | "assistant";
  texto: string;
  fecha: string;
}

export interface Dato {
  id: string;
  texto: string;
  fecha: string;
}

export interface Recordatorio {
  id: string;
  texto: string;
  cuando: string;
  avisado: boolean;
}

export interface Aviso {
  id: string;
  canal: Canal;
  de: string;
  titulo: string;
  resumen: string;
  // Lo que Jarvis te dice en voz alta.
  texto: string;
  importancia: Importancia;
  fecha: string;
  propuestaId?: string;
  // Para poder responder: a quién y en qué hilo.
  origen?:
    | { canal: "email"; cuenta: string; responderA: string; asunto: string; messageId: string; references: string[] }
    | { canal: "whatsapp"; jid: string };
}

export interface Propuesta {
  id: string;
  canal: "email" | "whatsapp";
  // Email o JID de WhatsApp.
  para: string;
  paraNombre: string;
  cuenta?: string;
  asunto?: string;
  texto: string;
  motivo: string;
  enRespuestaA?: { messageId: string; references: string[] };
  estado: "pendiente" | "enviada" | "descartada" | "error";
  error?: string;
  fecha: string;
}

interface Datos {
  activa: boolean;
  historial: Mensaje[];
  memoria: Dato[];
  recordatorios: Recordatorio[];
  avisos: Aviso[];
  propuestas: Propuesta[];
  ultimoResumen: string;
}

const MAX_HISTORIAL = 200;
const MAX_AVISOS = 200;
const MAX_PROPUESTAS = 100;
const ARCHIVO = path.join(CARPETA_DATOS, "jarvis.json");

mkdirSync(CARPETA_DATOS, { recursive: true });

function cargar(): Datos {
  const vacio: Datos = {
    activa: true,
    historial: [],
    memoria: [],
    recordatorios: [],
    avisos: [],
    propuestas: [],
    ultimoResumen: "",
  };
  try {
    return { ...vacio, ...JSON.parse(readFileSync(ARCHIVO, "utf8")) };
  } catch {
    return vacio;
  }
}

export const datos = cargar();

let pendiente: NodeJS.Timeout | undefined;

// Agrupa escrituras seguidas en una sola y escribe de forma atómica.
export function guardar(): void {
  clearTimeout(pendiente);
  pendiente = setTimeout(() => {
    datos.historial = datos.historial.slice(-MAX_HISTORIAL);
    datos.avisos = datos.avisos.slice(-MAX_AVISOS);
    datos.propuestas = datos.propuestas.slice(-MAX_PROPUESTAS);
    const temporal = `${ARCHIVO}.tmp`;
    writeFileSync(temporal, JSON.stringify(datos, null, 2));
    renameSync(temporal, ARCHIVO);
  }, 300);
}

export function nuevoId(): string {
  return randomUUID().slice(0, 8);
}

export function ahora(): string {
  return new Date().toISOString();
}
