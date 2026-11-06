// Gravity Code: proyectos de programación dentro de la computadora (carpeta codigo/). Cada proyecto tiene su
// memoria técnica en .gravity/memoria.md (arquitectura, dependencias, decisiones, convenciones, errores y
// soluciones, pendientes) que los compañeros leen antes de trabajar y actualizan al terminar.
// Acá está lo que hace el usuario desde el editor: crear, importar, buscar y reemplazar, ejecutar comandos
// (en la carpeta real o en una copia aislada) y exportar. Todo es real: nada se simula.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { COMPUTADORA, nuevoId } from "./almacen.ts";
import { ejecutarAislado, type ResultadoAislado } from "./aislado.ts";
import { guardarVersion } from "./versiones.ts";
import { exportarCarpeta, extraerZip } from "./respaldo.ts";

export const CARPETA_CODIGO = "codigo";
const RAIZ = () => path.join(COMPUTADORA, CARPETA_CODIGO);
const MAX_TEXTO = 1_000_000;
const SHELL = existsSync("/bin/bash") ? "/bin/bash" : (["/system/bin/sh", "/bin/sh"].find((s) => existsSync(s)) ?? "sh");
const VARIABLES_PERMITIDAS = ["PATH", "LANG", "LC_ALL", "TERM", "TZ", "HOME", "ANDROID_ROOT", "ANDROID_DATA", "NODE_PATH", "JAVA_HOME", "ANDROID_HOME"];

export interface ProyectoCodigo {
  nombre: string;
  carpeta: string; // relativa a la computadora
  archivos: number;
  modificado: string;
  memoria: boolean;
}

const nombreValido = (n: string) => /^[\w][\w .-]{0,59}$/.test(n) && !n.includes("..");

/** Carpeta absoluta de un proyecto, validada. */
export function carpetaProyecto(nombre: string): string {
  if (!nombreValido(nombre)) throw new Error("Nombre de proyecto inválido (letras, números, espacios, punto, guion; hasta 60).");
  return path.join(RAIZ(), nombre);
}

function contar(dir: string): { archivos: number; ultimo: number } {
  let archivos = 0;
  let ultimo = 0;
  const pila = [dir];
  while (pila.length && archivos < 5000) {
    const d = pila.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) pila.push(abs);
      else if (e.isFile()) { archivos++; ultimo = Math.max(ultimo, statSync(abs).mtimeMs); }
    }
  }
  return { archivos, ultimo };
}

