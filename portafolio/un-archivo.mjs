// Genera una versión del portafolio en un solo archivo HTML: capturas, fuentes
// y juegos van adentro, así se puede mandar o abrir con doble clic sin carpetas.
//
//   node portafolio/un-archivo.mjs [salida.html]
//
// - Las capturas se guardan una sola vez (en un objeto JS y en variables CSS) y
//   se asignan al cargar; en este archivo no hay srcset: va la versión grande.
// - Las fuentes de portafolio/fuentes/ se incrustan como data: URI.
// - Cada juego que ya es de un solo archivo (sin <script src> ni CSS relativos)
//   se guarda comprimido con gzip y se descomprime al tocar Jugar
//   (DecompressionStream: Chrome 80+, Safari 16.4+, Firefox 113+).
// Usa solo módulos de Node, sin dependencias.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const salida = process.argv[2] || join(raiz, "portafolio-completo.html");
let html = readFileSync(join(raiz, "index.html"), "utf8");

const b64 = (ruta) => readFileSync(ruta).toString("base64");
const tipos = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", woff2: "font/woff2", woff: "font/woff" };
const dataUri = (ruta) => `data:${tipos[ruta.split(".").pop()] || "application/octet-stream"};base64,${b64(ruta)}`;

// 1. Capturas. En un solo archivo no conviene repetir cada imagen por tamaño,
//    así que se sacan los srcset y se usa la versión grande.
html = html.replace(/<link\b[^>]*rel="preload"[^>]*href="capturas\/[^"]*"[^>]*>\s*/g, "");
html = html.replace(/\s(?:srcset|sizes|imagesrcset|imagesizes)="[^"]*"/g, "");
html = html.replace(/`capturas\/\$\{(\w+)\}-640\.webp 640w, capturas\/\$\{\1\}\.webp 1280w`/g, '""');
html = html.replace(/capturas\/\$\{([^}]+)\}(-640)?\.webp/g, '${__cap($1)}');

const usadas = new Set();
const capturas = existsSync(join(raiz, "capturas")) ? readdirSync(join(raiz, "capturas")).filter((f) => !/-640\.webp$/.test(f)) : [];
// Las que se arman con ${...} en el JS pueden ser cualquiera: van todas.
const dinamicas = html.includes("__cap(");
for (const f of capturas) if (dinamicas) usadas.add(f.replace(/\.\w+$/, ""));

