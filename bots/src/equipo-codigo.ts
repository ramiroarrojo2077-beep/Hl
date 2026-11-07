// Equipo de programación de un proyecto de Gravity Code: N agentes (3 a 60) con roles, un coordinador que
// divide el trabajo en tareas chicas con dependencias (proyecto de Gravity con la carpeta codigo/<p>/) y
// las reparte; cada tarea le llega sola a su responsable cuando se destraba, así trabajan en paralelo. Se
// coordinan en el canal del proyecto (@menciones), el coordinador revisa cada entrega y los revisores y
// testers verifican. Con más de 29 miembros se arman sub-equipos con líderes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { agregarRegla, ahora, buscarBot, crearBot, directos, guardarEstado, listarBots, MAX_BOTS, type Bot } from "./almacen.ts";
import { crearEquipo } from "./equipo.ts";
import { MAX_MIEMBROS_EQUIPO, NOMBRES } from "./plantillas.ts";
import { buscarProyecto, crearProyecto, listarProyectos, progreso } from "./proyectos.ts";
import { carpetaProyecto, CARPETA_CODIGO } from "./codigo.ts";

export const MAX_EQUIPO_CODIGO = 60;

export interface EquipoCodigo {
  coordinadorId: string;
  lideres: string[];
  miembros: { id: string; rol: string }[];
  proyectoId: string;
  probarSinPermiso: boolean;
  escribirSinPermiso: boolean;
  creado: string;
}

const archivo = (p: string) => path.join(carpetaProyecto(p), ".gravity", "equipo.json");
export function leerEquipo(p: string): EquipoCodigo | null {
  const f = archivo(p);
  if (!existsSync(f)) return null;
  const e = JSON.parse(readFileSync(f, "utf8")) as EquipoCodigo;
  // Los que se borraron o archivaron ya no cuentan.
  e.miembros = e.miembros.filter((m) => buscarBot(m.id) && !buscarBot(m.id)!.archivado);
  return buscarBot(e.coordinadorId) ? e : null;
}
const guardar = (p: string, e: EquipoCodigo) => { mkdirSync(path.dirname(archivo(p)), { recursive: true }); writeFileSync(archivo(p), JSON.stringify(e, null, 1)); };

const ROLES: Record<string, { titulo: string; descripcion: string }> = {
  arquitecto: { titulo: "Arquitecto de software", descripcion: "Diseño la estructura: módulos, interfaces entre ellos, contratos de datos y convenciones, antes de que el equipo programe. Dejo las decisiones en la memoria técnica y aviso en el canal qué archivo es de quién para que nadie pise a nadie." },
  frontend: { titulo: "Programador frontend", descripcion: "Implemento interfaces (HTML/CSS/JS, Android) con código claro, accesible y probado. Solo toco los archivos de mi tarea; si necesito cambiar algo de otro, lo pido en el canal con @nombre." },
  backend: { titulo: "Programador backend", descripcion: "Implemento lógica, servidores, APIs y datos con código claro y pruebas. Solo toco los archivos de mi tarea; si necesito cambiar algo de otro, lo pido en el canal con @nombre." },
  programador: { titulo: "Programador", descripcion: "Implemento funcionalidades con código claro y pruebas que pasan (verifico con probar_aislado antes de entregar). Solo toco los archivos de mi tarea; si necesito algo de otro, lo pido en el canal con @nombre." },
  tester: { titulo: "Tester", descripcion: "Escribo y corro pruebas reales (normales, bordes y errores). Si algo falla, lo reporto en el canal con el comando, la salida exacta y a quién le corresponde. Nunca digo que algo pasa sin haberlo corrido." },
  revisor: { titulo: "Revisor de código", descripcion: "Reviso las entregas: errores, seguridad, casos no cubiertos y consistencia con la arquitectura. Corro las pruebas antes de aprobar y dejo los pedidos de cambio concretos (archivo y línea) en el canal." },
  debugger: { titulo: "Debugger", descripcion: "Investigo los errores: los reproduzco, encuentro la causa y hago el arreglo mínimo, demostrando con un comando real que quedó resuelto." },
  disenador: { titulo: "Diseñador de interfaces", descripcion: "Defino y construyo la parte visual: estilos, componentes y accesibilidad (contraste, tamaños táctiles, lectores de pantalla), coherente en celular y escritorio." },
  documentador: { titulo: "Documentador técnico", descripcion: "Mantengo README, cómo correr y probar, la documentación de módulos y API, y la memoria técnica, siempre a partir del código real." },
  devops: { titulo: "DevOps", descripcion: "Me ocupo de cómo se construye, prueba y despliega: scripts, dependencias, Dockerfile y la lista de control de despliegue. No publico nada sin aprobación." },
};