export function listarProyectosCodigo(): ProyectoCodigo[] {
  if (!existsSync(RAIZ())) return [];
  return readdirSync(RAIZ(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => {
      const dir = path.join(RAIZ(), e.name);
      const c = contar(dir);
      return { nombre: e.name, carpeta: `${CARPETA_CODIGO}/${e.name}`, archivos: c.archivos, modificado: new Date(c.ultimo || statSync(dir).mtimeMs).toISOString(), memoria: existsSync(path.join(dir, ".gravity", "memoria.md")) };
    })
    .sort((a, b) => b.modificado.localeCompare(a.modificado));
}

export const MEMORIA_INICIAL = (nombre: string, descripcion: string) => `# Memoria técnica · ${nombre}

> La leen los compañeros antes de trabajar en este proyecto y la actualizan al terminar. Escribí corto y concreto.

## Objetivo
${descripcion || "(qué hace el proyecto y para quién)"}

## Arquitectura
(estructura de carpetas, módulos principales y cómo se comunican)

## Dependencias
(bibliotecas y versiones, herramientas para compilar y probar)

## Cómo se ejecuta y se prueba
(comandos exactos)

## Decisiones de diseño
(qué se eligió y por qué)

## Convenciones de código
(nombres, formato, idioma de los comentarios)

## Errores anteriores y soluciones verificadas
(error → causa → solución → cómo se verificó)

## Pendientes
-

## Historial
- ${new Date().toISOString().slice(0, 10)}: proyecto creado.
`;

const PLANTILLAS: Record<string, Record<string, string>> = {
  vacio: { "README.md": "# {{nombre}}\n\n{{descripcion}}\n" },
  web: {
    "index.html": '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>{{nombre}}</title>\n<link rel="stylesheet" href="estilos.css">\n</head>\n<body>\n<main>\n  <h1>{{nombre}}</h1>\n  <p>{{descripcion}}</p>\n  <button id="boton">Probar</button>\n  <p id="salida"></p>\n</main>\n<script src="app.js"></script>\n</body>\n</html>\n',
    "estilos.css": "body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #0b101b; color: #e8ecf5; }\nbutton { padding: 10px 16px; border-radius: 10px; border: 0; background: #6cd3f0; color: #05070d; font-weight: 600; }\n",
    "app.js": 'document.getElementById("boton").addEventListener("click", () => {\n  document.getElementById("salida").textContent = "Funciona: " + new Date().toLocaleTimeString();\n});\n',
  },
  node: {
    "package.json": '{\n  "name": "{{slug}}",\n  "version": "0.1.0",\n  "type": "module",\n  "scripts": { "start": "node index.js", "test": "node --test" }\n}\n',
    "index.js": 'export function sumar(a, b) {\n  return a + b;\n}\n\nif (import.meta.url === `file://${process.argv[1]}`) console.log("{{nombre}}:", sumar(2, 3));\n',
    "index.test.js": 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sumar } from "./index.js";\n\ntest("suma", () => assert.equal(sumar(2, 3), 5));\n',
    "README.md": "# {{nombre}}\n\n{{descripcion}}\n\n- Correr: `npm start`\n- Probar: `npm test`\n",
  },
  python: {
    "main.py": 'def sumar(a, b):\n    return a + b\n\n\nif __name__ == "__main__":\n    print("{{nombre}}:", sumar(2, 3))\n',
    "test_main.py": "import unittest\nfrom main import sumar\n\n\nclass Pruebas(unittest.TestCase):\n    def test_suma(self):\n        self.assertEqual(sumar(2, 3), 5)\n\n\nif __name__ == '__main__':\n    unittest.main()\n",
    "README.md": "# {{nombre}}\n\n{{descripcion}}\n\n- Correr: `python main.py`\n- Probar: `python -m unittest`\n",
  },
};
PLANTILLAS.api = {
  "package.json": '{\n  "name": "{{slug}}",\n  "version": "0.1.0",\n  "type": "module",\n  "scripts": { "start": "node servidor.js", "test": "node --test" }\n}\n',
  "servidor.js": 'import http from "node:http";\n\n// API REST mínima sin dependencias: rutas, JSON, validación y errores claros.\nconst items = new Map();\nlet siguiente = 1;\n\nexport function manejar(metodo, ruta, cuerpo) {\n  if (metodo === "GET" && ruta === "/salud") return [200, { ok: true }];\n  if (metodo === "GET" && ruta === "/items") return [200, [...items.values()]];\n  if (metodo === "POST" && ruta === "/items") {\n    if (!cuerpo || typeof cuerpo.nombre !== "string" || !cuerpo.nombre.trim()) return [400, { error: "Falta nombre" }];\n    const item = { id: siguiente++, nombre: cuerpo.nombre.trim() };\n    items.set(item.id, item);\n    return [201, item];\n  }\n  const m = /^\\/items\\/(\\d+)$/.exec(ruta);\n  if (m && metodo === "GET") return items.has(Number(m[1])) ? [200, items.get(Number(m[1]))] : [404, { error: "No existe" }];\n  if (m && metodo === "DELETE") return items.delete(Number(m[1])) ? [204, null] : [404, { error: "No existe" }];\n  return [404, { error: "Ruta desconocida" }];\n}\n\nexport function crearServidor() {\n  return http.createServer((req, res) => {\n    let datos = "";\n    req.on("data", (c) => (datos += c));\n    req.on("end", () => {\n      let cuerpo = null;\n      try { cuerpo = datos ? JSON.parse(datos) : null; } catch { res.writeHead(400).end(JSON.stringify({ error: "JSON inválido" })); return; }\n      const [estado, salida] = manejar(req.method, new URL(req.url, "http://x").pathname, cuerpo);\n      res.writeHead(estado, { "content-type": "application/json" });\n      res.end(salida === null ? "" : JSON.stringify(salida));\n    });\n  });\n}\n\nif (import.meta.url === `file://${process.argv[1]}`) {\n  const puerto = Number(process.env.PORT ?? 3000);\n  crearServidor().listen(puerto, () => console.log(`{{nombre}} escuchando en http://localhost:${puerto}`));\n}\n',
  "servidor.test.js": 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { manejar } from "./servidor.js";\n\ntest("crear, leer y borrar items", () => {\n  assert.deepEqual(manejar("POST", "/items", {}), [400, { error: "Falta nombre" }]);\n  const [estado, item] = manejar("POST", "/items", { nombre: "Primero" });\n  assert.equal(estado, 201);\n  assert.deepEqual(manejar("GET", `/items/${item.id}`), [200, item]);\n  assert.deepEqual(manejar("DELETE", `/items/${item.id}`), [204, null]);\n  assert.equal(manejar("GET", `/items/${item.id}`)[0], 404);\n});\n',
  "README.md": "# {{nombre}}\n\n{{descripcion}}\n\nAPI REST sin dependencias.\n\n| Método | Ruta | Qué hace |\n|---|---|---|\n| GET | /salud | Estado |\n| GET | /items | Lista |\n| POST | /items | Crea (`{\"nombre\": \"...\"}`) |\n| GET | /items/:id | Uno |\n| DELETE | /items/:id | Borra |\n\n- Correr: `npm start` (puerto `PORT`, 3000 por defecto)\n- Probar: `npm test`\n",
};
export const PLANTILLAS_CODIGO = Object.keys(PLANTILLAS);

