import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { betaAgentToolset20260401 } from "@anthropic-ai/sdk/tools/agent-toolset/node";
import { betaMemoryTool, BetaLocalFilesystemMemoryTool } from "@anthropic-ai/sdk/tools/memory/node";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import {
  COMPUTADORA,
  carpetaMemoria,
  listarReglas,
  listarRutinas,
  buscarRutina,
  crearRutina,
  borrarRutina,
  guardarEstado,
  listarHabilidades,
  buscarHabilidad,
  guardarHabilidad,
  type Regla,
} from "./almacen.ts";
import { normalizarHorario, describirHorario, proximaEjecucion } from "./rutinas.ts";
import { emitir } from "./eventos.ts";

// ---- Validación de entradas ----
// Las herramientas del SDK (bash, read, write…) no validan lo que reciben, y con eager_input_streaming
// el servidor tampoco: se valida acá antes de ejecutarlas.
const ENTRADAS: Record<string, z.ZodType> = {
  bash: z.object({ command: z.string().optional(), restart: z.boolean().optional(), timeout_ms: z.number().optional() }),
  read: z.object({ file_path: z.string(), view_range: z.array(z.number()).optional() }),
  write: z.object({ file_path: z.string(), content: z.string() }),
  edit: z.object({ file_path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() }),
  glob: z.object({ pattern: z.string(), path: z.string().optional() }),
  grep: z.object({ pattern: z.string(), path: z.string().optional() }),
};

export function entradaValida(nombre: string, entrada: unknown): boolean {
  const esquema = ENTRADAS[nombre];
  return !esquema || esquema.safeParse(entrada).success;
}

// ---- Rutinas y habilidades (herramientas propias) ----

const EntradaRutinas = z.strictObject({
  accion: z.enum(["listar", "crear", "modificar", "borrar"]),
  id: z.string().nullable().describe("Id de la rutina, para modificar o borrar"),
  nombre: z.string().nullable(),
  instrucciones: z.string().nullable().describe("Qué tenés que hacer en cada ejecución, escrito para vos mismo"),
  habilidad_id: z.string().nullable().describe("Habilidad a seguir en cada ejecución, si corresponde"),
  horario: z
    .strictObject({
      tipo: z.enum(["intervalo", "diaria", "semanal"]),
      minutos: z.number().nullable().describe("Solo intervalo: cada cuántos minutos (mínimo 5)"),
      hora: z.string().nullable().describe('Solo diaria y semanal: "HH:MM" en hora local'),
      dia: z.number().nullable().describe("Solo semanal: 0 = domingo … 6 = sábado"),
    })
    .nullable(),
  activa: z.boolean().nullable(),
});

const EntradaHabilidades = z.strictObject({
  accion: z.enum(["listar", "leer", "guardar"]),
  id: z.string().nullable().describe("Id de la habilidad, para leer o actualizar"),
  nombre: z.string().nullable(),
  descripcion: z.string().nullable().describe("Una línea: para qué sirve y cuándo usarla"),
  instrucciones: z.string().nullable().describe("El procedimiento paso a paso"),
});

// Esquema JSON en línea (sin $ref), para el modo estricto.
function esquemaJson(esquema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const { $schema: _, ...resto } = z.toJSONSchema(esquema, { reused: "inline" });
  return resto as Anthropic.Beta.BetaTool.InputSchema;
}