/** Cómo se reparten los roles para un equipo de `n` (sin contar al coordinador). */
export function repartirRoles(n: number): Record<string, number> {
  const r: Record<string, number> = {};
  const poner = (k: string, c: number) => { if (c > 0) r[k] = (r[k] ?? 0) + c; };
  let resto = n;
  const tomar = (k: string, c: number) => { const x = Math.min(c, resto); poner(k, x); resto -= x; };
  if (n >= 3) tomar("arquitecto", 1);
  tomar("tester", Math.max(1, Math.round(n * 0.15)));
  if (n >= 3) tomar("revisor", Math.max(1, Math.round(n * 0.12)));
  if (n >= 6) tomar("debugger", 1);
  if (n >= 5) tomar("disenador", 1);
  if (n >= 10) tomar("documentador", 1);
  if (n >= 12) tomar("devops", 1);
  if (n >= 8) { const front = Math.floor(resto / 2); tomar("frontend", front); tomar("backend", resto); }
  else tomar("programador", resto);
  return r;
}

/**
 * Arma el equipo y el proyecto de Gravity que reparte el trabajo. `cantidad` cuenta a todos (coordinador,
 * líderes y miembros).
 */
export function armarEquipoCodigo(p: string, op: { cantidad: number; escribirSinPermiso: boolean; probarSinPermiso: boolean }): EquipoCodigo {
  const dir = carpetaProyecto(p);
  if (!existsSync(dir)) throw new Error("No existe ese proyecto.");
  if (leerEquipo(p)) throw new Error("Este proyecto ya tiene equipo: sumá gente desde el panel del equipo.");
  const total = Math.round(op.cantidad);
  if (total < 3 || total > MAX_EQUIPO_CODIGO) throw new Error(`El equipo va de 3 a ${MAX_EQUIPO_CODIGO} agentes.`);
  if (listarBots().length + total > MAX_BOTS) throw new Error(`Con este equipo pasarías los ${MAX_BOTS} compañeros: quedan ${MAX_BOTS - listarBots().length} lugares.`);
  const carpeta = `${CARPETA_CODIGO}/${p}/`;
  const coordDesc = `Coordino el equipo de programación del proyecto «${p}» (carpeta ${carpeta}). Divido cada objetivo en tareas chicas e independientes por archivo o módulo, con dependencias (arquitectura → implementación en paralelo → pruebas y revisión → integración), las cargo en el proyecto con la herramienta proyectos asignando a cada uno según su rol y su carga, reviso cada entrega, resuelvo conflictos entre archivos y mantengo la memoria técnica (${carpeta}.gravity/memoria.md).`;
  // Hasta 30 entran en un solo equipo; más, se arman sub-equipos con líderes que reportan al coordinador.
  const miembrosTotales = total - 1;
  let coord: Bot;
  const lideres: Bot[] = [];
  const miembros: { id: string; rol: string }[] = [];
  const roles = repartirRoles(miembrosTotales <= MAX_MIEMBROS_EQUIPO ? miembrosTotales : miembrosTotales - Math.ceil(miembrosTotales / 15));
  const puestosDe = (rs: Record<string, number>) => Object.entries(rs).filter(([, c]) => c > 0).map(([k, c]) => ({ titulo: ROLES[k]!.titulo, descripcion: `${ROLES[k]!.descripcion} Proyecto: ${carpeta}`, cantidad: c }));
  if (miembrosTotales <= MAX_MIEMBROS_EQUIPO) {
    const r = crearEquipo({ manager: { titulo: "Coordinador de desarrollo", descripcion: coordDesc }, reportaA: null, puestos: puestosDe(roles), carpetaLibre: false });
    coord = r.manager;
    const orden = Object.entries(roles).flatMap(([k, c]) => Array(c).fill(k));
    r.miembros.forEach((m, i) => miembros.push({ id: m.id, rol: orden[i] ?? "programador" }));
  } else {
    const nLideres = Math.ceil(miembrosTotales / 15);
    const r = crearEquipo({ manager: { titulo: "Coordinador de desarrollo", descripcion: coordDesc }, reportaA: null, puestos: [{ titulo: "Líder técnico", descripcion: `Lidero un sub-equipo del proyecto ${carpeta}: reparto sus tareas, reviso sus entregas y coordino con los otros líderes en el canal.`, cantidad: nLideres }], carpetaLibre: false });
    coord = r.manager;
    for (const l of r.miembros) { l.cargo = "manager"; lideres.push(l); }
    // Reparte los roles entre los sub-equipos de forma pareja.
    const cola = Object.entries(roles).flatMap(([k, c]) => Array(c).fill(k) as string[]);
    const grupos: string[][] = lideres.map(() => []);
    cola.forEach((rol, i) => grupos[i % lideres.length]!.push(rol));
    lideres.forEach((l, i) => {
      l.carpetaEquipo ??= `equipos/${l.id}/`;
      for (const rol of grupos[i]!) {
        const b = crearBot({ nombre: nombreLibre(), titulo: ROLES[rol]!.titulo, descripcion: `${ROLES[rol]!.descripcion} Proyecto: ${carpeta}`, cargo: "miembro", reportaA: l.id, esfuerzo: "low" }, false);
        miembros.push({ id: b.id, rol });
      }
    });
    guardarEstado();
  }
  const proyecto = crearProyecto({ nombre: `Code · ${p}`.slice(0, 120), objetivo: `Desarrollo del proyecto de Gravity Code «${p}» (carpeta ${carpeta}).`, coordinadorId: coord.id, carpeta }, "usuario");
  // Permisos que eligió el usuario: escribir en la carpeta del proyecto y probar en copias aisladas.
  if (op.escribirSinPermiso) {
    for (const jefe of [coord, ...lideres]) agregarRegla("editor", carpeta, { tipo: "equipo", managerId: jefe.id });
  }
  const e: EquipoCodigo = { coordinadorId: coord.id, lideres: lideres.map((l) => l.id), miembros, proyectoId: proyecto.id, probarSinPermiso: op.probarSinPermiso, escribirSinPermiso: op.escribirSinPermiso, creado: ahora() };
  guardar(p, e);
  return e;
}