// ---- Developer Pro: entorno, dependencias, problemas y despliegue ----

/** Qué herramientas hay en este equipo (versión real de cada una) y qué tipo de proyecto es. */
export async function entorno(nombre: string): Promise<{ tipo: string[]; herramientas: { nombre: string; version: string | null }[] }> {
  const dir = carpetaProyecto(nombre);
  const tipo: string[] = [];
  if (existsSync(path.join(dir, "package.json"))) tipo.push("Node.js");
  if (["requirements.txt", "pyproject.toml", "main.py"].some((f) => existsSync(path.join(dir, f)))) tipo.push("Python");
  if (["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"].some((f) => existsSync(path.join(dir, f)))) tipo.push("Android/Gradle");
  if (existsSync(path.join(dir, "index.html"))) tipo.push("Web");
  if (existsSync(path.join(dir, ".git"))) tipo.push("Git");
  const probar = (cmd: string) => new Promise<string | null>((r) => {
    const p = spawn(SHELL, ["-c", `${cmd} 2>&1`], { cwd: dir, env: process.env });
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    const t = setTimeout(() => { p.kill("SIGKILL"); r(null); }, 5000);
    p.on("close", (c) => { clearTimeout(t); r(c === 0 ? o.trim().split("\n")[0]!.slice(0, 80) : null); });
    p.on("error", () => { clearTimeout(t); r(null); });
  });
  const lista: [string, string][] = [["node", "node --version"], ["npm", "npm --version"], ["python", "python3 --version || python --version"], ["git", "git --version"], ["java", "java -version 2>&1 | grep -i version | head -1"], ["gradle", "gradle --version | head -3 | tail -1"]];
  const herramientas = await Promise.all(lista.map(async ([n, c]) => ({ nombre: n, version: await probar(c) })));
  return { tipo, herramientas };
}