html = html.replace(/url\((["']?)capturas\/([\w-]+)\.webp\1\)/g, (_, _c, n) => (usadas.add(n), `var(--cap-${n})`));
html = html.replace(/(<img\b[^>]*?)\ssrc="capturas\/([\w-]+?)(?:-640)?\.webp"/g, (_, ini, n) => (usadas.add(n), `${ini} src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-cap="${n}"`));
html = html.replace(/(["'])capturas\/([\w-]+?)(?:-640)?\.webp\1/g, (_, c, n) => (usadas.add(n), `${c}#cap-${n}${c}`));

const mapa = {};
for (const n of usadas) {
  const ruta = join(raiz, "capturas", `${n}.webp`);
  if (existsSync(ruta)) mapa[n] = dataUri(ruta);
}
const varsCss = Object.entries(mapa).map(([n, u]) => `--cap-${n}:url("${u}")`).join(";");
const cabeza = `<style>:root{${varsCss}}</style>
<script>window.__capturas=${JSON.stringify(mapa)};window.__cap=function(n){return window.__capturas[n]||""};</script>`;
const asignar = `<script>(function(){
  function poner(raizDom){
    raizDom.querySelectorAll("img[data-cap]").forEach(function(img){var u=window.__cap(img.dataset.cap);if(u){img.src=u;img.removeAttribute("data-cap");}});
    raizDom.querySelectorAll("[src^='#cap-'],[href^='#cap-']").forEach(function(el){["src","href"].forEach(function(a){var v=el.getAttribute(a);if(v&&v.indexOf("#cap-")===0)el.setAttribute(a,window.__cap(v.slice(5)));});});
  }
  poner(document);
  new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeType===1){poner(n.parentNode||n);}});});}).observe(document.documentElement,{childList:true,subtree:true});
})();</script>`;

// 2. Fuentes locales.
html = html.replace(/url\((["']?)(?:\.\/)?fuentes\/([^)"']+)\1\)/g, (m, _c, f) => {
  const ruta = join(raiz, "fuentes", f);
  return existsSync(ruta) ? `url("${dataUri(ruta)}")` : m;
});
html = html.replace(/<link\b[^>]*rel="preload"[^>]*href="(?:\.\/)?fuentes\/[^"]*"[^>]*>\s*/g, "");

// 3. Juegos de un solo archivo.
const relativo = (u) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);
function esUnico(texto) {
  for (const m of texto.matchAll(/<script\b[^>]*\ssrc=["']([^"']+)["']/gi)) if (relativo(m[1])) return false;
  for (const m of texto.matchAll(/<link\b[^>]*rel=["']?(?:stylesheet|modulepreload)["']?[^>]*>/gi)) {
    const h = m[0].match(/href=["']([^"']+)["']/i);
    if (h && relativo(h[1])) return false;
  }
  return true;
}
const juegos = [];
const dirJuegos = join(raiz, "juegos");
if (existsSync(dirJuegos)) {
  for (const id of readdirSync(dirJuegos).sort()) {
    const ruta = join(dirJuegos, id, "index.html");
    if (!existsSync(ruta)) continue;
    const texto = readFileSync(ruta, "utf8");
    if (!esUnico(texto)) { console.log(`  ${id}: tiene archivos aparte, queda afuera`); continue; }
    juegos.push(`<script type="application/gzip" id="juego-${id}">${gzipSync(texto, { level: 9 }).toString("base64")}</script>`);
    console.log(`  ${id}: incluido`);
  }
}
const lanzador = `<script>(function(){
  var AVISO='<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#000;color:#f5f5f7;font:17px/1.5 -apple-system,system-ui,sans-serif;text-align:center;padding:24px"><p>Este juego todavía no viene dentro de este archivo.<br>Lo vas a poder jugar en la próxima versión.</p>';
  var re=/(?:^|\\/)juegos\\/([a-z0-9-]+)\\/index\\.html(?:[?#].*)?$/, cache={};
  function datos(id){return document.getElementById("juego-"+id);}
  function urlDe(id){
    if(cache[id])return cache[id];
    var bin=Uint8Array.from(atob(datos(id).textContent.trim()),function(c){return c.charCodeAt(0);});
    return cache[id]=new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      .then(function(t){return URL.createObjectURL(new Blob([t],{type:"text/html"}));});
  }
  var d=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,"src");
  Object.defineProperty(HTMLIFrameElement.prototype,"src",{configurable:true,enumerable:d.enumerable,
    get:function(){return d.get.call(this);},
    set:function(v){
      var tk=this.__tk=(this.__tk||0)+1, m=String(v).match(re), self=this;
      if(m&&!datos(m[1])){this.srcdoc=AVISO;return;}
      if(m)this.removeAttribute("srcdoc");
      if(!m||!datos(m[1])||typeof DecompressionStream==="undefined")return d.set.call(this,v);
      d.set.call(this,"about:blank");
      urlDe(m[1]).then(function(u){if(self.__tk===tk)d.set.call(self,u);});
    }});
  document.addEventListener("click",function(e){
    var a=e.target.closest&&e.target.closest("a[href]"); if(!a)return;
    var m=(a.getAttribute("href")||"").match(re); if(!m||!datos(m[1])||typeof DecompressionStream==="undefined")return;
    var mod=e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button===1;
    if(a.hasAttribute("data-jugar")&&!mod)return;
    e.preventDefault();
    var w=window.open("","_blank");
    urlDe(m[1]).then(function(u){if(w)w.location.href=u;else location.href=u;});
  },true);
})();</script>`;

// 4. Armar.
if (!/<\/head>/i.test(html) || !/<\/body>/i.test(html)) throw new Error("index.html necesita <head> y <body>");
html = html.replace(/<\/head>/i, `${cabeza}\n${lanzador}\n</head>`);
html = html.replace(/<\/body>/i, `${juegos.join("\n")}\n${asignar}\n</body>`);
writeFileSync(salida, html);
console.log(`${salida}: ${(Buffer.byteLength(html) / 1048576).toFixed(1)} MB, ${Object.keys(mapa).length} capturas, ${juegos.length} juegos`);
