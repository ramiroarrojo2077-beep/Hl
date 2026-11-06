// Gravity Creative Studio: imágenes (generar y editar) y voces con Gemini; presentaciones, logos (SVG) y
// animaciones explicativas (HTML/SVG) con el modelo de siempre. Todo queda como archivo real en
// creativo/ de la computadora y se ve en la vista previa aislada. Las imágenes y voces de Gemini pueden
// tener costo según la cuenta: los botones los toca el usuario.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { COMPUTADORA } from "./almacen.ts";

const MODELO_IMAGEN = process.env.GRAVITY_GEMINI_IMAGEN ?? "gemini-2.5-flash-image";
const MODELO_VOZ = process.env.GRAVITY_GEMINI_VOZ ?? "gemini-2.5-flash-preview-tts";
export const VOCES_GEMINI = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "obra";

/** Guarda en creativo/<sub>/ sin pisar. Devuelve la ruta relativa a la computadora. */
export function guardar(sub: string, nombre: string, ext: string, datos: Buffer | string): string {
  const dir = path.join(COMPUTADORA, "creativo", sub);
  mkdirSync(dir, { recursive: true });
  let rel = `creativo/${sub}/${slug(nombre)}.${ext}`;
  for (let n = 2; existsSync(path.join(COMPUTADORA, rel)); n++) rel = `creativo/${sub}/${slug(nombre)}-${n}.${ext}`;
  writeFileSync(path.join(COMPUTADORA, rel), datos);
  return rel;
}

// ---- Gemini: imágenes y voces ----