export interface Dependencia { nombre: string; usada: string; ultima: string | null; estado: "al día" | "menor" | "mayor" | "desconocida"; ecosistema: "npm" | "pypi" }
const limpiarVersion = (v: string) => v.replace(/^[\^~>=<\s]+/, "").split(/[\s,]/)[0] ?? v;
function comparar(usada: string, ultima: string | null): Dependencia["estado"] {
  if (!ultima) return "desconocida";
  const a = limpiarVersion(usada).split(".").map(Number), b = ultima.split(".").map(Number);
  if (a.some(Number.isNaN)) return "desconocida";
  if ((b[0] ?? 0) > (a[0] ?? 0)) return "mayor";
  if ((b[1] ?? 0) > (a[1] ?? 0) || ((b[1] ?? 0) === (a[1] ?? 0) && (b[2] ?? 0) > (a[2] ?? 0))) return "menor";
  return "al día";
}
/** Dependencias declaradas y su última versión publicada (registro de npm o PyPI). */
export async function dependencias(nombre: string, traer: (url: string) => Promise<unknown> = (u) => fetch(u, { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : null))): Promise<Dependencia[]> {
  const dir = carpetaProyecto(nombre);
  const salida: Dependencia[] = [];
  const pj = path.join(dir, "package.json");
  if (existsSync(pj)) {
    const j = JSON.parse(readFileSync(pj, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    for (const [n, v] of Object.entries({ ...j.dependencies, ...j.devDependencies }).slice(0, 80)) {
      const d = (await traer(`https://registry.npmjs.org/${n.replace("/", "%2F")}/latest`).catch(() => null)) as { version?: string } | null;
      salida.push({ nombre: n, usada: v, ultima: d?.version ?? null, estado: comparar(v, d?.version ?? null), ecosistema: "npm" });
    }
  }
  const req = path.join(dir, "requirements.txt");
  if (existsSync(req)) {
    for (const linea of readFileSync(req, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).slice(0, 80)) {
      const m = /^([A-Za-z0-9_.-]+)\s*(?:[=<>~!]=?\s*([\w.]+))?/.exec(linea);
      if (!m) continue;
      const d = (await traer(`https://pypi.org/pypi/${m[1]}/json`).catch(() => null)) as { info?: { version?: string } } | null;
      salida.push({ nombre: m[1]!, usada: m[2] ?? "(sin versión)", ultima: d?.info?.version ?? null, estado: m[2] ? comparar(m[2], d?.info?.version ?? null) : "desconocida", ecosistema: "pypi" });
    }
  }
  return salida;
}

/** Errores con archivo y línea en una salida (Node, Python, TypeScript, Kotlin/Java, compiladores). */
export function problemas(nombre: string, salida: string): { ruta: string; linea: number; mensaje: string }[] {
  const dir = carpetaProyecto(nombre);
  const vistos = new Set<string>();
  const out: { ruta: string; linea: number; mensaje: string }[] = [];
  const lineas = salida.split("\n");
  const patrones = [/(?:file:\/\/)?([\w./\\ -]+\.(?:m?[jt]sx?|py|kt|java|c|cpp|go|rs|css|html)):(\d+)(?::\d+)?/, /File "([^"]+)", line (\d+)/, /([\w./-]+\.(?:ts|tsx))\((\d+),\d+\)/];
  lineas.forEach((l0, i) => {
    let l = l0;
    try { l = decodeURI(l0); } catch { /* deja la línea como está */ }
    for (const re of patrones) {
      const m = re.exec(l);
      if (!m) continue;
      const abs = path.resolve(dir, m[1]!.trim());
      if (!abs.startsWith(dir + path.sep) || !existsSync(abs) || abs.includes(`${path.sep}node_modules${path.sep}`)) continue;
      const rel = path.relative(COMPUTADORA, abs).split(path.sep).join("/");
      const k = `${rel}:${m[2]}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      const cerca = [...lineas.slice(i + 1, i + 12), ...lineas.slice(Math.max(0, i - 8), i).reverse()];
      const msj = (cerca.find((x) => /^\s*(\w*Error|AssertionError|Exception|SyntaxError)\b|^\s*(expected|actual|message|error):\s*\S/i.test(x) && !/\|-\s*$|location:/.test(x)) ?? l).trim().slice(0, 200);
      out.push({ ruta: rel, linea: Number(m[2]), mensaje: msj });
      break;
    }
  });
  return out.slice(0, 30);
}

/** Prepara el despliegue: Dockerfile, .dockerignore y DESPLIEGUE.md según el tipo de proyecto (no pisa lo que exista). */
export function prepararDespliegue(nombre: string): string[] {
  const dir = carpetaProyecto(nombre);
  const creados: string[] = [];
  const escribir = (f: string, c: string) => { const abs = path.join(dir, f); if (existsSync(abs)) return; writeFileSync(abs, c); creados.push(f); };
  const esNode = existsSync(path.join(dir, "package.json")), esPy = existsSync(path.join(dir, "requirements.txt")) || existsSync(path.join(dir, "main.py")), esWeb = existsSync(path.join(dir, "index.html")) && !esNode;
  if (esNode) {
    const pj = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    escribir("Dockerfile", `FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev || npm install --omit=dev\nCOPY . .\nENV NODE_ENV=production PORT=3000\nEXPOSE 3000\nCMD ["npm", "${pj.scripts?.start ? "start" : "run"}"${pj.scripts?.start ? "" : ', "start"'}]\n`);
  } else if (esPy) escribir("Dockerfile", "FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt* ./\nRUN [ -f requirements.txt ] && pip install --no-cache-dir -r requirements.txt || true\nCOPY . .\nEXPOSE 8000\nCMD [\"python\", \"main.py\"]\n");
  else if (esWeb) escribir("Dockerfile", "FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\n");
  if (creados.includes("Dockerfile")) escribir(".dockerignore", "node_modules\n.git\n.gravity\n*.log\n.env\n");
  escribir("DESPLIEGUE.md", `# Despliegue de ${nombre}\n\nPreparado por Gravity Code. Revisalo antes de publicar: publicar no se hace solo.\n\n## Antes de publicar\n- [ ] Las pruebas pasan (\`${esNode ? "npm test" : esPy ? "python -m unittest" : "abrir index.html"}\`).\n- [ ] No hay claves ni contraseñas en el código (usá variables de entorno).\n- [ ] Probado en un entorno de prueba.\n\n## Con Docker\n\n\`\`\`\ndocker build -t ${nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-")} .\ndocker run -p 8080:${esNode ? 3000 : esPy ? 8000 : 80} ${nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-")}\n\`\`\`\n\n## Opciones\n${esWeb ? "- Sitio estático: GitHub Pages, Netlify o Cloudflare Pages (subiendo esta carpeta).\n" : "- Un servicio que acepte Docker (Render, Railway, Fly.io, Google Cloud Run).\n"}- Exportá el proyecto con «Exportar .zip» desde Gravity Code.\n`);
  return creados;
}

export function crearProyectoCodigo(nombre: string, plantilla: string, descripcion = ""): ProyectoCodigo {
  const dir = carpetaProyecto(nombre);
  if (existsSync(dir)) throw new Error(`Ya existe un proyecto «${nombre}».`);
  const archivos = PLANTILLAS[plantilla] ?? PLANTILLAS.vacio!;
  const slug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "proyecto";
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const abs = path.join(dir, ruta);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contenido.replaceAll("{{nombre}}", nombre).replaceAll("{{slug}}", slug).replaceAll("{{descripcion}}", descripcion));
  }
  mkdirSync(path.join(dir, ".gravity"), { recursive: true });
  writeFileSync(path.join(dir, ".gravity", "memoria.md"), MEMORIA_INICIAL(nombre, descripcion));
  return listarProyectosCodigo().find((p) => p.nombre === nombre)!;
}

export function leerMemoriaCodigo(nombre: string): string {
  const f = path.join(carpetaProyecto(nombre), ".gravity", "memoria.md");
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}
export function guardarMemoriaCodigo(nombre: string, texto: string): void {
  const dir = path.join(carpetaProyecto(nombre), ".gravity");
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "memoria.md");
  guardarVersion(f);
  writeFileSync(f, texto);
}

/** Importa un repositorio público de GitHub (o uno privado con el token de la conexión) como proyecto. */
export async function importarGithub(repo: string, nombre: string | null, token: string | null, signal?: AbortSignal): Promise<ProyectoCodigo> {
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w./-]+))?\/?$/.exec(repo.trim());
  if (!m) throw new Error("Escribí el repositorio como dueño/nombre o con su enlace de GitHub.");
  const [, dueno, repoNombre, rama] = m;
  const destinoNombre = nombre?.trim() || repoNombre!;
  const dir = carpetaProyecto(destinoNombre);
  if (existsSync(dir)) throw new Error(`Ya existe un proyecto «${destinoNombre}».`);
  const url = `https://api.github.com/repos/${dueno}/${repoNombre}/zipball${rama ? `/${rama}` : ""}`;
  const r = await fetch(url, { headers: { "User-Agent": "Gravity", Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, redirect: "follow", signal });
  if (r.status === 404) throw new Error("No encontré ese repositorio (si es privado, conectá GitHub en Conexiones).");
  if (!r.ok) throw new Error(`GitHub respondió ${r.status}.`);
  const tam = Number(r.headers.get("content-length") || 0);
  if (tam > 150 * 1024 * 1024) throw new Error("El repositorio es demasiado grande para el celular (más de 150 MB).");
  const zip = path.join(tmpdir(), `gravity-repo-${nuevoId()}.zip`);
  try {
    writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    extraerZip(zip, dir, { quitarRaiz: true });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  } finally {
    rmSync(zip, { force: true });
  }
  if (!existsSync(path.join(dir, ".gravity", "memoria.md"))) {
    mkdirSync(path.join(dir, ".gravity"), { recursive: true });
    writeFileSync(path.join(dir, ".gravity", "memoria.md"), MEMORIA_INICIAL(destinoNombre, `Importado de github.com/${dueno}/${repoNombre}${rama ? ` (${rama})` : ""}.`));
  }
  return listarProyectosCodigo().find((p) => p.nombre === destinoNombre)!;
}

