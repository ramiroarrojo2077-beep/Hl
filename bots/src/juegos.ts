// Gravity Game Studio (motor): cada juego es un proyecto real de Gravity Code (codigo/<nombre>/) con
// juego.json (mapa, personajes, IA de los NPC, animaciones, físicas, historia, interfaz), motor.js (el motor
// de Gravity, el mismo para jugar y para probar) e index.html. Se genera desde una descripción, se edita
// visualmente, se prueba solo (validación, alcanzabilidad y simulación) y se exporta (web, HTML único, Tiled).

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { COMPUTADORA } from "./almacen.ts";

const VENDOR = new URL("../public/vendor/", import.meta.url);
const ruta = (f: string) => new URL(f, VENDOR);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Ia = z.object({ tipo: z.enum(["quieto", "patrullar", "perseguir", "huir", "camino"]), rango: z.number().min(0).max(50).optional(), distancia: z.number().min(0).max(50).optional(), siNoVe: z.enum(["quieto", "patrullar"]).optional(), puntos: z.array(z.tuple([z.number(), z.number()])).max(20).optional() });
export const Personaje = z.object({
  id: z.string().regex(/^[\w-]{1,30}$/), nombre: z.string().max(40), rol: z.enum(["jugador", "npc", "enemigo"]), color: Color,
  forma: z.enum(["bloque", "blob", "robot", "caballero"]).default("bloque"), ancho: z.number().min(0.3).max(2).default(0.75), alto: z.number().min(0.3).max(3).default(0.9),
  velocidad: z.number().min(0).max(12).default(2), salto: z.number().min(0).max(20).default(9), vida: z.number().int().min(1).max(20).default(3), dano: z.number().int().min(0).max(10).optional(),
  ia: Ia.optional(), dialogo: z.array(z.string().max(300)).max(20).optional(),
  animaciones: z.object({ caminar: z.object({ frecuencia: z.number().min(0).max(4), amplitud: z.number().min(0).max(4) }).optional(), salto: z.object({ estirar: z.number().min(0).max(0.6) }).optional() }).optional(),
});
export const Juego = z.object({
  nombre: z.string().min(1).max(60), genero: z.enum(["plataformas", "aventura"]), vista: z.enum(["2d", "3d"]).default("2d"),
  tamTile: z.number().int().min(16).max(64).default(32), fondo: Color.optional(),
  mapa: z.object({ filas: z.array(z.string().max(300)).min(3).max(200) }),
  tiles: z.record(z.string().length(1), z.object({ nombre: z.string().max(30), color: Color.optional(), solido: z.boolean().optional(), dano: z.boolean().optional(), meta: z.boolean().optional() })).default({}),
  personajes: z.array(Personaje).min(1).max(40),
  entidades: z.array(z.object({ personaje: z.string(), x: z.number().int().min(0), y: z.number().int().min(0) })).max(300).default([]),
  items: z.array(z.object({ id: z.string().regex(/^[\w-]{1,30}$/), nombre: z.string().max(40), color: Color, efecto: z.enum(["puntos", "vida", "llave"]), valor: z.number().min(0).max(1000).default(10) })).max(30).default([]),
  colocados: z.array(z.object({ item: z.string(), x: z.number().int().min(0), y: z.number().int().min(0) })).max(300).default([]),
  fisica: z.object({ gravedad: z.number().min(0).max(3), friccion: z.number().min(0).max(1), rebote: z.number().min(0).max(1), velMaxCaida: z.number().min(1).max(40) }).default({ gravedad: 0.5, friccion: 0.25, rebote: 0, velMaxCaida: 12 }),
  historia: z.object({ sinopsis: z.string().max(1500), misiones: z.array(z.object({ id: z.string().max(30), titulo: z.string().max(100), objetivo: z.object({ tipo: z.enum(["recolectar", "llegar", "hablar", "derrotar"]), objetivo: z.string().max(30).optional(), cantidad: z.number().int().min(1).max(999).optional() }) })).max(20), dialogos: z.array(z.object({ personaje: z.string(), lineas: z.array(z.string().max(300)) })).max(40).optional() }).optional(),
  ui: z.object({ titulo: z.string().max(60).optional(), colorPrincipal: Color.optional(), menu: z.boolean().optional(), inventario: z.boolean().optional(), controlesTactiles: z.boolean().optional() }).optional(),
});
export type Juego = z.infer<typeof Juego>;