// Del título de un puesto de la plantilla «Programación» (o uno parecido) al rol del equipo de código.
export function rolDeTitulo(titulo: string): string {
  const t = titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (t.includes("arquitect")) return "arquitecto";
  if (t.includes("frontend") || t.includes("interfaz")) return t.includes("disen") ? "disenador" : "frontend";
  if (t.includes("backend")) return "backend";
  if (t.includes("test") || t.includes("qa")) return "tester";
  if (t.includes("revis")) return "revisor";
  if (t.includes("debug")) return "debugger";
  if (t.includes("devops") || t.includes("despliegue")) return "devops";
  if (t.includes("document")) return "documentador";
  if (t.includes("disen")) return "disenador";
  return "programador";
}

/**
 * Vincula un equipo ya creado (por ejemplo, con la plantilla «Programación» desde Equipo) a un proyecto de
 * Gravity Code: le indica la carpeta a cada uno, arma el proyecto de Gravity que reparte las tareas y deja
 * el equipo registrado en .gravity/equipo.json, igual que si se hubiera armado desde Gravity Code.
 */
export function vincularEquipoCodigo(p: string, managerId: string, op: { escribirSinPermiso: boolean; probarSinPermiso: boolean }): EquipoCodigo {
  const dir = carpetaProyecto(p);
  if (!existsSync(dir)) throw new Error("No existe ese proyecto de Gravity Code.");
  if (leerEquipo(p)) throw new Error("Ese proyecto de Gravity Code ya tiene equipo.");
  const jefe = buscarBot(managerId);
  if (!jefe) throw new Error("No existe ese manager.");
  const carpeta = `${CARPETA_CODIGO}/${p}/`;
  const nota = (d: string) => (d.includes(carpeta) ? d : `${d} Proyecto: ${carpeta}`);
  jefe.descripcion = nota(jefe.descripcion);
  const miembros = directos(jefe.id).map((b) => { b.descripcion = nota(b.descripcion); return { id: b.id, rol: rolDeTitulo(b.titulo) }; });
  guardarEstado();
  const proyecto = crearProyecto({ nombre: `Code · ${p}`.slice(0, 120), objetivo: `Desarrollo del proyecto de Gravity Code «${p}» (carpeta ${carpeta}).`, coordinadorId: jefe.id, carpeta }, "usuario");
  if (op.escribirSinPermiso) agregarRegla("editor", carpeta, { tipo: "equipo", managerId: jefe.id });
  const e: EquipoCodigo = { coordinadorId: jefe.id, lideres: [], miembros, proyectoId: proyecto.id, probarSinPermiso: op.probarSinPermiso, escribirSinPermiso: op.escribirSinPermiso, creado: ahora() };
  guardar(p, e);
  return e;
}