export function exportarProyecto(nombre: string, destino: string): number {
  return exportarCarpeta(carpetaProyecto(nombre), destino, nombre);
}

// ---- Buscar y reemplazar en todo el proyecto ----

function* archivosDeTexto(dir: string): Generator<string> {
  const pila = [dir];
  while (pila.length) {
    const d = pila.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === ".gravity") continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) pila.push(abs);
      else if (e.isFile() && statSync(abs).size <= MAX_TEXTO) yield abs;
    }
  }
}
const esBinario = (b: Buffer) => b.subarray(0, 8000).includes(0);

function patron(texto: string, op: { regex?: boolean; mayusculas?: boolean }): RegExp {
  try {
    return new RegExp(op.regex ? texto : texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), op.mayusculas ? "g" : "gi");
  } catch (err) {
    throw new Error(`Expresión inválida: ${(err as Error).message}`);
  }
}

export interface Coincidencia { ruta: string; linea: number; texto: string }

export function buscarEnProyecto(nombre: string, texto: string, op: { regex?: boolean; mayusculas?: boolean } = {}): { coincidencias: Coincidencia[]; recortado: boolean } {
  const dir = carpetaProyecto(nombre);
  const re = patron(texto, op);
  const coincidencias: Coincidencia[] = [];
  for (const abs of archivosDeTexto(dir)) {
    const b = readFileSync(abs);
    if (esBinario(b)) continue;
    const lineas = b.toString("utf8").split("\n");
    for (let i = 0; i < lineas.length; i++) {
      re.lastIndex = 0;
      if (re.test(lineas[i]!)) {
        coincidencias.push({ ruta: path.relative(COMPUTADORA, abs).split(path.sep).join("/"), linea: i + 1, texto: lineas[i]!.trim().slice(0, 200) });
        if (coincidencias.length >= 500) return { coincidencias, recortado: true };
      }
    }
  }
  return { coincidencias, recortado: false };
}