const dirDe = (nombre: string) => {
  const n = nombre.trim();
  if (!/^[\w][\w -]{0,59}$/.test(n)) throw new Error("Nombre inválido (letras, números, espacios y guiones).");
  return path.join(COMPUTADORA, "codigo", n);
};
export function listar(): { nombre: string; genero: string; vista: string }[] {
  const base = path.join(COMPUTADORA, "codigo");
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((d) => existsSync(path.join(base, d, "juego.json"))).map((d) => { try { const j = JSON.parse(readFileSync(path.join(base, d, "juego.json"), "utf8")) as Juego; return { nombre: d, genero: j.genero, vista: j.vista }; } catch { return { nombre: d, genero: "?", vista: "?" }; } });
}
export function leer(nombre: string): Juego {
  const f = path.join(dirDe(nombre), "juego.json");
  if (!existsSync(f)) throw new Error("No existe ese juego.");
  return Juego.parse(JSON.parse(readFileSync(f, "utf8")));
}

/** Mapa parejo (todas las filas del mismo ancho) y entidades dentro del mapa. */
export function normalizar(j: Juego): Juego {
  const ancho = Math.max(...j.mapa.filas.map((f) => f.length));
  const filas = j.mapa.filas.map((f) => f.padEnd(ancho, "."));
  const dentro = (x: number, y: number) => x < ancho && y < filas.length;
  return { ...j, mapa: { filas }, entidades: j.entidades.filter((e) => dentro(e.x, e.y)), colocados: j.colocados.filter((e) => dentro(e.x, e.y)) };
}
const INDEX = (j: Juego) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>${j.nombre.replace(/[<&]/g, "")}</title><style>html,body,#juego{margin:0;height:100%;background:#111}</style></head><body><div id="juego"></div>
<script type="module">
import { iniciar } from "./motor.js";
const juego = ${JSON.stringify(j).replace(/</g, "\\u003c")};
let three = null;
if (juego.vista === "3d") { try { three = await import("./three.module.min.js"); } catch (e) { console.warn("Sin 3D:", e); } }
// Para depurar y para las pruebas: el estado del juego en curso.
window.partida = await iniciar(document.getElementById("juego"), juego, { three });
</script></body></html>
`;
/** Guarda el juego (validado) y regenera index.html, motor.js y, si es 3D, Three.js. */
export function guardar(nombre: string, datos: unknown): Juego {
  const j = normalizar(Juego.parse(datos));
  const dir = dirDe(nombre);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "juego.json"), JSON.stringify(j, null, 1));
  writeFileSync(path.join(dir, "index.html"), INDEX(j));
  copyFileSync(ruta("juego/motor.js"), path.join(dir, "motor.js"));
  if (j.vista === "3d") for (const f of ["three.module.min.js", "three.core.min.js"]) copyFileSync(ruta(`three/${f}`), path.join(dir, f));
  if (j.historia) writeFileSync(path.join(dir, "HISTORIA.md"), `# ${j.nombre}\n\n${j.historia.sinopsis}\n\n## Misiones\n\n${j.historia.misiones.map((m) => `- **${m.titulo}** (${m.objetivo.tipo}${m.objetivo.objetivo ? `: ${m.objetivo.objetivo}` : ""}${m.objetivo.cantidad ? ` ×${m.objetivo.cantidad}` : ""})`).join("\n")}\n${j.personajes.filter((p) => p.dialogo?.length).map((p) => `\n## ${p.nombre}\n\n${p.dialogo!.map((l) => `> ${l}`).join("\n")}`).join("\n")}\n`);
  if (!existsSync(path.join(dir, "README.md"))) writeFileSync(path.join(dir, "README.md"), `# ${j.nombre}\n\nJuego hecho con Gravity Game Studio. Abrí index.html desde un servidor web (o usá la exportación «HTML único»).\n\n- juego.json: todo el juego (mapa, personajes, físicas, historia)\n- motor.js: el motor de Gravity\n`);
  return j;
}

