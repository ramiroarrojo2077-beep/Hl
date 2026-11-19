/**
 * Meteorología con fuentes autorizadas, separando explícitamente:
 *  - OBSERVADO: METAR de estaciones (aviationweather.gov, NOAA), radar (RainViewer),
 *    satélite (NASA GIBS), ciclones activos (GDACS, UE/ONU).
 *  - MODELO / PRONÓSTICO: Open-Meteo (modelos ICON, GFS, ECMWF…; CC BY 4.0).
 *  - SIMULADO: efectos visuales (lluvia, nieve) generados en el cliente.
 */
import type { LonLat } from "../geo/coords.ts";
import { getJson } from "./http.ts";
import { apiUrl } from "./api.ts";
import { isNative, nativeGetJson } from "../native.ts";

export const WEATHER_SOURCES = {
  openMeteo: { name: "Open-Meteo (modelos meteorológicos nacionales)", url: "https://open-meteo.com", license: "CC BY 4.0" },
  metar: { name: "NOAA Aviation Weather Center (METAR)", url: "https://aviationweather.gov", license: "Dominio público (EE. UU.)" },
  rainviewer: { name: "RainViewer (radar)", url: "https://www.rainviewer.com/api.html", license: "Uso gratuito con atribución" },
  gdacs: { name: "GDACS (Comisión Europea / ONU)", url: "https://www.gdacs.org", license: "Uso libre con atribución" },
};

export interface CurrentWeather {
  time: string;
  temperature: number;
  apparent: number;
  humidity: number;
  precipitation: number;
  snowfall: number;
  weatherCode: number;
  cloudCover: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  isDay: boolean;
  elevation: number;
  timezone: string;
}

export interface DailyForecast {
  date: string;
  weatherCode: number;
  tMax: number;
  tMin: number;
  precipitation: number;
  precipitationProbability: number | null;
  windMax: number;
  sunrise: string;
  sunset: string;
}

export interface HourlyForecast {
  time: string[];
  temperature: number[];
  precipitation: number[];
  precipitationProbability: number[];
  cloudCover: number[];
  windSpeed: number[];
  pressure: number[];
  humidity: number[];
  snowfall: number[];
}

export interface PointForecast {
  location: LonLat;
  current: CurrentWeather;
  hourly: HourlyForecast;
  daily: DailyForecast[];
  /** Momento de generación del modelo */
  fetchedAt: string;
}

const CURRENT = "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day";
const HOURLY = "temperature_2m,precipitation,precipitation_probability,cloud_cover,wind_speed_10m,pressure_msl,relative_humidity_2m,snowfall";
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset";

interface OMResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  current: Record<string, number | string>;
  hourly: Record<string, (number | null)[] | string[]>;
  daily: Record<string, (number | null)[] | string[]>;
}

export async function forecastAt(p: LonLat, signal?: AbortSignal): Promise<PointForecast> {
  const params = new URLSearchParams({
    latitude: p.lat.toFixed(4),
    longitude: p.lon.toFixed(4),
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY,
    timezone: "auto",
    forecast_days: "7",
    wind_speed_unit: "kmh",
  });
  const r = await getJson<OMResponse>(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal,
    timeoutMs: 12000,
    cacheKey: `om:${params}`,
    cacheTtlMs: 15 * 60_000,
    staleOnError: true,
  });
  const c = r.current;
  const num = (v: unknown) => (typeof v === "number" ? v : Number.NaN);
  const arr = (k: string) => (r.hourly[k] ?? []).map((x) => (x === null ? Number.NaN : Number(x)));
  const darr = (k: string) => (r.daily[k] ?? []) as (number | null)[];
  return {
    location: { lon: r.longitude, lat: r.latitude },
    fetchedAt: new Date().toISOString(),
    current: {
      time: String(c["time"]),
      temperature: num(c["temperature_2m"]),
      apparent: num(c["apparent_temperature"]),
      humidity: num(c["relative_humidity_2m"]),
      precipitation: num(c["precipitation"]),
      snowfall: num(c["snowfall"]),
      weatherCode: num(c["weather_code"]),
      cloudCover: num(c["cloud_cover"]),
      pressure: num(c["pressure_msl"]),
      windSpeed: num(c["wind_speed_10m"]),
      windDirection: num(c["wind_direction_10m"]),
      windGusts: num(c["wind_gusts_10m"]),
      isDay: c["is_day"] === 1,
      elevation: r.elevation,
      timezone: r.timezone,
    },
    hourly: {
      time: (r.hourly["time"] ?? []) as string[],
      temperature: arr("temperature_2m"),
      precipitation: arr("precipitation"),
      precipitationProbability: arr("precipitation_probability"),
      cloudCover: arr("cloud_cover"),
      windSpeed: arr("wind_speed_10m"),
      pressure: arr("pressure_msl"),
      humidity: arr("relative_humidity_2m"),
      snowfall: arr("snowfall"),
    },
    daily: ((r.daily["time"] ?? []) as string[]).map((date, i) => ({
      date,
      weatherCode: Number(darr("weather_code")[i] ?? Number.NaN),
      tMax: Number(darr("temperature_2m_max")[i] ?? Number.NaN),
      tMin: Number(darr("temperature_2m_min")[i] ?? Number.NaN),
      precipitation: Number(darr("precipitation_sum")[i] ?? 0),
      precipitationProbability: darr("precipitation_probability_max")[i] ?? null,
      windMax: Number(darr("wind_speed_10m_max")[i] ?? Number.NaN),
      sunrise: String((r.daily["sunrise"] as string[] | undefined)?.[i] ?? ""),
      sunset: String((r.daily["sunset"] as string[] | undefined)?.[i] ?? ""),
    })),
  };
}