/** Reemplaza en todos los archivos de texto del proyecto. Antes guarda la versión de cada archivo que cambia. */
export function reemplazarEnProyecto(nombre: string, texto: string, reemplazo: string, op: { regex?: boolean; mayusculas?: boolean } = {}): { archivos: number; reemplazos: number } {
  const dir = carpetaProyecto(nombre);
  const re = patron(texto, op);
  let archivos = 0;
  let reemplazos = 0;
  for (const abs of archivosDeTexto(dir)) {
    const b = readFileSync(abs);
    if (esBinario(b)) continue;
    const antes = b.toString("utf8");
    let n = 0;
    const despues = antes.replace(re, (...m) => { n++; return op.regex ? reemplazo.replace(/\$(\d)/g, (_, k) => String(m[Number(k)] ?? "")) : reemplazo; });
    if (n) {
      guardarVersion(abs);
      writeFileSync(abs, despues);
      archivos++;
      reemplazos += n;
    }
  }
  return { archivos, reemplazos };
}

// ---- Archivos: crear carpeta, renombrar y borrar (con versión, para poder recuperar) ----

function dentroDelProyecto(nombre: string, ruta: string): string {
  const dir = carpetaProyecto(nombre);
  const abs = path.resolve(dir, ruta);
  if (abs !== dir && !abs.startsWith(dir + path.sep)) throw new Error("La ruta tiene que estar dentro del proyecto.");
  return abs;
}
export function crearCarpeta(nombre: string, ruta: string): void {
  mkdirSync(dentroDelProyecto(nombre, ruta), { recursive: true });
}
export function renombrar(nombre: string, de: string, a: string): void {
  const origen = dentroDelProyecto(nombre, de);
  const destino = dentroDelProyecto(nombre, a);
  if (!existsSync(origen)) throw new Error("No existe ese archivo.");
  if (existsSync(destino)) throw new Error("Ya hay un archivo con ese nombre.");
  mkdirSync(path.dirname(destino), { recursive: true });
  renameSync(origen, destino);
}
export function borrar(nombre: string, ruta: string): void {
  const abs = dentroDelProyecto(nombre, ruta);
  if (abs === carpetaProyecto(nombre)) throw new Error("Para borrar el proyecto entero usá «Borrar proyecto».");
  if (!existsSync(abs)) return;
  if (statSync(abs).isFile()) guardarVersion(abs);
  else for (const f of archivosDeTexto(abs)) guardarVersion(f);
  rmSync(abs, { recursive: true, force: true });
}
export function borrarProyecto(nombre: string): void {
  const dir = carpetaProyecto(nombre);
  if (!existsSync(dir)) return;
  // No se borra de verdad: queda en codigo/.papelera/ por si te arrepentís.
  const papelera = path.join(RAIZ(), ".papelera");
  mkdirSync(papelera, { recursive: true });
  renameSync(dir, path.join(papelera, `${nombre}-${Date.now()}`));
}