export const EJEMPLO: Juego = Juego.parse({
  nombre: "Aventura de prueba", genero: "plataformas", vista: "2d", fondo: "#a8dadc",
  mapa: { filas: [
    "........................................",
    "........................................",
    "........................................",
    "..............C.C.............C.........",
    "..........C..=====..........====.....G..",
    "P.....C.=====........E...............###",
    "##############..^^..#######..~~~..######",
    "##############..##..#######..###..######",
  ] },
  tiles: { "~": { nombre: "agua", color: "#4ea8de", dano: true } },
  personajes: [
    { id: "heroe", nombre: "Lumi", rol: "jugador", color: "#4361ee", forma: "robot", velocidad: 3.2, salto: 9.5, vida: 3, animaciones: { caminar: { frecuencia: 1.2, amplitud: 1 }, salto: { estirar: 0.18 } } },
    { id: "slime", nombre: "Slime", rol: "enemigo", color: "#2a9d8f", forma: "blob", velocidad: 1, vida: 1, ia: { tipo: "patrullar", distancia: 3 } },
    { id: "guia", nombre: "Guía", rol: "npc", color: "#f4a261", forma: "caballero", velocidad: 0, ia: { tipo: "quieto" }, dialogo: ["¡Hola, Lumi!", "Juntá 5 monedas y llegá a la bandera."] },
  ],
  entidades: [{ personaje: "slime", x: 23, y: 5 }, { personaje: "guia", x: 2, y: 5 }],
  items: [{ id: "moneda", nombre: "Moneda", color: "#ffd166", efecto: "puntos", valor: 10 }],
  historia: { sinopsis: "Lumi tiene que recuperar las monedas perdidas.", misiones: [{ id: "m1", titulo: "Juntá 5 monedas", objetivo: { tipo: "recolectar", objetivo: "moneda", cantidad: 5 } }, { id: "m2", titulo: "Hablá con la Guía", objetivo: { tipo: "hablar", objetivo: "guia" } }] },
  ui: { titulo: "Aventura de prueba", colorPrincipal: "#4361ee" },
});

// ---- Probador ----

export interface Informe { ok: boolean; errores: string[]; avisos: string[]; alcance: { meta: boolean | null; items: number; itemsTotal: number }; simulacion: { corridas: number; cuadros: number; ganadas: number; perdidas: number; problemas: string[] } }
async function motor(): Promise<{ crearEstado: (j: Juego, s?: number) => Est; paso: (st: Est, e: Record<string, boolean>, dt?: number) => Est }> { return import(ruta("juego/motor.js").href); }
type Act = { x: number; y: number; vx: number; vy: number; vida: number; vivo: boolean; def: { id: string; rol: string } };
type Est = { jugador: Act; actores: Act[]; items: { tomado: boolean }[]; fin: string | null; misiones: { hecha: boolean }[] };

