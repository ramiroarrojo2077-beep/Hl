// Gravity Code Git Manager: Git de verdad en los proyectos de codigo/, con isomorphic-git (JavaScript puro:
// anda en el celular aunque no haya git instalado). Repositorio, estado, commits, ramas, historial,
// diferencias contra el último commit, remoto de GitHub (push/pull con el token de la conexión) y pull
// requests. Subir o abrir un PR son acciones hacia afuera: las hace el usuario con su botón.

import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node/index.js";
import { carpetaProyecto } from "./codigo.ts";

const IGNORAR = "node_modules/\n.gravity/equipo.json\n*.log\n.env\n";
const dirDe = (p: string) => carpetaProyecto(p);
export const esRepo = (p: string) => fs.existsSync(path.join(dirDe(p), ".git"));

export async function iniciar(p: string): Promise<void> {
  const dir = dirDe(p);
  if (esRepo(p)) throw new Error("Este proyecto ya es un repositorio.");
  await git.init({ fs, dir, defaultBranch: "main" });
  const gi = path.join(dir, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, IGNORAR);
}

const ESTADOS: Record<string, string> = { "0,2,0": "nuevo (sin agregar)", "0,2,2": "nuevo", "1,2,1": "modificado", "1,2,2": "modificado", "1,0,1": "borrado", "1,0,0": "borrado", "1,1,0": "borrado (en el índice)", "1,2,0": "modificado" };

export interface EstadoGit {
  repo: boolean;
  rama: string | null;
  ramas: string[];
  cambios: { ruta: string; estado: string }[];
  historial: { oid: string; mensaje: string; autor: string; fecha: string }[];
  remoto: string | null;
}

export async function estado(p: string): Promise<EstadoGit> {
  const dir = dirDe(p);
  if (!esRepo(p)) return { repo: false, rama: null, ramas: [], cambios: [], historial: [], remoto: null };
  const [rama, ramas, matriz, remotos] = await Promise.all([
    git.currentBranch({ fs, dir, fullname: false }).catch(() => null),
    git.listBranches({ fs, dir }).catch(() => []),
    git.statusMatrix({ fs, dir }).catch(() => [] as [string, number, number, number][]),
    git.listRemotes({ fs, dir }).catch(() => []),
  ]);
  const cambios = matriz.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1)).map(([ruta, h, w, s]) => ({ ruta, estado: ESTADOS[`${h},${w},${s}`] ?? "cambiado" }));
  let historial: EstadoGit["historial"] = [];
  try {
    historial = (await git.log({ fs, dir, depth: 30 })).map((c) => ({ oid: c.oid, mensaje: c.commit.message.trim(), autor: c.commit.author.name, fecha: new Date(c.commit.author.timestamp * 1000).toISOString() }));
  } catch { /* sin commits todavía */ }
  return { repo: true, rama: rama ?? null, ramas, cambios, historial, remoto: remotos.find((r) => r.remote === "origin")?.url ?? null };
}

/** Agrega todo lo cambiado (incluidos los borrados) y hace el commit. */
export async function commit(p: string, mensaje: string, autor: { nombre: string; email: string }): Promise<string> {
  const dir = dirDe(p);
  if (!esRepo(p)) throw new Error("Primero iniciá el repositorio.");
  if (!mensaje.trim()) throw new Error("Escribí el mensaje del commit.");
  const matriz = await git.statusMatrix({ fs, dir });
  let n = 0;
  for (const [ruta, h, w, s] of matriz) {
    if (h === 1 && w === 1 && s === 1) continue;
    if (w === 0) await git.remove({ fs, dir, filepath: ruta });
    else await git.add({ fs, dir, filepath: ruta });
    n++;
  }
  if (!n) throw new Error("No hay cambios para guardar.");
  return git.commit({ fs, dir, message: mensaje.trim(), author: { name: autor.nombre, email: autor.email } });
}

export async function crearRama(p: string, nombre: string, cambiar = true): Promise<void> {
  const dir = dirDe(p);
  if (!/^[\w./-]{1,80}$/.test(nombre) || nombre.includes("..")) throw new Error("Nombre de rama inválido.");
  await git.branch({ fs, dir, ref: nombre, checkout: cambiar });
}

