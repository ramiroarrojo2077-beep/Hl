import http from "node:http";
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { buscarPrecio, ErrorBusqueda, type Resultado } from "./buscador.ts";
import { PAISES, buscarPais } from "./paises.ts";

const PUERTO = Number(process.env.PORT ?? 3000);
const MAX_LARGO_PRODUCTO = 200;
const DURACION_CACHE_MS = 6 * 60 * 60 * 1000;

const INDEX = new URL("../public/index.html", import.meta.url);

// Las búsquedas repetidas (mismo producto y país) se responden al instante.
const cache = new Map<string, { resultado: Resultado; vence: number }>();

function mensajeDeError(err: unknown): string {
  if (err instanceof ErrorBusqueda) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "Falta o es inválida la ANTHROPIC_API_KEY del servidor.";
  if (err instanceof Anthropic.RateLimitError) return "Demasiadas consultas seguidas. Probá en un minuto.";
  if (err instanceof Anthropic.APIConnectionError) return "No se pudo conectar con el servicio. Revisá la conexión.";
  if (err instanceof Anthropic.APIError) return `Error del servicio (${err.status ?? "sin código"}). Probá de nuevo.`;
  return "Error inesperado. Probá de nuevo.";
}

async function manejarBusqueda(url: URL, res: http.ServerResponse): Promise<void> {
  const producto = (url.searchParams.get("producto") ?? "").trim().slice(0, MAX_LARGO_PRODUCTO);
  const pais = buscarPais(url.searchParams.get("pais") ?? "");

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const enviar = (evento: string, datos: unknown) => {
    if (!res.writableEnded) res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
  };

  if (!producto || !pais) {
    enviar("error", { mensaje: "Indicá un producto y un país." });
    res.end();
    return;
  }

  const clave = `${pais.codigo}|${producto.toLowerCase()}`;
  const enCache = cache.get(clave);
  if (enCache && enCache.vence > Date.now()) {
    enviar("resultado", enCache.resultado);
    res.end();
    return;
  }

  // Si el usuario cierra la pestaña o cancela, se corta la consulta al modelo.
  const control = new AbortController();
  res.on("close", () => control.abort());

  enviar("progreso", { mensaje: `Buscando precio de fábrica de "${producto}"…` });
  try {
    const resultado = await buscarPrecio(producto, pais, (mensaje) => enviar("progreso", { mensaje }), control.signal);
    cache.set(clave, { resultado, vence: Date.now() + DURACION_CACHE_MS });
    enviar("resultado", resultado);
  } catch (err) {
    if (!control.signal.aborted) {
      console.error(err);
      enviar("error", { mensaje: mensajeDeError(err) });
    }
  }
  res.end();
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(INDEX);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } else if (req.method === "GET" && url.pathname === "/api/paises") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(PAISES.map(({ codigo, nombre, moneda }) => ({ codigo, nombre, moneda }))));
    } else if (req.method === "GET" && url.pathname === "/api/buscar") {
      await manejarBusqueda(url, res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Error interno");
  }
});

servidor.listen(PUERTO, () => {
  console.log(`Precio de fábrica: http://localhost:${PUERTO}`);
});