export async function probar(j0: Juego): Promise<Informe> {
  const j = normalizar(j0), errores: string[] = [], avisos: string[] = [];
  const filas = j.mapa.filas, alto = filas.length, ancho = filas[0]!.length;
  const solido = (c: string | undefined) => c === undefined || (j.tiles[c]?.solido ?? ["#", "=", "B"].includes(c));
  const at = (x: number, y: number) => (y < 0 || y >= alto || x < 0 || x >= ancho ? undefined : filas[y]![x]);
  const P = filas.flatMap((f, y) => [...f].map((c, x) => (c === "P" ? [x, y] : null)).filter(Boolean) as number[][]);
  if (P.length !== 1) errores.push(P.length ? `Hay ${P.length} inicios (P): tiene que haber uno.` : "Falta el inicio del jugador (P) en el mapa.");
  if (!j.personajes.some((p) => p.rol === "jugador")) errores.push("No hay ningún personaje con rol «jugador».");
  const ids = new Set(j.personajes.map((p) => p.id));
  if (ids.size !== j.personajes.length) errores.push("Hay personajes con el mismo id.");
  for (const e of j.entidades) { if (!ids.has(e.personaje)) errores.push(`Entidad en (${e.x},${e.y}) usa un personaje que no existe: ${e.personaje}.`); else if (solido(at(e.x, e.y))) avisos.push(`${e.personaje} en (${e.x},${e.y}) está dentro de una pared.`); }
  const itemIds = new Set(j.items.map((i) => i.id));
  for (const c of j.colocados) if (!itemIds.has(c.item)) errores.push(`Ítem colocado desconocido: ${c.item}.`);
  if (filas.some((f) => f.includes("C")) && !j.items.length) avisos.push("Hay monedas (C) pero ningún ítem definido: valen 10 puntos.");
  const meta = filas.some((f) => /[G]/.test(f)) || Object.entries(j.tiles).some(([c, t]) => t.meta && filas.some((f) => f.includes(c)));
  for (const m of j.historia?.misiones ?? []) {
    const o = m.objetivo;
    if ((o.tipo === "hablar" || o.tipo === "derrotar") && o.objetivo && !ids.has(o.objetivo)) errores.push(`Misión «${m.titulo}»: no existe el personaje ${o.objetivo}.`);
    if (o.tipo === "recolectar" && o.objetivo && !itemIds.has(o.objetivo) && o.objetivo !== "moneda") errores.push(`Misión «${m.titulo}»: no existe el ítem ${o.objetivo}.`);
    if (o.tipo === "hablar" && o.objetivo && !j.personajes.find((p) => p.id === o.objetivo)?.dialogo?.length) avisos.push(`Misión «${m.titulo}»: ${o.objetivo} no tiene diálogo.`);
    if (o.tipo === "recolectar") { const hay = filas.join("").split("C").length - 1 + j.colocados.filter((c) => !o.objetivo || c.item === o.objetivo).length; if (hay < (o.cantidad ?? 1)) errores.push(`Misión «${m.titulo}»: pide ${o.cantidad ?? 1} y en el mapa hay ${hay}.`); }
  }
  if (!meta && !(j.historia?.misiones.length)) errores.push("No hay forma de ganar: falta la meta (G) o misiones.");
  for (const p of j.personajes) if (p.rol === "npc" && !p.dialogo?.length) avisos.push(`El NPC ${p.nombre} no tiene diálogo.`);

  // Alcanzabilidad: desde el inicio, por dónde puede moverse el jugador.
  let alcance = { meta: null as boolean | null, items: 0, itemsTotal: 0 };
  if (P.length === 1) {
    const pj = j.personajes.find((p) => p.rol === "jugador")!;
    const vistos = new Set<string>(), cola: number[][] = [];
    const plat = j.genero === "plataformas";
    const g = j.fisica.gravedad || 0.5;
    const subir = plat ? Math.max(1, Math.floor((pj.salto * pj.salto) / (2 * g) / j.tamTile)) : 0;
    const lado = plat ? Math.max(1, Math.ceil(((pj.velocidad * 2 * pj.salto) / g) / j.tamTile)) : 0;
    const libre = (x: number, y: number) => at(x, y) !== undefined && !solido(at(x, y)) && at(x, y) !== "^";
    const pararse = (x: number, y: number) => { if (!libre(x, y)) return null; if (!plat) return [x, y]; let yy = y; while (yy < alto && libre(x, yy + 1)) yy++; return yy >= alto - 1 && libre(x, yy) && at(x, yy + 1) === undefined ? null : [x, yy]; };
    const meter = (c: number[] | null) => { if (!c) return; const k = `${c[0]},${c[1]}`; if (!vistos.has(k)) { vistos.add(k); cola.push(c); } };
    meter(pararse(P[0]![0]!, P[0]![1]!));
    const tocados = new Set<string>();
    while (cola.length) {
      const [x, y] = cola.shift()!;
      tocados.add(`${x},${y}`);
      if (!plat) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (libre(x! + dx!, y! + dy!)) meter([x! + dx!, y! + dy!]); continue; }
      // Plataformas: caminar, caer o saltar (alto y largo según salto, velocidad y gravedad).
      for (let dy = -subir; dy <= 0; dy++) for (let dx = -lado; dx <= lado; dx++) {
        const nx = x! + dx, ny = y! + dy;
        if (!libre(nx, ny)) continue;
        let ok = true;
        for (let k = 1; k <= -dy && ok; k++) if (!libre(x!, y! - k)) ok = false; // techo
        // Sin atravesar paredes: las columnas del medio tienen que estar libres a la altura de llegada.
        for (let cx = Math.min(x!, nx) + 1; cx < Math.max(x!, nx) && ok; cx++) if (!libre(cx, ny) || !libre(cx, Math.min(y!, ny) - (dy < 0 ? 0 : 1))) ok = false;
        if (ok) { for (let k = y!; k >= ny; k--) tocados.add(`${nx},${k}`); meter(pararse(nx, ny)); }
      }
    }
    // Lo que el jugador atraviesa en un salto o una caída también cuenta como tocado.
    for (const k of [...tocados]) { const [x, y] = k.split(",").map(Number); for (let yy = y!; yy < alto && libre(x!, yy); yy++) tocados.add(`${x},${yy}`); }
    const objetivos = filas.flatMap((f, y) => [...f].map((c, x) => [c, x, y] as const)).filter(([c]) => c === "C" || c === "G");
    const items = objetivos.filter(([c]) => c === "C").concat(j.colocados.map((c) => ["C", c.x, c.y] as const));
    alcance = { meta: meta ? objetivos.some(([c, x, y]) => c === "G" && tocados.has(`${x},${y}`)) : null, items: items.filter(([, x, y]) => tocados.has(`${x},${y}`)).length, itemsTotal: items.length };
    if (alcance.meta === false) errores.push("La meta (G) no parece alcanzable desde el inicio con este salto y esta gravedad.");
    if (alcance.items < alcance.itemsTotal) avisos.push(`${alcance.itemsTotal - alcance.items} de ${alcance.itemsTotal} ítems no parecen alcanzables.`);
  }

  // Simulación con el motor real: entradas al azar, buscando errores, valores inválidos o atascos.
  const sim = { corridas: 0, cuadros: 0, ganadas: 0, perdidas: 0, problemas: [] as string[] };
  if (!errores.length) {
    const M = await motor();
    for (let s = 1; s <= 4; s++) {
      let st: Est;
      try { st = M.crearEstado(j, s * 7919); } catch (err) { sim.problemas.push(`No arranca: ${(err as Error).message}`); break; }
      let r = s, quieto = 0, prev = { x: st.jugador.x, y: st.jugador.y };
      const az = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
      let entrada: Record<string, boolean> = {};
      sim.corridas++;
      for (let f = 0; f < 1800 && !st.fin; f++) {
        if (f % 20 === 0) entrada = { der: az() < 0.6, izq: az() < 0.25, saltar: az() < 0.4, arriba: az() < 0.3, abajo: az() < 0.3, accion: az() < 0.2, accionNueva: az() < 0.1 };
        try { M.paso(st, entrada, 1); } catch (err) { sim.problemas.push(`Error del motor en el cuadro ${f}: ${(err as Error).message}`); break; }
        sim.cuadros++;
        const J = st.jugador;
        if (![J.x, J.y, J.vx, J.vy].every(Number.isFinite)) { sim.problemas.push(`Valores inválidos en el cuadro ${f}.`); break; }
        quieto = Math.hypot(J.x - prev.x, J.y - prev.y) < 0.01 ? quieto + 1 : 0; prev = { x: J.x, y: J.y };
      }
      if (quieto > 900) sim.problemas.push("El jugador quedó trabado (más de 15 s sin moverse con controles activos).");
      if (st.fin === "ganaste") sim.ganadas++; else if (st.fin === "perdiste") sim.perdidas++;
    }
  }
  return { ok: !errores.length && !sim.problemas.length, errores, avisos, alcance, simulacion: sim };
}

