import os from "node:os";
import { statfs } from "node:fs/promises";
import { CIUDAD, PAIS } from "./config.ts";

// Datos para el panel y para las herramientas: sistema, clima y noticias. Todo gratis y sin claves.

const MINUTOS_CACHE = 15;
const cache = new Map<string, { valor: unknown; vence: number }>();

async function conCache<T>(clave: string, obtener: () => Promise<T>): Promise<T> {
  const guardado = cache.get(clave);
  if (guardado && guardado.vence > Date.now()) return guardado.valor as T;
  const valor = await obtener();
  cache.set(clave, { valor, vence: Date.now() + MINUTOS_CACHE * 60_000 });
  return valor;
}

async function pedirJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Jarvis/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).host}`);
  return (await res.json()) as T;
}

// ---------- Sistema ----------

let cpuAnterior = os.cpus().map((c) => c.times);

function usoCpu(): number {
  const actual = os.cpus().map((c) => c.times);
  let ocupado = 0;
  let total = 0;
  actual.forEach((t, i) => {
    const a = cpuAnterior[i] ?? t;
    const dTotal = t.user + t.nice + t.sys + t.idle + t.irq - (a.user + a.nice + a.sys + a.idle + a.irq);
    total += dTotal;
    ocupado += dTotal - (t.idle - a.idle);
  });
  cpuAnterior = actual;
  return total > 0 ? Math.round((ocupado / total) * 100) : 0;
}

function ipLocal(): string {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const i of interfaces ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return "127.0.0.1";
}

export async function sistema() {
  const raiz = process.platform === "win32" ? "C:\\" : "/";
  let disco = { total: 0, libre: 0 };
  try {
    const s = await statfs(raiz);
    disco = { total: s.blocks * s.bsize, libre: s.bavail * s.bsize };
  } catch {}
  return {
    cpu: usoCpu(),
    nucleos: os.cpus().length,
    ram: { total: os.totalmem(), libre: os.freemem() },
    disco: { unidad: raiz, ...disco },
    encendidoSeg: Math.round(os.uptime()),
    equipo: os.hostname(),
    ip: ipLocal(),
    plataforma: `${os.type()} ${os.release()}`,
  };
}

// ---------- Ubicación y clima (Open-Meteo) ----------

interface Ubicacion {
  nombre: string;
  latitud: number;
  longitud: number;
}

async function ubicar(ciudad: string): Promise<Ubicacion> {
  if (ciudad) {
    const r = await pedirJson<{ results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=${encodeURIComponent(ciudad)}`,
    );
    const lugar = r.results?.[0];
    if (!lugar) throw new Error(`No encontré la ciudad "${ciudad}".`);
    return {
      nombre: [lugar.name, lugar.admin1, lugar.country].filter(Boolean).join(", "),
      latitud: lugar.latitude,
      longitud: lugar.longitude,
    };
  }
  // Sin ciudad configurada, se estima por la IP.
  const r = await pedirJson<{ success?: boolean; city?: string; region?: string; country?: string; latitude?: number; longitude?: number }>(
    "https://ipwho.is/?lang=es",
  );
  if (!r.success || r.latitude === undefined || r.longitude === undefined) throw new Error("No pude ubicarte. Poné JARVIS_CIUDAD en el .env.");
  return { nombre: [r.city, r.region, r.country].filter(Boolean).join(", "), latitud: r.latitude, longitud: r.longitude };
}