export interface GridSample extends LonLat {
  windSpeed: number;
  windDirection: number;
  temperature: number;
  cloudCover: number;
  precipitation: number;
  pressure: number;
}

/** Muestreo del modelo en una grilla (para flechas de viento / mapa de temperatura). */
export async function forecastGrid(bbox: { west: number; south: number; east: number; north: number }, cols = 8, rows = 6, signal?: AbortSignal): Promise<GridSample[]> {
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      lats.push(bbox.south + ((r + 0.5) / rows) * (bbox.north - bbox.south));
      let lon = bbox.west + ((c + 0.5) / cols) * (((bbox.east - bbox.west + 360) % 360) || 360);
      if (lon > 180) lon -= 360;
      lons.push(lon);
    }
  }
  const params = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(3)).join(","),
    longitude: lons.map((v) => v.toFixed(3)).join(","),
    current: "wind_speed_10m,wind_direction_10m,temperature_2m,cloud_cover,precipitation,pressure_msl",
    wind_speed_unit: "kmh",
  });
  const r = await getJson<OMResponse[] | OMResponse>(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal,
    timeoutMs: 15000,
    cacheKey: `omgrid:${params}`,
    cacheTtlMs: 15 * 60_000,
  });
  const list = Array.isArray(r) ? r : [r];
  return list.map((x, i) => ({
    lat: lats[i]!,
    lon: lons[i]!,
    windSpeed: Number(x.current["wind_speed_10m"]),
    windDirection: Number(x.current["wind_direction_10m"]),
    temperature: Number(x.current["temperature_2m"]),
    cloudCover: Number(x.current["cloud_cover"]),
    precipitation: Number(x.current["precipitation"]),
    pressure: Number(x.current["pressure_msl"]),
  }));
}

export interface Metar {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  observed: string;
  temperature: number | null;
  dewpoint: number | null;
  windDirection: number | null;
  windSpeedKt: number | null;
  visibility: string | null;
  pressureHpa: number | null;
  raw: string;
  flightCategory?: string;
  cover?: string;
}

/** Observaciones METAR (estaciones aeronáuticas) dentro de un bbox — vía el proxy del servidor (sin CORS). */
export async function metarsIn(bbox: { west: number; south: number; east: number; north: number }, signal?: AbortSignal): Promise<Metar[]> {
  const bb = [bbox.south, bbox.west, bbox.north, bbox.east].map((v) => v.toFixed(2)).join(",");
  const r = await getJson<
    { icaoId: string; name: string; lat: number; lon: number; reportTime: string; temp?: number; dewp?: number; wdir?: number | string; wspd?: number; visib?: string | number; altim?: number; rawOb: string; fltCat?: string; cover?: string }[]
  >(apiUrl(`/api/proxy/metar?bbox=${bb}`), { signal, timeoutMs: 15000, cacheKey: `metar:${bb}`, cacheTtlMs: 10 * 60_000 }).catch(async (err) => {
    // En la app Android sin servidor propio: consulta directa (la app nativa no tiene restricción CORS).
    if (!isNative) throw err;
    return nativeGetJson<{ icaoId: string; name: string; lat: number; lon: number; reportTime: string; temp?: number; dewp?: number; wdir?: number | string; wspd?: number; visib?: string | number; altim?: number; rawOb: string; fltCat?: string; cover?: string }[]>(
      `https://aviationweather.gov/api/data/metar?bbox=${bb}&format=json`,
    );
  });
  return r.map((m) => ({
    icao: m.icaoId,
    name: m.name,
    lat: m.lat,
    lon: m.lon,
    observed: m.reportTime,
    temperature: m.temp ?? null,
    dewpoint: m.dewp ?? null,
    windDirection: typeof m.wdir === "number" ? m.wdir : null,
    windSpeedKt: m.wspd ?? null,
    visibility: m.visib !== undefined ? String(m.visib) : null,
    pressureHpa: m.altim ?? null,
    raw: m.rawOb,
    flightCategory: m.fltCat,
    cover: m.cover,
  }));
}

