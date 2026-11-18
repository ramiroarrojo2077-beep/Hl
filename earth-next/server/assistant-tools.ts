/**
 * Herramientas del asistente geográfico.
 *  - "datos": se ejecutan en el servidor y devuelven información con su fuente.
 *  - "acciones": controlan el globo del usuario; el servidor las reenvía al navegador
 *    (evento SSE "action") y confirma al modelo que fueron enviadas.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { inverse, pathLength, polygonArea } from "../src/geo/geodesy.ts";
import { sunTimes, sunPosition, moonIllumination, moonPosition } from "../src/geo/astronomy.ts";
import { elevations, geocode, nearbyPlaces, ranking, reverseGeocode, weatherAt, wikipedia, type Source } from "./geodata.ts";

type Tool = Anthropic.Beta.BetaTool;

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const point = z.object({ lat, lon });

const LAYER_IDS = [
  "esri-imagery",
  "bluemarble",
  "viirs-today",
  "osm",
  "esri-topo",
  "esri-physical",
  "esri-natgeo",
  "labels",
  "transport",
  "osm-reference",
  "night-lights",
  "clouds-observed",
  "imerg",
  "airs-temp",
  "sst",
  "population",
  "landcover",
  "relief",
  "transport-infra",
] as const;

// ------------------------------------------------------------------ Esquemas (validación de entradas)

export const SCHEMAS = {
  geocode: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(10).optional() }),
  reverse_geocode: z.object({ lat, lon }),
  elevation: z.object({ points: z.array(point).min(1).max(50) }),
  measure: z.object({ points: z.array(point).min(2).max(200), closed: z.boolean().optional() }),
  sun_and_moon: z.object({ lat, lon, datetime: z.string().optional() }),
  weather: z.object({ lat, lon }),
  wikipedia: z.object({ query: z.string().min(1).max(200), lang: z.string().max(5).optional() }),
  ranking: z.object({ kind: z.enum(["tallest_buildings", "highest_peaks", "largest_cities"]), country: z.string().min(2).max(80), limit: z.number().int().min(1).max(20).optional() }),
  nearby_places: z.object({ lat, lon, radius_m: z.number().min(50).max(5000).optional(), osm_key: z.string().max(30).optional() }),
  // acciones
  fly_to: z.object({ lat, lon, height_m: z.number().min(2).max(60_000_000).optional(), heading: z.number().optional(), pitch: z.number().min(-90).max(0).optional(), cinematic: z.boolean().optional(), label: z.string().max(120).optional() }),
  view_from_space: z.object({ lat: lat.optional(), lon: lon.optional() }),
  set_scene_time: z.object({
    iso_datetime: z.string().optional(),
    preset: z.enum(["now", "sunrise", "noon", "sunset", "night"]).optional(),
    animate_day: z.boolean().optional(),
    speed_multiplier: z.number().min(0).max(1_000_000).optional(),
  }),
  set_layers: z.object({ base: z.enum(LAYER_IDS).optional(), enable: z.array(z.enum(LAYER_IDS)).optional(), disable: z.array(z.enum(LAYER_IDS)).optional() }),
  compare_imagery: z.object({ source: z.enum(["wayback", "hist-landsat", "hist-modis", "hist-hls", "landcover"]), date: z.string().regex(/^\d{4}(-\d{2}-\d{2})?$/) }),
  show_markers: z.object({ markers: z.array(z.object({ lat, lon, label: z.string().max(120), description: z.string().max(400).optional() })).min(1).max(40), fit_view: z.boolean().optional() }),
  draw_path: z.object({ points: z.array(point).min(2).max(200), label: z.string().max(120), closed: z.boolean().optional() }),
  play_tour: z.object({
    stops: z.array(z.object({ lat, lon, height_m: z.number().min(10).max(40_000_000).optional(), label: z.string().max(120), narration: z.string().max(600).optional(), hold_s: z.number().min(0).max(30).optional() })).min(1).max(12),
  }),
  set_navigation_mode: z.object({ mode: z.enum(["orbital", "aerial", "drone", "pedestrian", "satellite"]) }),
  open_street_level: z.object({ lat, lon }),
  weather_layers: z.object({ radar: z.boolean().optional(), stations: z.boolean().optional(), wind: z.boolean().optional(), storms: z.boolean().optional() }),
  narrate: z.object({ text: z.string().min(1).max(1500) }),
} as const;

export type ToolName = keyof typeof SCHEMAS;

export const ACTION_TOOLS = new Set<ToolName>([
  "fly_to",
  "view_from_space",
  "set_scene_time",
  "set_layers",
  "compare_imagery",
  "show_markers",
  "draw_path",
  "play_tour",
  "set_navigation_mode",
  "open_street_level",
  "weather_layers",
  "narrate",
]);

// ------------------------------------------------------------------ Definiciones para la API

const P = {
  lat: { type: "number", description: "Latitud WGS84 en grados decimales" },
  lon: { type: "number", description: "Longitud WGS84 en grados decimales" },
};
const pointSchema = { type: "object", properties: P, required: ["lat", "lon"], additionalProperties: false };

function tool(name: ToolName, description: string, properties: Record<string, unknown>, required: string[] = []): Tool {
  return {
    name,
    description,
    eager_input_streaming: true,
    input_schema: { type: "object", properties, required, additionalProperties: false } as Tool["input_schema"],
  };
}

export const TOOL_DEFINITIONS: Tool[] = [
  tool("geocode", "Busca lugares por nombre (OpenStreetMap/Nominatim) y devuelve coordenadas, tipo y bbox. Usala antes de mover la cámara a un lugar nombrado; nunca adivines coordenadas.", { query: { type: "string" }, limit: { type: "integer" } }, ["query"]),
  tool("reverse_geocode", "Devuelve la dirección/lugar en unas coordenadas (OpenStreetMap).", P, ["lat", "lon"]),
  tool("elevation", "Altura del terreno (m sobre el nivel del mar) en uno o más puntos, desde modelos digitales de elevación abiertos (SRTM/ETOPO1).", { points: { type: "array", items: pointSchema } }, ["points"]),
  tool("measure", "Calcula distancias geodésicas exactas (elipsoide WGS84) a lo largo de puntos, rumbo inicial y, si closed=true, superficie y perímetro.", { points: { type: "array", items: pointSchema }, closed: { type: "boolean" } }, ["points"]),
  tool("sun_and_moon", "Posición del Sol y la Luna, salida/puesta del Sol, duración del día y fase lunar para un lugar y fecha (UTC ISO 8601; por defecto, la hora de la escena).", { ...P, datetime: { type: "string" } }, ["lat", "lon"]),
  tool("weather", "Condiciones actuales y pronóstico de 3 días de modelos meteorológicos (Open-Meteo). Son datos de MODELO, no observaciones.", P, ["lat", "lon"]),
  tool("wikipedia", "Resumen de Wikipedia sobre un tema geográfico (montaña, ciudad, monumento, fenómeno). Útil para explicar la formación de accidentes geográficos.", { query: { type: "string" }, lang: { type: "string", description: "es, en, pt…" } }, ["query"]),
  tool("ranking", "Rankings con datos estructurados de Wikidata: edificios más altos, montañas más altas o ciudades más pobladas de un país.", { kind: { type: "string", enum: ["tallest_buildings", "highest_peaks", "largest_cities"] }, country: { type: "string" }, limit: { type: "integer" } }, ["kind", "country"]),
  tool("nearby_places", "Lugares de interés con nombre cerca de un punto (OpenStreetMap). osm_key opcional: tourism, historic, amenity, natural…", { ...P, radius_m: { type: "number" }, osm_key: { type: "string" } }, ["lat", "lon"]),
  tool("fly_to", "ACCIÓN: mueve la cámara del usuario a un punto. height_m es la altura de la cámara sobre el terreno (≈800 para un edificio, 3000 para un barrio, 40000 para una ciudad, 3000000 para un país). cinematic=true hace un vuelo con arco orbital.", { ...P, height_m: { type: "number" }, heading: { type: "number" }, pitch: { type: "number", description: "−90 vertical, −30 oblicuo" }, cinematic: { type: "boolean" }, label: { type: "string" } }, ["lat", "lon"]),
  tool("view_from_space", "ACCIÓN: muestra el planeta desde el espacio centrado en un punto (o en la vista actual).", P),
  tool("set_scene_time", "ACCIÓN: cambia la fecha/hora de la escena (iluminación solar, sombras, día/noche). preset: now, sunrise, noon, sunset, night (relativos a la ubicación de la cámara). animate_day=true acelera el tiempo para mostrar un día completo.", { iso_datetime: { type: "string" }, preset: { type: "string", enum: ["now", "sunrise", "noon", "sunset", "night"] }, animate_day: { type: "boolean" }, speed_multiplier: { type: "number" } }),
  tool("set_layers", `ACCIÓN: cambia el mapa base y activa/desactiva capas. IDs: ${LAYER_IDS.join(", ")}.`, { base: { type: "string", enum: [...LAYER_IDS] }, enable: { type: "array", items: { type: "string", enum: [...LAYER_IDS] } }, disable: { type: "array", items: { type: "string", enum: [...LAYER_IDS] } } }),
  tool("compare_imagery", "ACCIÓN: compara la zona actual con imágenes satelitales históricas REALES usando un divisor en pantalla. source: wayback (Esri, 2014→hoy, alta resolución), hist-landsat (1985–2000, 30 m), hist-modis (2000→hoy, 250 m), hist-hls (Sentinel-2 2015→hoy), landcover (cobertura del suelo 2001–2024). date: AAAA o AAAA-MM-DD.", { source: { type: "string", enum: ["wayback", "hist-landsat", "hist-modis", "hist-hls", "landcover"] }, date: { type: "string" } }, ["source", "date"]),
  tool("show_markers", "ACCIÓN: coloca marcadores rotulados en el globo (p. ej. resultados de un ranking) y opcionalmente encuadra la vista.", { markers: { type: "array", items: { type: "object", properties: { ...P, label: { type: "string" }, description: { type: "string" } }, required: ["lat", "lon", "label"], additionalProperties: false } }, fit_view: { type: "boolean" } }, ["markers"]),
  tool("draw_path", "ACCIÓN: dibuja una línea (o polígono si closed=true) sobre el terreno, p. ej. para mostrar una distancia medida.", { points: { type: "array", items: pointSchema }, label: { type: "string" }, closed: { type: "boolean" } }, ["points", "label"]),
  tool("play_tour", "ACCIÓN: reproduce un recorrido cinematográfico por varias paradas con narración opcional por voz.", { stops: { type: "array", items: { type: "object", properties: { ...P, height_m: { type: "number" }, label: { type: "string" }, narration: { type: "string" }, hold_s: { type: "number" } }, required: ["lat", "lon", "label"], additionalProperties: false } } }, ["stops"]),
  tool("set_navigation_mode", "ACCIÓN: cambia el modo de navegación: orbital, aerial (avión), drone, pedestrian (a nivel del suelo, vista 3D aproximada), satellite.", { mode: { type: "string", enum: ["orbital", "aerial", "drone", "pedestrian", "satellite"] } }, ["mode"]),
  tool("open_street_level", "ACCIÓN: abre fotos/panorámicas a nivel de calle con licencia abierta cerca de un punto; si no hay, una vista 3D aproximada rotulada.", P, ["lat", "lon"]),
  tool("weather_layers", "ACCIÓN: muestra capas meteorológicas: radar (observado), stations (METAR observadas), wind (modelo), storms (ciclones activos GDACS).", { radar: { type: "boolean" }, stations: { type: "boolean" }, wind: { type: "boolean" }, storms: { type: "boolean" } }),
  tool("narrate", "ACCIÓN: lee en voz alta un texto breve al usuario (narrador).", { text: { type: "string" } }, ["text"]),
];

// ------------------------------------------------------------------ Ejecución de herramientas de datos

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  sources: Source[];
}

const json = (v: unknown) => JSON.stringify(v);

export async function runDataTool(name: ToolName, input: unknown, ctx: { lang: string; sceneTime?: string }): Promise<ToolOutcome> {
  switch (name) {
    case "geocode": {
      const a = SCHEMAS.geocode.parse(input);
      const r = await geocode(a.query, ctx.lang, a.limit ?? 5);
      return { content: json(r.results.length ? r.results : { message: "Sin resultados" }), sources: [r.source] };
    }
    case "reverse_geocode": {
      const a = SCHEMAS.reverse_geocode.parse(input);
      const r = await reverseGeocode(a.lat, a.lon, ctx.lang);
      return { content: json(r.result ?? { message: "Sin dirección conocida (p. ej. océano)" }), sources: [r.source] };
    }
    case "elevation": {
      const a = SCHEMAS.elevation.parse(input);
      const r = await elevations(a.points);
      return { content: json(a.points.map((p, i) => ({ ...p, elevation_m: r.elevations[i] }))), sources: [r.source] };
    }
    case "measure": {
      const a = SCHEMAS.measure.parse(input);
      const segs = a.points.slice(1).map((p, i) => {
        const inv = inverse(a.points[i]!, p);
        return { distance_m: Math.round(inv.distance * 10) / 10, initial_bearing_deg: Math.round(inv.initialBearing * 10) / 10 };
      });
      const total = pathLength(a.points);
      const out: Record<string, unknown> = { total_distance_m: Math.round(total * 10) / 10, total_distance_km: Math.round(total) / 1000, segments: segs, method: "Vincenty sobre elipsoide WGS84" };
      if (a.closed && a.points.length >= 3) out["area_km2"] = Math.round(polygonArea(a.points) / 1e4) / 100;
      return { content: json(out), sources: [{ name: "Cálculo geodésico local (WGS84)" }] };
    }
    case "sun_and_moon": {
      const a = SCHEMAS.sun_and_moon.parse(input);
      const d = a.datetime ? new Date(a.datetime) : ctx.sceneTime ? new Date(ctx.sceneTime) : new Date();
      if (Number.isNaN(d.getTime())) throw new Error("Fecha inválida");
      const st = sunTimes(d, a.lat, a.lon);
      const sp = sunPosition(d, a.lat, a.lon);
      const mp = moonPosition(d, a.lat, a.lon);
      const mi = moonIllumination(d);
      return {
        content: json({
          datetime_utc: d.toISOString(),
          sun: { altitude_deg: +sp.altitude.toFixed(2), azimuth_deg: +sp.azimuth.toFixed(2), declination_deg: +sp.declination.toFixed(2) },
          sunrise_utc: st.sunrise?.toISOString() ?? null,
          sunset_utc: st.sunset?.toISOString() ?? null,
          solar_noon_utc: st.solarNoon.toISOString(),
          day_length_hours: +st.dayLengthHours.toFixed(2),
          regime: st.regime,
          moon: { altitude_deg: +mp.altitude.toFixed(2), azimuth_deg: +mp.azimuth.toFixed(2), illuminated_fraction: +mi.fraction.toFixed(3), phase: mi.name, distance_km: Math.round(mp.distanceKm) },
          note: "Horas en UTC; convertí a la hora local del lugar al responder.",
        }),
        sources: [{ name: "Algoritmos astronómicos NOAA / Meeus (cálculo local)" }],
      };
    }
    case "weather": {
      const a = SCHEMAS.weather.parse(input);
      const r = await weatherAt(a.lat, a.lon);
      return { content: json(r.data), sources: [r.source] };
    }
    case "wikipedia": {
      const a = SCHEMAS.wikipedia.parse(input);
      const r = await wikipedia(a.query, a.lang ?? ctx.lang);
      if (!r) return { content: json({ message: "Sin artículo encontrado" }), sources: [] };
      return { content: json(r), sources: [{ name: `Wikipedia — ${r.title}`, url: r.url, license: "CC BY-SA 4.0" }] };
    }
    case "ranking": {
      const a = SCHEMAS.ranking.parse(input);
      const r = await ranking(a.kind, a.country, ctx.lang, a.limit ?? 10);
      return { content: json(r), sources: [r.source] };
    }
    case "nearby_places": {
      const a = SCHEMAS.nearby_places.parse(input);
      const r = await nearbyPlaces(a.lat, a.lon, a.radius_m ?? 1000, a.osm_key);
      return { content: json(r.places.slice(0, 40)), sources: [r.source] };
    }
    default:
      throw new Error(`Herramienta desconocida: ${name}`);
  }
}