function nombreLibre(): string {
  const usados = new Set(listarBots().map((b) => b.nombre.toLowerCase()));
  for (let k = 1; ; k++) {
    const n = NOMBRES.map((x) => (k === 1 ? x : `${x} ${k}`)).find((x) => !usados.has(x.toLowerCase()));
    if (n) return n;
  }
}

/** ¿Este compañero puede usar probar_aislado en esa carpeta sin pedir permiso? (equipo con ese permiso) */
export function puedeProbarSinPermiso(botId: string, carpetaRel: string): boolean {
  const m = /^codigo\/([^/]+)/.exec(carpetaRel.replace(/^\/+/, ""));
  if (!m) return false;
  try {
    const e = leerEquipo(m[1]!);
    return !!e?.probarSinPermiso && (e.coordinadorId === botId || e.lideres.includes(botId) || e.miembros.some((x) => x.id === botId));
  } catch {
    return false;
  }
}

export const nombreRol = (rol: string) => ROLES[rol]?.titulo ?? rol;

/** Le pasa un objetivo al coordinador con el equipo, las reglas de trabajo y el proyecto donde cargar las tareas. */
export async function encargar(p: string, objetivo: string): Promise<void> {
  const e = leerEquipo(p);
  if (!e) throw new Error("Este proyecto no tiene equipo.");
  const pr = buscarProyecto(e.proyectoId);
  if (!pr) throw new Error("No existe el proyecto del equipo.");
  const lista = [...e.lideres.map((id) => `- ${buscarBot(id)?.nombre} (${id}) · Líder técnico`), ...e.miembros.map((m) => `- ${buscarBot(m.id)?.nombre} (${m.id}) · ${nombreRol(m.rol)}`)].join("\n");
  const { enviarMensaje } = await import("./agente.ts");
  enviarMensaje(e.coordinadorId, [
    `[Gravity Code · equipo de ${1 + e.lideres.length + e.miembros.length}] Objetivo para el proyecto «${p}» (carpeta codigo/${p}/): ${objetivo}`,
    `Tu equipo:\n${lista}`,
    `Cómo trabajar (en paralelo, sin pisarse):`,
    `1. Leé la memoria técnica (codigo/${p}/.gravity/memoria.md) y el código actual.`,
    `2. Si hace falta, primero una tarea de arquitectura para el arquitecto (estructura, archivos y contratos).`,
    `3. Cargá las tareas con la herramienta proyectos (proyecto ${pr.id}, agregar_tarea): chicas, con criterio de «listo» comprobable, responsable según su rol y dependencias reales. Cada tarea dice qué archivos toca y nunca dos tareas abiertas tocan el mismo archivo. Usá a todo el equipo: tareas independientes en paralelo.`,
    `4. Para cada funcionalidad: implementación → pruebas (tester) → revisión (revisor) → integración. Los errores van al debugger.`,
    `5. Las tareas le llegan solas a cada uno cuando se destraban. Coordinen en el canal del proyecto (herramienta canales) con @menciones.`,
    `6. Al final: todo integrado, pruebas pasando (con salida real), memoria técnica actualizada y un resumen para el usuario.`,
  ].join("\n\n"));
}