const CODIGOS_CLIMA: Record<number, [string, string]> = {
  0: ["Despejado", "sol"],
  1: ["Mayormente despejado", "sol"],
  2: ["Parcialmente nublado", "parcial"],
  3: ["Nublado", "nube"],
  45: ["Niebla", "niebla"],
  48: ["Niebla con escarcha", "niebla"],
  51: ["Llovizna leve", "llovizna"],
  53: ["Llovizna", "llovizna"],
  55: ["Llovizna intensa", "llovizna"],
  56: ["Llovizna helada", "llovizna"],
  57: ["Llovizna helada intensa", "llovizna"],
  61: ["Lluvia leve", "lluvia"],
  63: ["Lluvia", "lluvia"],
  65: ["Lluvia fuerte", "lluvia"],
  66: ["Lluvia helada", "lluvia"],
  67: ["Lluvia helada fuerte", "lluvia"],
  71: ["Nevada leve", "nieve"],
  73: ["Nevada", "nieve"],
  75: ["Nevada fuerte", "nieve"],
  77: ["Granizo fino", "nieve"],
  80: ["Chaparrones leves", "lluvia"],
  81: ["Chaparrones", "lluvia"],
  82: ["Chaparrones fuertes", "lluvia"],
  85: ["Chaparrones de nieve", "nieve"],
  86: ["Chaparrones de nieve fuertes", "nieve"],
  95: ["Tormenta", "tormenta"],
  96: ["Tormenta con granizo", "tormenta"],
  99: ["Tormenta fuerte con granizo", "tormenta"],
};

function describir(codigo: number): { estado: string; icono: string } {
  const [estado, icono] = CODIGOS_CLIMA[codigo] ?? ["—", "nube"];
  return { estado, icono };
}

export async function clima(ciudad = CIUDAD) {
  return conCache(`clima|${ciudad.toLowerCase()}`, async () => {
    const lugar = await ubicar(ciudad);
    const r = await pedirJson<{
      current: Record<string, number>;
      daily: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: (number | null)[];
        sunrise: string[];
        sunset: string[];
      };
    }>(
      "https://api.open-meteo.com/v1/forecast?timezone=auto&forecast_days=7" +
        `&latitude=${lugar.latitud}&longitude=${lugar.longitud}` +
        "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    );
    const c = r.current;
    return {
      lugar: lugar.nombre,
      actualizado: new Date().toISOString(),
      actual: {
        temperatura: Math.round(c.temperature_2m),
        sensacion: Math.round(c.apparent_temperature),
        humedad: Math.round(c.relative_humidity_2m),
        precipitacion: c.precipitation,
        viento: Math.round(c.wind_speed_10m),
        esDeDia: c.is_day === 1,
        ...describir(c.weather_code),
      },
      salidaSol: r.daily.sunrise[0]?.slice(11) ?? "",
      puestaSol: r.daily.sunset[0]?.slice(11) ?? "",
      dias: r.daily.time.map((fecha, i) => ({
        fecha,
        maxima: Math.round(r.daily.temperature_2m_max[i]),
        minima: Math.round(r.daily.temperature_2m_min[i]),
        lluvia: r.daily.precipitation_probability_max[i] ?? 0,
        ...describir(r.daily.weather_code[i]),
      })),
    };
  });
}

// ---------- Noticias (RSS de Google Noticias) ----------

function decodificar(texto: string): string {
  return texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

export interface Noticia {
  titulo: string;
  fuente: string;
  url: string;
  fecha: string;
}

export async function noticias(tema = "", cantidad = 10): Promise<Noticia[]> {
  const region = `hl=es-419&gl=${PAIS}&ceid=${PAIS}:es-419`;
  const url = tema
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(tema)}&${region}`
    : `https://news.google.com/rss?${region}`;
  const lista = await conCache(`noticias|${tema.toLowerCase()}`, async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Mozilla/5.0 Jarvis" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} en Google Noticias`);
    const xml = await res.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
      const campo = (nombre: string) => decodificar(item.match(new RegExp(`<${nombre}[^>]*>([\\s\\S]*?)</${nombre}>`))?.[1] ?? "");
      const fuente = campo("source");
      let titulo = campo("title");
      if (fuente && titulo.endsWith(` - ${fuente}`)) titulo = titulo.slice(0, -fuente.length - 3);
      const fecha = Date.parse(campo("pubDate"));
      return { titulo, fuente, url: campo("link"), fecha: Number.isNaN(fecha) ? "" : new Date(fecha).toISOString() };
    });
  });
  return lista.slice(0, cantidad);
}
