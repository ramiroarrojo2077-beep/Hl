// Gravity Studio: el usuario describe una página o app web y el modelo la escribe en un solo archivo HTML
// (con su CSS y JS adentro) en computadora/studio/<nombre>/index.html. Se ve con la vista previa aislada
// y se itera: pedir cambios o arreglar los errores que la página reportó. Cada cambio guarda versión.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { COMPUTADORA } from "./almacen.ts";
import { client, MODELO, BETA_FALLBACK } from "./cliente.ts";
import { llamar } from "./cupo.ts";
import { registrarUso } from "./gasto.ts";
import { guardarVersion } from "./versiones.ts";

const RAIZ = path.join(COMPUTADORA, "studio");
const MAX_HTML = 400_000;

export const slugStudio = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";

export function listarStudio(): { nombre: string; ruta: string; modificado: string }[] {
  if (!existsSync(RAIZ)) return [];
  return readdirSync(RAIZ, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(RAIZ, d.name, "index.html")))
    .map((d) => ({ nombre: d.name, ruta: `studio/${d.name}/index.html`, modificado: statSync(path.join(RAIZ, d.name, "index.html")).mtime.toISOString() }))
    .sort((a, b) => b.modificado.localeCompare(a.modificado));
}

const SISTEMA = `Sos el programador de Gravity Studio. Escribís páginas y apps web completas en UN SOLO archivo HTML (CSS en <style>, JavaScript en <script>), sin dependencias externas ni CDNs (no hay internet en la vista previa), sin llamadas a APIs externas, que funcionen en el celular (diseño adaptable, botones de 44 px) y en la compu.
- Diseño prolijo y moderno, accesible (contraste, etiquetas, botones reales).
- Datos de ejemplo claramente marcados como ejemplo; si hace falta guardar algo, usá variables en memoria (localStorage puede no estar disponible).
- Respondé SOLO con el archivo completo, empezando por <!doctype html> y terminando en </html>, sin explicaciones ni bloques de markdown.`;

function extraerHtml(texto: string): string {
  const bloque = /```(?:html)?\s*([\s\S]*?)```/i.exec(texto)?.[1] ?? texto;
  const i = bloque.search(/<!doctype html|<html/i);
  const j = bloque.toLowerCase().lastIndexOf("</html>");
  if (i < 0 || j < 0) throw new Error("El modelo no devolvió una página completa. Probá de nuevo con una descripción más concreta.");
  return bloque.slice(i, j + 7);
}

/** Crea o cambia una app. Devuelve la ruta del index.html en la computadora. */
export async function generarStudio(d: { nombre: string; pedido: string; errores?: string[] | null }, signal: AbortSignal): Promise<{ ruta: string; nueva: boolean }> {
  const carpeta = path.join(RAIZ, slugStudio(d.nombre));
  const archivo = path.join(carpeta, "index.html");
  const actual = existsSync(archivo) ? readFileSync(archivo, "utf8") : null;
  const partes = actual
    ? [
        `Este es el archivo actual de «${d.nombre}»:\n<archivo>\n${actual.slice(0, MAX_HTML)}\n</archivo>`,
        d.errores?.length ? `La página tiró estos errores en el navegador:\n${d.errores.slice(0, 20).map((e) => `- ${e}`).join("\n")}\nArreglalos.` : "",
        d.pedido.trim() ? `Cambios pedidos: ${d.pedido.trim()}` : "",
        "Devolvé el archivo completo actualizado.",
      ]
    : [`Creá «${d.nombre}»: ${d.pedido.trim()}`];
  // Con streaming: una app completa puede ser una respuesta larga.
  const m = await llamar("studio", "usuario", signal, () =>
    client.beta.messages
      .stream(
        { model: MODELO, max_tokens: 32000, betas: [BETA_FALLBACK], fallbacks: "default", output_config: { effort: "medium" }, system: SISTEMA, messages: [{ role: "user", content: partes.filter(Boolean).join("\n\n") }] },
        { signal },
      )
      .finalMessage(),
  );
  registrarUso("studio", m);
  if (m.stop_reason === "max_tokens") throw new Error("La app quedó demasiado larga para una sola respuesta: pedí algo más acotado.");
  const texto = m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
  const html = extraerHtml(texto);
  if (html.length > MAX_HTML) throw new Error("La página generada es demasiado grande.");
  mkdirSync(carpeta, { recursive: true });
  if (actual) guardarVersion(archivo);
  writeFileSync(archivo, html);
  return { ruta: path.relative(COMPUTADORA, archivo).split(path.sep).join("/"), nueva: !actual };
}