async function gemini(modelo: string, cuerpo: Record<string, unknown>, signal: AbortSignal): Promise<{ parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }> {
  const P = await import("./proveedores.ts");
  if (!P.hayGemini) throw new Error("Para imágenes y voces hace falta la clave de Gemini (pantalla de claves de la app o GEMINI_API_KEY).");
  const r = await fetch(`${P.GEMINI_BASE}/models/${encodeURIComponent(modelo)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": P.CLAVE_GEMINI }, body: JSON.stringify(cuerpo), signal });
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string }; candidates?: { content?: { parts?: [] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  if (!r.ok) throw new Error(r.status === 429 ? "Gemini: se agotó el cupo o el modelo no está en tu plan (puede requerir facturación)." : `Gemini respondió ${r.status}: ${j.error?.message ?? ""}`.trim());
  if (j.promptFeedback?.blockReason) throw new Error(`Gemini no lo hizo (${j.promptFeedback.blockReason}).`);
  const c = j.candidates?.[0];
  return { parts: c?.content?.parts ?? [] };
}

export async function generarImagen(pedido: string, op: { base?: string | null; aspecto?: string }, signal: AbortSignal): Promise<{ rutas: string[]; texto: string }> {
  const partes: Record<string, unknown>[] = [{ text: pedido }];
  if (op.base) {
    const abs = path.resolve(COMPUTADORA, op.base);
    if (!abs.startsWith(COMPUTADORA + path.sep) || !existsSync(abs)) throw new Error("No existe la imagen a editar.");
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    partes.push({ inline_data: { mime_type: mime, data: readFileSync(abs).toString("base64") } });
  }
  const r = await gemini(MODELO_IMAGEN, { contents: [{ parts: partes }], generationConfig: { responseModalities: ["IMAGE", "TEXT"], ...(op.aspecto ? { imageConfig: { aspectRatio: op.aspecto } } : {}) } }, signal);
  const rutas = r.parts.filter((p) => p.inlineData?.mimeType?.startsWith("image/")).map((p, i) => guardar("imagenes", `${pedido.slice(0, 30)}${i ? `-${i + 1}` : ""}`, p.inlineData!.mimeType.split("/")[1]!.replace("jpeg", "jpg"), Buffer.from(p.inlineData!.data, "base64")));
  const texto = r.parts.map((p) => p.text ?? "").join(" ").trim();
  if (!rutas.length) throw new Error(texto || "Gemini no devolvió ninguna imagen.");
  return { rutas, texto };
}

/** WAV (PCM 16 bits mono) a partir de las muestras crudas que devuelve Gemini. */
export function wav(pcm: Buffer, frecuencia = 24_000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(frecuencia, 24); h.writeUInt32LE(frecuencia * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function generarVoz(texto: string, voz: string, estilo: string, signal: AbortSignal): Promise<string> {
  const nombre = VOCES_GEMINI.includes(voz) ? voz : "Kore";
  const r = await gemini(MODELO_VOZ, { contents: [{ parts: [{ text: estilo ? `${estilo}: ${texto}` : texto }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: nombre } } } } }, signal);
  const audio = r.parts.find((p) => p.inlineData?.mimeType?.startsWith("audio/"));
  if (!audio) throw new Error("Gemini no devolvió audio.");
  const tasa = Number(/rate=(\d+)/.exec(audio.inlineData!.mimeType)?.[1] ?? 24_000);
  const crudo = Buffer.from(audio.inlineData!.data, "base64");
  return guardar("voces", texto.slice(0, 30), "wav", /wav/.test(audio.inlineData!.mimeType) ? crudo : wav(crudo, tasa));
}

// ---- Con el modelo de siempre: presentaciones, logos y animaciones ----

async function pedirJson<T extends z.ZodType>(esquema: T, sistema: string, pedido: string, signal: AbortSignal, maxTokens = 12_000): Promise<z.infer<T>> {
  const { client, MODELO, BETA_FALLBACK } = await import("./cliente.ts");
  const { llamar } = await import("./cupo.ts");
  const { registrarUso } = await import("./gasto.ts");
  const { $schema: _, ...schema } = z.toJSONSchema(esquema, { reused: "inline" });
  const m = await llamar("creativo", "usuario", signal, () => client.beta.messages.stream({ model: MODELO, max_tokens: maxTokens, betas: [BETA_FALLBACK], fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema" as const, schema } }, system: sistema, messages: [{ role: "user", content: pedido }] }, { signal }).finalMessage());
  registrarUso("creativo", m);
  const texto = m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
  try { return esquema.parse(JSON.parse(texto)); } catch { throw new Error("La respuesta vino incompleta. Probá de nuevo."); }
}

export const Presentacion = z.object({
  titulo: z.string(), subtitulo: z.string(),
  diapositivas: z.array(z.object({ tipo: z.enum(["portada", "contenido", "cita", "numeros", "cierre"]), titulo: z.string(), puntos: z.array(z.string()).describe("Hasta 5 viñetas cortas (en numeros: «cifra — qué es»)"), nota: z.string().describe("Notas del orador") })).min(1).max(30),
});
export type Presentacion = z.infer<typeof Presentacion>;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** HTML de la presentación: autosuficiente, con flechas/toques para avanzar e impresión a PDF (una diapositiva por hoja). */
export function htmlPresentacion(p: Presentacion, acento = "#6CD3F0"): string {
  const diapo = (d: Presentacion["diapositivas"][number], i: number) => {
    const cuerpo = d.tipo === "numeros"
      ? `<div class="nums">${d.puntos.map((x) => { const [a, ...b] = x.split(/\s+[—-]\s+/); return `<div><b>${esc(a ?? "")}</b><span>${esc(b.join(" — "))}</span></div>`; }).join("")}</div>`
      : d.tipo === "cita" ? `<blockquote>${esc(d.puntos.join(" "))}</blockquote>` : d.puntos.length ? `<ul>${d.puntos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
    return `<section class="d ${d.tipo}" aria-label="Diapositiva ${i + 1}"><h${d.tipo === "portada" ? 1 : 2}>${esc(d.titulo)}</h${d.tipo === "portada" ? 1 : 2}>${d.tipo === "portada" ? `<p class="sub">${esc(p.subtitulo)}</p>` : ""}${cuerpo}<aside class="nota">${esc(d.nota)}</aside><footer>${i + 1} / ${p.diapositivas.length}</footer></section>`;
  };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.titulo)}</title><style>