export interface RadarFrame {
  time: number;
  path: string;
  kind: "past" | "nowcast";
}

export async function radarFrames(signal?: AbortSignal): Promise<{ host: string; frames: RadarFrame[] }> {
  const r = await getJson<{ host: string; radar: { past: { time: number; path: string }[]; nowcast?: { time: number; path: string }[] } }>(
    "https://api.rainviewer.com/public/weather-maps.json",
    { signal, timeoutMs: 10000, cacheKey: "rainviewer-maps", cacheTtlMs: 5 * 60_000 },
  );
  return {
    host: r.host,
    frames: [...r.radar.past.map((f) => ({ ...f, kind: "past" as const })), ...(r.radar.nowcast ?? []).map((f) => ({ ...f, kind: "nowcast" as const }))],
  };
}

export function radarTileUrl(host: string, frame: RadarFrame): string {
  return `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
}

export interface Storm {
  id: number;
  name: string;
  alertLevel: string;
  lon: number;
  lat: number;
  from: string;
  to: string;
  country?: string;
  url: string;
  severity?: string;
  /** true si GDACS lo marca como evento en curso */
  current: boolean;
}

/** Ciclones tropicales de GDACS (en curso y recientes). */
export async function activeStorms(signal?: AbortSignal): Promise<Storm[]> {
  const r = await getJson<{
    features: { geometry: { coordinates: [number, number] }; properties: { eventid: number; name: string; alertlevel: string; fromdate: string; todate: string; country?: string; iscurrent?: string | boolean; url?: { report?: string }; severitydata?: { severitytext?: string } } }[];
  }>("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC", { signal, timeoutMs: 15000, cacheKey: "gdacs-tc", cacheTtlMs: 30 * 60_000 });
  return r.features.map((f) => ({
    id: f.properties.eventid,
    name: f.properties.name,
    alertLevel: f.properties.alertlevel,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    from: f.properties.fromdate,
    to: f.properties.todate,
    country: f.properties.country,
    url: f.properties.url?.report ?? `https://www.gdacs.org/report.aspx?eventtype=TC&eventid=${f.properties.eventid}`,
    severity: f.properties.severitydata?.severitytext,
    current: f.properties.iscurrent === true || f.properties.iscurrent === "true",
  }));
}

/** Descripción de códigos WMO de tiempo presente (los que usa Open-Meteo). */
export function weatherCodeText(code: number, lang: "es" | "en" = "es"): { text: string; icon: string } {
  const es: Record<number, [string, string]> = {
    0: ["Despejado", "☀️"],
    1: ["Mayormente despejado", "🌤️"],
    2: ["Parcialmente nublado", "⛅"],
    3: ["Nublado", "☁️"],
    45: ["Niebla", "🌫️"],
    48: ["Niebla con escarcha", "🌫️"],
    51: ["Llovizna débil", "🌦️"],
    53: ["Llovizna", "🌦️"],
    55: ["Llovizna intensa", "🌧️"],
    56: ["Llovizna helada", "🌧️"],
    57: ["Llovizna helada intensa", "🌧️"],
    61: ["Lluvia débil", "🌦️"],
    63: ["Lluvia", "🌧️"],
    65: ["Lluvia intensa", "🌧️"],
    66: ["Lluvia helada", "🌧️"],
    67: ["Lluvia helada intensa", "🌧️"],
    71: ["Nevada débil", "🌨️"],
    73: ["Nevada", "🌨️"],
    75: ["Nevada intensa", "❄️"],
    77: ["Granos de nieve", "🌨️"],
    80: ["Chaparrones débiles", "🌦️"],
    81: ["Chaparrones", "🌧️"],
    82: ["Chaparrones violentos", "⛈️"],
    85: ["Chaparrones de nieve", "🌨️"],
    86: ["Chaparrones de nieve intensos", "❄️"],
    95: ["Tormenta", "⛈️"],
    96: ["Tormenta con granizo", "⛈️"],
    99: ["Tormenta con granizo fuerte", "⛈️"],
  };
  const en: Record<number, string> = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
    56: "Freezing drizzle", 57: "Dense freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Heavy freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers",
    86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm with hail",
  };
  const e = es[code];
  if (!e) return { text: lang === "es" ? "Sin datos" : "No data", icon: "❔" };
  return { text: lang === "es" ? e[0] : (en[code] ?? e[0]), icon: e[1] };
}

/** Precipitación visual simulada a partir del código de tiempo (para efectos de partículas). */
export function precipitationKind(code: number): "none" | "rain" | "snow" | "storm" {
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  if (code >= 51 && code <= 82) return "rain";
  return "none";
}