function herramientaRutinas(botId: string): BetaRunnableTool {
  const herramienta = betaZodTool({
    name: "rutinas",
    description:
      "Lista, crea, modifica o borra tus rutinas: trabajo que se ejecuta solo según un horario. Crear, modificar y borrar requieren aprobación del usuario.",
    inputSchema: EntradaRutinas,
    run: (e) => {
      if (e.accion === "listar") {
        const rutinas = listarRutinas(botId);
        if (!rutinas.length) return "No tenés rutinas.";
        return JSON.stringify(
          rutinas.map((r) => ({
            id: r.id,
            nombre: r.nombre,
            horario: describirHorario(r.horario),
            activa: r.activa,
            proxima: r.activa ? proximaEjecucion(r).toLocaleString("es") : null,
            instrucciones: r.instrucciones,
            habilidad_id: r.habilidadId,
          })),
        );
      }
      if (e.accion === "crear") {
        if (!e.nombre || !e.instrucciones || !e.horario) throw new Error("Para crear hacen falta nombre, instrucciones y horario.");
        if (e.habilidad_id && !buscarHabilidad(e.habilidad_id)) throw new Error("No existe esa habilidad.");
        const r = crearRutina({
          botId,
          nombre: e.nombre,
          instrucciones: e.instrucciones,
          habilidadId: e.habilidad_id,
          horario: normalizarHorario(e.horario),
          activa: e.activa ?? true,
        });
        emitir("rutinas", { botId });
        return `Rutina creada (id ${r.id}): ${describirHorario(r.horario)}. Próxima ejecución: ${proximaEjecucion(r).toLocaleString("es")}.`;
      }
      const rutina = e.id ? buscarRutina(e.id) : undefined;
      if (!rutina || rutina.botId !== botId) throw new Error("No tenés una rutina con ese id.");
      if (e.accion === "borrar") {
        borrarRutina(rutina.id);
        emitir("rutinas", { botId });
        return "Rutina borrada.";
      }
      if (e.habilidad_id && !buscarHabilidad(e.habilidad_id)) throw new Error("No existe esa habilidad.");
      if (e.nombre) rutina.nombre = e.nombre;
      if (e.instrucciones) rutina.instrucciones = e.instrucciones;
      if (e.habilidad_id !== null) rutina.habilidadId = e.habilidad_id;
      if (e.horario) rutina.horario = normalizarHorario(e.horario);
      if (e.activa !== null) rutina.activa = e.activa;
      guardarEstado();
      emitir("rutinas", { botId });
      return `Rutina actualizada: ${describirHorario(rutina.horario)}, ${rutina.activa ? "activa" : "pausada"}.`;
    },
  });
  return Object.assign(herramienta, { input_schema: esquemaJson(EntradaRutinas) });
}

function herramientaHabilidades(): BetaRunnableTool {
  const herramienta = betaZodTool({
    name: "habilidades",
    description:
      "Habilidades: procedimientos guardados que cualquier compañero puede seguir. Listalas, leé una completa antes de usarla, o guardá una nueva cuando el usuario te enseñe cómo hacer algo que se va a repetir.",
    inputSchema: EntradaHabilidades,
    run: (e) => {
      if (e.accion === "listar") {
        const lista = listarHabilidades();
        if (!lista.length) return "Todavía no hay habilidades guardadas.";
        return JSON.stringify(lista.map(({ id, nombre, descripcion }) => ({ id, nombre, descripcion })));
      }
      if (e.accion === "leer") {
        const h = e.id ? buscarHabilidad(e.id) : listarHabilidades().find((x) => x.nombre === e.nombre);
        if (!h) throw new Error("No existe esa habilidad.");
        return `# ${h.nombre}\n${h.descripcion}\n\n${h.instrucciones}`;
      }
      if (!e.nombre || !e.instrucciones) throw new Error("Para guardar hacen falta nombre e instrucciones.");
      const h = guardarHabilidad({ nombre: e.nombre, descripcion: e.descripcion ?? "", instrucciones: e.instrucciones }, e.id ?? undefined);
      emitir("habilidades");
      return `Habilidad guardada (id ${h.id}).`;
    },
  });
  return Object.assign(herramienta, { input_schema: esquemaJson(EntradaHabilidades) });
}

// ---- Herramientas por bot ----
// Cada bot tiene su propia terminal y su memoria; la carpeta de la computadora es la misma para todos.

const porBot = new Map<string, Map<string, BetaRunnableTool>>();

export async function herramientasDe(botId: string): Promise<Map<string, BetaRunnableTool>> {
  let mapa = porBot.get(botId);
  if (!mapa) {
    const memoria = betaMemoryTool(await BetaLocalFilesystemMemoryTool.init(carpetaMemoria(botId)));
    const lista = [...betaAgentToolset20260401({ workdir: COMPUTADORA }), memoria, herramientaRutinas(botId), herramientaHabilidades()];
    mapa = new Map(lista.map((t) => [t.name, t]));
    porBot.set(botId, mapa);
  }
  return mapa;
}