// ---- Exportar ----

export function htmlUnico(j: Juego): string {
  const motorJs = readFileSync(ruta("juego/motor.js"), "utf8");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>${j.nombre.replace(/[<&]/g, "")}</title><style>html,body,#juego{margin:0;height:100%;background:#111}</style></head><body><div id="juego"></div>
<script type="module">
${motorJs.replace(/<\/script/gi, "<\\/script")}
iniciar(document.getElementById("juego"), ${JSON.stringify({ ...j, vista: "2d" }).replace(/</g, "\\u003c")});
</script></body></html>
`;
}
/** Mapa en formato Tiled (.tmj): lo abren Tiled y los importadores de Godot, Unity, Phaser o Defold. */
export function tiled(j: Juego) {
  const filas = j.mapa.filas, chars = [...new Set(filas.join("").replace(/[.P]/g, ""))];
  const gid = (c: string) => (c === "." || c === "P" ? 0 : chars.indexOf(c) + 1);
  return {
    type: "map", version: "1.10", tiledversion: "1.10.2", orientation: "orthogonal", renderorder: "right-down", infinite: false,
    width: filas[0]!.length, height: filas.length, tilewidth: j.tamTile, tileheight: j.tamTile, nextlayerid: 3, nextobjectid: j.entidades.length + 2,
    properties: [{ name: "genero", type: "string", value: j.genero }, { name: "gravedad", type: "float", value: j.fisica.gravedad }],
    tilesets: [{ firstgid: 1, name: "gravity", tilewidth: j.tamTile, tileheight: j.tamTile, tilecount: chars.length, columns: chars.length, tiles: chars.map((c, i) => ({ id: i, type: j.tiles[c]?.nombre ?? c, properties: [{ name: "caracter", type: "string", value: c }, { name: "solido", type: "bool", value: j.tiles[c]?.solido ?? ["#", "=", "B"].includes(c) }] })) }],
    layers: [
      { id: 1, name: "mapa", type: "tilelayer", width: filas[0]!.length, height: filas.length, opacity: 1, visible: true, x: 0, y: 0, data: filas.flatMap((f) => [...f].map(gid)) },
      { id: 2, name: "entidades", type: "objectgroup", opacity: 1, visible: true, x: 0, y: 0, objects: [
        ...filas.flatMap((f, y) => [...f].map((c, x) => (c === "P" ? { id: 1, name: "inicio", type: "jugador", x: x * j.tamTile, y: y * j.tamTile, width: j.tamTile, height: j.tamTile, rotation: 0, visible: true } : null)).filter(Boolean)),
        ...j.entidades.map((e, i) => ({ id: i + 2, name: e.personaje, type: j.personajes.find((p) => p.id === e.personaje)?.rol ?? "npc", x: e.x * j.tamTile, y: e.y * j.tamTile, width: j.tamTile, height: j.tamTile, rotation: 0, visible: true })),
      ] },
    ],
  };
}

// ---- Con IA: generar el juego y la historia ----

function esquema(s: z.ZodType): Record<string, unknown> { const { $schema: _, ...r } = z.toJSONSchema(s, { reused: "inline", io: "input" }); return r; }
export const ia = {
  async json(s: z.ZodType, sistema: string, usuario: string, signal: AbortSignal): Promise<unknown> {
    const { client, MODELO, BETA_FALLBACK } = await import("./cliente.ts");
    const { llamar } = await import("./cupo.ts");
    const { registrarUso } = await import("./gasto.ts");
    const m = await llamar("juegos", "usuario", signal, () => client.beta.messages.create({ model: MODELO, max_tokens: 12000, betas: [BETA_FALLBACK], fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema" as const, schema: esquema(s) } }, system: sistema, messages: [{ role: "user", content: usuario }] }, { signal }));
    registrarUso("juegos", m);
    const t = m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
    return JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  },
};
const REGLAS_MAPA = `El mapa son filas de texto del mismo largo (40 a 120 columnas, 8 a 30 filas). Caracteres: «.» aire o piso libre, «#» sólido, «=» plataforma sólida, «B» bloque sólido, «^» pinchos (dañan), «~» agua, «C» moneda, «G» meta, «P» inicio del jugador (uno solo). En plataformas: suelo abajo, saltos alcanzables (con salto 9 y gravedad 0.5 se suben unos 2 tiles y se cruzan unos 4 de largo). En aventura (vista de arriba): «#» son paredes que rodean el mapa y arman cuartos y pasillos. Las entidades usan coordenadas de tile (x columna, y fila) en lugares libres; en plataformas, sobre el suelo.`;
/** Genera un juego completo y jugable desde una descripción; se valida y se prueba antes de guardarlo. */
export async function generar(descripcion: string, op: { genero?: string; vista?: string }, signal: AbortSignal): Promise<{ juego: Juego; informe: Informe }> {
  let ultimo = "";
  for (let intento = 0; intento < 2; intento++) {
    const crudo = await ia.json(Juego, `Diseñás videojuegos 2D completos y jugables para el motor de Gravity. ${REGLAS_MAPA} Incluí un jugador, 2 a 6 enemigos o NPC con IA (patrullar, perseguir con rango, huir, quieto o camino), NPC con diálogo, ítems, físicas razonables, historia con 1 a 4 misiones verificables y la interfaz. Colores en #rrggbb. Respondé en español.${ultimo ? `\nEl intento anterior tuvo estos problemas, corregilos: ${ultimo}` : ""}`, `Juego: ${descripcion}${op.genero ? `\nGénero: ${op.genero}` : ""}${op.vista ? `\nVista: ${op.vista}` : ""}`, signal);
    let j: Juego;
    try { j = normalizar(Juego.parse(crudo)); } catch (err) { ultimo = err instanceof z.ZodError ? err.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "formato"; continue; }
    if (op.vista === "3d" || op.vista === "2d") j.vista = op.vista;
    const informe = await probar(j);
    if (!informe.errores.length || intento === 1) return { juego: j, informe };
    ultimo = informe.errores.join("; ");
  }
  throw new Error(`El modelo no armó un juego válido (${ultimo}). Probá con otra descripción.`);
}

const Historia = z.object({ sinopsis: z.string(), misiones: z.array(z.object({ id: z.string(), titulo: z.string(), objetivo: z.object({ tipo: z.enum(["recolectar", "llegar", "hablar", "derrotar"]), objetivo: z.string().optional(), cantidad: z.number().int().optional() }) })), dialogos: z.array(z.object({ personaje: z.string(), lineas: z.array(z.string()) })), personajesNuevos: z.array(z.object({ nombre: z.string(), descripcion: z.string() })) });
/** Narrativa, misiones y diálogos usando lo que ya existe en el juego (personajes e ítems reales). */
export async function generarHistoria(j: Juego, idea: string, signal: AbortSignal) {
  const r = Historia.parse(await ia.json(Historia, "Escribís la narrativa de un videojuego: sinopsis, misiones verificables (solo con personajes e ítems que existen, por su id) y diálogos para los NPC (por id). Si hacen falta personajes nuevos, proponelos aparte. Español, frases cortas.", `Juego: ${j.nombre} (${j.genero})\nIdea: ${idea || "la que mejor encaje"}\nPersonajes: ${j.personajes.map((p) => `${p.id} = ${p.nombre} (${p.rol})`).join(", ")}\nÍtems: ${j.items.map((i) => `${i.id} = ${i.nombre}`).join(", ") || "moneda"}\nMonedas en el mapa: ${j.mapa.filas.join("").split("C").length - 1}`, signal));
  const ids = new Set(j.personajes.map((p) => p.id)), items = new Set([...j.items.map((i) => i.id), "moneda"]);
  const misiones = r.misiones.filter((m) => !m.objetivo.objetivo || (["hablar", "derrotar"].includes(m.objetivo.tipo) ? ids.has(m.objetivo.objetivo) : m.objetivo.tipo === "recolectar" ? items.has(m.objetivo.objetivo) : true)).slice(0, 10).map((m, i) => ({ ...m, id: m.id || `m${i + 1}` }));
  const personajes = j.personajes.map((p) => { const d = r.dialogos.find((x) => x.personaje === p.id); return d && p.rol !== "jugador" ? { ...p, dialogo: d.lineas.slice(0, 12) } : p; });
  return { juego: { ...j, personajes, historia: { sinopsis: r.sinopsis, misiones, dialogos: r.dialogos.filter((d) => ids.has(d.personaje)) } } as Juego, descartadas: r.misiones.length - misiones.length, personajesNuevos: r.personajesNuevos };
}