// ---- Terminal del proyecto: comandos que corre el usuario ----

export interface Ejecucion {
  id: string;
  proyecto: string;
  comando: string;
  aislado: boolean;
  inicio: string;
  estado: "corriendo" | "ok" | "error" | "cortado";
  codigo: number | null;
  salida: string;
  segundos: number | null;
  sinRed?: boolean;
}
const ejecuciones: Ejecucion[] = [];
const detenedores = new Map<string, () => void>();
export const listarEjecuciones = (proyecto?: string) => ejecuciones.filter((e) => !proyecto || e.proyecto === proyecto).slice(-30).reverse();

/**
 * Corre un comando del usuario en la carpeta del proyecto (o en una copia aislada). El estado queda
 * registrado: corriendo → ok / error / cortado, con la salida real.
 */
export function ejecutarEnProyecto(nombre: string, comando: string, aislado: boolean, alTerminar?: (e: Ejecucion) => void): Ejecucion {
  const dir = carpetaProyecto(nombre);
  if (!existsSync(dir)) throw new Error("No existe ese proyecto.");
  if (!comando.trim()) throw new Error("Escribí un comando.");
  const e: Ejecucion = { id: nuevoId(), proyecto: nombre, comando: comando.slice(0, 2000), aislado, inicio: new Date().toISOString(), estado: "corriendo", codigo: null, salida: "", segundos: null };
  ejecuciones.push(e);
  if (ejecuciones.length > 200) ejecuciones.splice(0, ejecuciones.length - 200);
  const cerrar = (r: Pick<ResultadoAislado, "codigo" | "salida" | "segundos" | "cortadoPorTiempo"> & { sinRed?: boolean }) => {
    Object.assign(e, { codigo: r.codigo, salida: r.salida, segundos: r.segundos, estado: r.cortadoPorTiempo ? "cortado" : r.codigo === 0 ? "ok" : "error", sinRed: r.sinRed });
    detenedores.delete(e.id);
    alTerminar?.(e);
  };
  if (aislado) {
    const control = new AbortController();
    detenedores.set(e.id, () => control.abort());
    ejecutarAislado(path.relative(COMPUTADORA, dir), comando, { timeoutMs: 300_000, signal: control.signal })
      .then(cerrar)
      .catch((err) => cerrar({ codigo: -1, salida: String((err as Error).message), segundos: 0, cortadoPorTiempo: false }));
    return e;
  }
  const env: NodeJS.ProcessEnv = Object.fromEntries(VARIABLES_PERMITIDAS.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const inicio = Date.now();
  const p = spawn(SHELL, ["-c", comando], { cwd: dir, env });
  let salida = "";
  let cortado = false;
  const sumar = (d: Buffer) => { if (salida.length < 60_000) salida += d.toString(); e.salida = salida; };
  p.stdout.on("data", sumar);
  p.stderr.on("data", sumar);
  const reloj = setTimeout(() => { cortado = true; p.kill("SIGKILL"); }, 300_000);
  detenedores.set(e.id, () => { cortado = true; p.kill("SIGKILL"); });
  p.on("error", (err) => { clearTimeout(reloj); cerrar({ codigo: -1, salida: `${salida}\n${err.message}`, segundos: (Date.now() - inicio) / 1000, cortadoPorTiempo: false }); });
  p.on("close", (codigo) => { clearTimeout(reloj); cerrar({ codigo, salida, segundos: Math.round((Date.now() - inicio) / 100) / 10, cortadoPorTiempo: cortado }); });
  return e;
}
/** Corta un comando que sigue corriendo. Devuelve false si ya había terminado. */
export function detenerEjecucion(id: string): boolean {
  const parar = detenedores.get(id);
  if (!parar) return false;
  parar();
  return true;
}