export async function cerrarHerramientas(botId: string): Promise<void> {
  const mapa = porBot.get(botId);
  porBot.delete(botId);
  for (const t of mapa?.values() ?? []) await t.close?.();
}

const ESTRICTAS = new Set(["rutinas", "habilidades"]);

// Definiciones para la API, en orden fijo para no romper el caché del prompt.
export function definiciones(mapa: Map<string, BetaRunnableTool>): Anthropic.Beta.BetaToolUnion[] {
  const servidor: Anthropic.Beta.BetaToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: 10 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
  ];
  const cliente = [...mapa.values()].map(({ run: _r, parse: _p, close: _c, ...definicion }) =>
    // Las herramientas definidas por el cliente transmiten su entrada a medida que se genera; se validan antes de
    // ejecutar. Las propias tienen esquema estricto (todo requerido, opcionales como null).
    definicion.type === "custom"
      ? { ...definicion, eager_input_streaming: true, ...(ESTRICTAS.has(definicion.name) ? { strict: true } : {}) }
      : definicion,
  ) as Anthropic.Beta.BetaToolUnion[];
  return [...servidor, ...cliente];
}

// ---- Aprobaciones ----

export interface PedidoAprobacion {
  herramienta: Regla["herramienta"];
  // Qué se guarda si el usuario elige "siempre permitir". Vacío: no se ofrece esa opción.
  patron: string;
  titulo: string;
  detalle: string;
  regla: string;
}

// Operadores que encadenan o redirigen comandos: con ellos una regla por programa no alcanza.
const OPERADORES = /[;&|`<>\n\\]|\$\(/;

export function programaDe(comando: string): string | null {
  const limpio = comando.trim();
  if (!limpio || OPERADORES.test(limpio)) return null;
  const programa = limpio.split(/\s+/)[0]!;
  return /^[\w.+-]+$/.test(programa) ? programa : null;
}

const permitido = (herramienta: Regla["herramienta"], patron: string) =>
  listarReglas().some((r) => r.herramienta === herramienta && r.patron === patron);

const recortar = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} caracteres más)` : s);

export function necesitaAprobacion(nombre: string, entrada: Record<string, unknown>): PedidoAprobacion | null {
  if (nombre === "bash") {
    const comando = String(entrada.command ?? "");
    if (!comando.trim()) return null; // solo reinicia la terminal
    const programa = programaDe(comando);
    if (programa && permitido("bash", programa)) return null;
    return {
      herramienta: "bash",
      patron: programa ?? "",
      titulo: "Ejecutar un comando en la computadora",
      detalle: recortar(comando),
      regla: programa ? `Siempre permitir comandos «${programa}» sin operadores de shell` : "",
    };
  }
  if (nombre === "write" || nombre === "edit") {
    if (permitido("editor", "*")) return null;
    const detalle =
      nombre === "write"
        ? String(entrada.content ?? "")
        : `- ${String(entrada.old_string ?? "")}\n+ ${String(entrada.new_string ?? "")}`;
    return {
      herramienta: "editor",
      patron: "*",
      titulo: `${nombre === "write" ? "Escribir" : "Editar"} ${String(entrada.file_path ?? "")}`,
      detalle: recortar(detalle),
      regla: "Siempre permitir escribir y editar archivos de la computadora",
    };
  }
  if (nombre === "rutinas" && entrada.accion !== "listar") {
    if (permitido("rutinas", "*")) return null;
    const verbo = { crear: "Crear", modificar: "Modificar", borrar: "Borrar" }[String(entrada.accion)] ?? "Cambiar";
    const rutina = typeof entrada.id === "string" ? buscarRutina(entrada.id) : undefined;
    return {
      herramienta: "rutinas",
      patron: "*",
      titulo: `${verbo} la rutina «${String(entrada.nombre ?? rutina?.nombre ?? "")}»`,
      detalle: recortar(JSON.stringify(entrada, null, 2)),
      regla: "Siempre permitir crear, modificar y borrar rutinas",
    };
  }
  return null;
}