:root{--a:${acento};--bg:#070a12;--tx:#e8ecf5;--tx2:#aab3c8}*{box-sizing:border-box}body{margin:0;background:#000;color:var(--tx);font-family:system-ui,sans-serif}
.d{display:none;position:fixed;inset:0;padding:6vh 7vw;background:radial-gradient(circle at 85% 10%,color-mix(in srgb,var(--a) 22%,transparent),transparent 45%),var(--bg);flex-direction:column;justify-content:center;gap:3vh}
.d.on{display:flex}h1{font-size:clamp(32px,6vw,72px);margin:0;line-height:1.05}h2{font-size:clamp(24px,4vw,48px);margin:0;border-left:6px solid var(--a);padding-left:16px}.sub{font-size:clamp(16px,2.4vw,26px);color:var(--tx2);margin:0}
ul{font-size:clamp(16px,2.4vw,28px);line-height:1.5;margin:0;padding-left:1.2em}li::marker{color:var(--a)}blockquote{font-size:clamp(20px,3.4vw,40px);font-style:italic;margin:0;color:var(--tx)}
.nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:3vw}.nums b{display:block;font-size:clamp(30px,5vw,64px);color:var(--a)}.nums span{color:var(--tx2);font-size:clamp(14px,1.8vw,20px)}
.portada,.cierre{justify-content:center}.nota{display:none}footer{position:absolute;right:4vw;bottom:3vh;color:var(--tx2);font-size:14px}
.ctl{position:fixed;bottom:2vh;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:2}.ctl button{background:#ffffff1a;color:var(--tx);border:1px solid #ffffff33;border-radius:999px;padding:8px 14px;font:inherit;cursor:pointer}
body.notas .nota{display:block;position:absolute;left:7vw;right:7vw;bottom:8vh;font-size:15px;color:var(--tx2);border-top:1px solid #ffffff22;padding-top:8px}
@media print{.ctl{display:none}.d{display:flex!important;position:relative;inset:auto;height:100vh;page-break-after:always}}
</style></head><body>${p.diapositivas.map(diapo).join("")}
<div class="ctl"><button id="a" aria-label="Anterior">‹</button><button id="n">Notas</button><button id="s" aria-label="Siguiente">›</button></div>
<script>let i=0;const d=[...document.querySelectorAll(".d")];const ir=(k)=>{i=Math.max(0,Math.min(d.length-1,k));d.forEach((x,j)=>x.classList.toggle("on",j===i));};ir(0);
document.getElementById("a").onclick=()=>ir(i-1);document.getElementById("s").onclick=()=>ir(i+1);document.getElementById("n").onclick=()=>document.body.classList.toggle("notas");
addEventListener("keydown",(e)=>{if(["ArrowRight"," ","PageDown"].includes(e.key))ir(i+1);if(["ArrowLeft","PageUp"].includes(e.key))ir(i-1);});
let x0=null;addEventListener("touchstart",(e)=>{x0=e.touches[0].clientX;});addEventListener("touchend",(e)=>{if(x0==null)return;const dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40)ir(i+(dx<0?1:-1));x0=null;});</script></body></html>`;
}

export async function crearPresentacion(tema: string, n: number, publico: string, acento: string, signal: AbortSignal): Promise<{ html: string; json: string }> {
  const p = await pedirJson(Presentacion, "Armás presentaciones claras y profesionales: una idea por diapositiva, viñetas cortas, datos solo si son conocidos o te los dieron (si no, decí que hay que completarlos), empezá con una portada y terminá con un cierre con próximos pasos. Escribí en el idioma del pedido.", `Tema: ${tema}\nPúblico: ${publico || "general"}\nCantidad de diapositivas: ${n}`, signal);
  const json = guardar("presentaciones", p.titulo, "json", JSON.stringify(p, null, 2));
  const html = guardar("presentaciones", p.titulo, "html", htmlPresentacion(p, acento));
  return { html, json };
}
/** Vuelve a armar el HTML desde el .json (editable a mano o por un compañero). */
export function rehacerPresentacion(rutaJson: string, acento = "#6CD3F0"): string {
  const abs = path.resolve(COMPUTADORA, rutaJson);
  if (!abs.startsWith(COMPUTADORA + path.sep) || !existsSync(abs)) throw new Error("No existe ese archivo.");
  const p = Presentacion.parse(JSON.parse(readFileSync(abs, "utf8")));
  const rel = rutaJson.replace(/\.json$/i, ".html");
  writeFileSync(path.join(COMPUTADORA, rel), htmlPresentacion(p, acento));
  return rel;
}

/** SVG sin scripts, eventos, objetos extraños ni enlaces externos. Devuelve null si no es un SVG. */
export function sanitizarSvg(svg: string): string | null {
  let s = svg.trim().replace(/^```(?:svg|xml)?\s*|```$/g, "").trim();
  const i = s.indexOf("<svg"), j = s.lastIndexOf("</svg>");
  if (i < 0 || j < i) return null;
  s = s.slice(i, j + 6);
  s = s.replace(/<!DOCTYPE[^>]*>|<!ENTITY[^>]*>/gi, "")
    .replace(/<(script|foreignObject|iframe|object|embed|audio|video)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|foreignObject|iframe|object|embed)[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href|src)\s*=\s*("|')\s*(?!#|data:image\/(png|jpeg|gif|webp);)[^"']*\2/gi, "")
    .replace(/url\(\s*['"]?\s*(?!#)[^)]*\)/gi, "none")
    .replace(/javascript:/gi, "");
  if (!/xmlns=/.test(s)) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

const Logos = z.object({ propuestas: z.array(z.object({ nombre: z.string().describe("Nombre corto de la propuesta"), idea: z.string().describe("Concepto en una oración"), svg: z.string().describe("SVG completo, viewBox 0 0 512 512, solo formas y texto, sin imágenes externas ni scripts") })).min(1).max(4) });

export async function crearLogos(marca: string, rubro: string, estilo: string, signal: AbortSignal): Promise<{ nombre: string; idea: string; ruta: string }[]> {
  const r = await pedirJson(Logos, "Sos diseñador de identidad visual. Proponés logos originales en SVG limpio (viewBox 0 0 512 512): formas geométricas simples, 2 o 3 colores, buena lectura en chico, el nombre de la marca con una fuente genérica (sans-serif o serif) si corresponde. Nada copiado de marcas existentes. Cada propuesta distinta en concepto.", `Marca: ${marca}\nRubro: ${rubro || "no dicho"}\nEstilo buscado: ${estilo || "moderno y profesional"}\nHacé 3 propuestas.`, signal, 16_000);
  const salida: { nombre: string; idea: string; ruta: string }[] = [];
  for (const p of r.propuestas) {
    const svg = sanitizarSvg(p.svg);
    if (svg) salida.push({ nombre: p.nombre, idea: p.idea, ruta: guardar("logos", `${marca}-${p.nombre}`, "svg", svg) });
  }
  if (!salida.length) throw new Error("Las propuestas no vinieron en SVG válido. Probá de nuevo.");
  return salida;
}

const Animacion = z.object({ titulo: z.string(), html: z.string().describe("Documento HTML completo y autosuficiente: SVG y CSS (animaciones con @keyframes), sin recursos externos ni fetch") });

export async function crearAnimacion(descripcion: string, signal: AbortSignal): Promise<string> {
  const r = await pedirJson(Animacion, "Hacés motion graphics explicativos como un único HTML autosuficiente: SVG + CSS con @keyframes (JavaScript solo si hace falta para la secuencia, sin pedir nada a internet). Texto grande y legible, colores sobrios, 10 a 30 segundos en bucle, que se vea bien en un celular. Respetá prefers-reduced-motion mostrando el estado final.", `Animación: ${descripcion}`, signal, 20_000);
  if (!/<html[\s>]/i.test(r.html) || /<(iframe|object|embed)/i.test(r.html) || /\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(r.html)) throw new Error("La animación no vino como un HTML autosuficiente. Probá de nuevo.");
  return guardar("animaciones", r.titulo, "html", r.html);
}
