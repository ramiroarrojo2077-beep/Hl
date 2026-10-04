// Copia el juego (carpeta arquero/) dentro del proyecto Android, en assets/www,
// con three.js incluido para que funcione sin internet.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const raiz = new URL("../", import.meta.url);
const destino = new URL("app/src/main/assets/www/", import.meta.url);
const CDN = "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js";

await rm(destino, { recursive: true, force: true });
await mkdir(new URL("vendor/", destino), { recursive: true });

const origen = fileURLToPath(new URL("arquero/", raiz));
await cp(origen, fileURLToPath(destino), {
  recursive: true,
  filter: (ruta) => !ruta.startsWith(`${origen}test`) && !ruta.startsWith(`${origen}sim`),
});
for (const archivo of ["three.module.js", "three.core.js"]) {
  await cp(new URL(`node_modules/three/build/${archivo}`, raiz), new URL(`vendor/${archivo}`, destino));
}

const index = new URL("index.html", destino);
const html = await readFile(index, "utf8");
if (!html.includes(CDN)) throw new Error(`index.html no carga three.js desde ${CDN}; actualizá preparar-web.mjs`);
// Sin internet las fuentes de Google no cargan: se usan las del sistema.
const sinFuentes = html.replace(/^\s*<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\n/gm, "");
await writeFile(index, sinFuentes.replace(CDN, "./vendor/three.module.js"));
console.log(`Juego copiado en ${fileURLToPath(destino)}`);