/** Cambia de rama. Si hay cambios sin guardar, no deja (para no perderlos). */
export async function cambiarRama(p: string, nombre: string): Promise<void> {
  const e = await estado(p);
  if (e.cambios.length) throw new Error("Hay cambios sin guardar: hacé un commit antes de cambiar de rama.");
  await git.checkout({ fs, dir: dirDe(p), ref: nombre });
}

/** Une otra rama a la actual (fast-forward o merge simple; si hay conflicto, avisa sin tocar nada). */
export async function unir(p: string, desde: string, autor: { nombre: string; email: string }): Promise<string> {
  const dir = dirDe(p);
  const actual = await git.currentBranch({ fs, dir });
  if (!actual) throw new Error("No hay una rama actual.");
  try {
    const r = await git.merge({ fs, dir, ours: actual, theirs: desde, author: { name: autor.nombre, email: autor.email }, abortOnConflict: true });
    await git.checkout({ fs, dir, ref: actual });
    return r.alreadyMerged ? "Ya estaba unida." : r.fastForward ? "Unida (avance directo)." : "Unida con un commit de merge.";
  } catch (err) {
    if ((err as { code?: string }).code === "MergeConflictError" || /conflict/i.test((err as Error).message)) throw new Error("Hay conflictos entre las ramas: resolvelos a mano (o pedíselo a un compañero) y probá de nuevo.");
    throw err;
  }
}

/** Contenido de un archivo en el último commit (para comparar con lo actual). */
export async function enHead(p: string, ruta: string): Promise<string | null> {
  const dir = dirDe(p);
  try {
    const oid = await git.resolveRef({ fs, dir, ref: "HEAD" });
    const { blob } = await git.readBlob({ fs, dir, oid, filepath: ruta });
    return Buffer.from(blob).toString("utf8");
  } catch {
    return null;
  }
}

export async function ponerRemoto(p: string, url: string): Promise<void> {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/.test(url)) throw new Error("Por ahora el remoto tiene que ser https://github.com/dueño/repo.");
  const dir = dirDe(p);
  await git.deleteRemote({ fs, dir, remote: "origin" }).catch(() => {});
  await git.addRemote({ fs, dir, remote: "origin", url });
}

const auth = (token: string | null) => () => (token ? { username: token, password: "x-oauth-basic" } : undefined);

export async function subir(p: string, token: string | null): Promise<string> {
  if (!token) throw new Error("Para subir hace falta conectar GitHub (Conexiones) con un token que pueda escribir en el repositorio.");
  const dir = dirDe(p);
  const rama = await git.currentBranch({ fs, dir });
  const r = await git.push({ fs, http, dir, remote: "origin", ref: rama ?? "main", onAuth: auth(token) });
  if (!r.ok) throw new Error(`GitHub rechazó la subida: ${r.error ?? "sin detalle"}.`);
  return `Rama ${rama} subida.`;
}

export async function traer(p: string, token: string | null, autor: { nombre: string; email: string }): Promise<string> {
  const e = await estado(p);
  if (e.cambios.length) throw new Error("Hay cambios sin guardar: hacé un commit antes de traer.");
  const dir = dirDe(p);
  await git.pull({ fs, http, dir, remote: "origin", ref: e.rama ?? "main", singleBranch: true, author: { name: autor.nombre, email: autor.email }, onAuth: auth(token) });
  return "Actualizado desde GitHub.";
}

/** Abre un pull request en GitHub (de la rama actual a `base`). */
export async function pullRequest(p: string, token: string | null, titulo: string, cuerpo: string, base: string): Promise<string> {
  if (!token) throw new Error("Para abrir un pull request hace falta conectar GitHub (Conexiones).");
  const e = await estado(p);
  const m = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(e.remoto ?? "");
  if (!m) throw new Error("El proyecto no tiene un remoto de GitHub.");
  const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/pulls`, { method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "Gravity", "content-type": "application/json" }, body: JSON.stringify({ title: titulo, body: cuerpo, head: e.rama, base }) });
  const j = (await r.json().catch(() => ({}))) as { html_url?: string; message?: string };
  if (!r.ok) throw new Error(`GitHub: ${j.message ?? r.status}`);
  return j.html_url ?? "Pull request creado.";
}