/** Estado del equipo: cada integrante con su rol, su estado y sus tareas abiertas en el proyecto. */
export function estadoEquipo(p: string) {
  const e = leerEquipo(p);
  if (!e) return null;
  const pr = buscarProyecto(e.proyectoId) ?? listarProyectos().find((x) => x.carpeta === `codigo/${p}/`);
  const tareas = pr?.tareas ?? [];
  const fila = (id: string, rol: string) => {
    const b = buscarBot(id)!;
    const mias = tareas.filter((t) => t.asignadoA === id);
    return { id, nombre: b.nombre, rol, abiertas: mias.filter((t) => t.estado === "pendiente" || t.estado === "en_curso").map((t) => ({ titulo: t.titulo, estado: t.estado })), hechas: mias.filter((t) => t.estado === "completada").length };
  };
  return {
    ...e,
    proyecto: pr ? { id: pr.id, nombre: pr.nombre, progreso: progreso(pr), tareas: tareas.length } : null,
    integrantes: [fila(e.coordinadorId, "Coordinador de desarrollo"), ...e.lideres.map((id) => fila(id, "Líder técnico")), ...e.miembros.map((m) => fila(m.id, nombreRol(m.rol)))],
  };
}

/** Suma gente a un equipo existente (con el rol que falte o el que se pida). */
export function sumarAlEquipo(p: string, cantidad: number, rol: string): { id: string; rol: string }[] {
  const e = leerEquipo(p);
  if (!e) throw new Error("Este proyecto no tiene equipo.");
  if (!ROLES[rol]) throw new Error("Rol desconocido.");
  const n = Math.round(cantidad);
  if (n < 1 || 1 + e.lideres.length + e.miembros.length + n > MAX_EQUIPO_CODIGO) throw new Error(`El equipo puede tener hasta ${MAX_EQUIPO_CODIGO} agentes.`);
  if (listarBots().length + n > MAX_BOTS) throw new Error(`Pasarías los ${MAX_BOTS} compañeros.`);
  // Va con el jefe (coordinador o líder) que tenga menos gente a cargo.
  const jefes = [e.coordinadorId, ...e.lideres];
  const nuevos: { id: string; rol: string }[] = [];
  for (let i = 0; i < n; i++) {
    const jefe = jefes.map((id) => ({ id, n: directos(id).length })).filter((x) => x.n < MAX_MIEMBROS_EQUIPO).sort((a, b) => a.n - b.n)[0];
    if (!jefe) throw new Error("Los jefes del equipo ya están llenos.");
    const b = crearBot({ nombre: nombreLibre(), titulo: ROLES[rol]!.titulo, descripcion: `${ROLES[rol]!.descripcion} Proyecto: codigo/${p}/`, cargo: "miembro", reportaA: jefe.id, esfuerzo: "low" }, false);
    nuevos.push({ id: b.id, rol });
  }
  guardarEstado();
  e.miembros.push(...nuevos);
  guardar(p, e);
  return nuevos;
}
