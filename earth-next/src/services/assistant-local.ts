/**
 * Modo básico del asistente (sin IA): interpreta órdenes frecuentes en español e inglés
 * con reglas y resuelve con los mismos servicios de datos. Siempre indica las fuentes y
 * no inventa respuestas: si no entiende el pedido, lo dice.
 */
import { searchBest, reverse, type Place } from "./geocoder.ts";
import { inverse } from "../geo/geodesy.ts";
import { formatDistance, formatHours } from "../geo/format.ts";
import { sunTimes } from "../geo/astronomy.ts";
import { countryQid, tallestStructures, highestPeaks, largestCities } from "./knowledge.ts";
import { wikiSummary } from "./wiki.ts";
import { forecastAt, weatherCodeText } from "./weather.ts";
import { elevationAt } from "./elevation.ts";
import type { AssistantAction } from "../ui/assistant-actions.ts";
import type { Source } from "./assistant-types.ts";

export interface LocalReply {
  text: string;
  actions: AssistantAction[];
  sources: Source[];
}

const OSM: Source = { name: "OpenStreetMap (Nominatim/Photon)", url: "https://www.openstreetmap.org/copyright", license: "ODbL" };

function clean(s: string): string {
  return s
    .trim()
    .replace(/[¿?¡!.]+$/g, "")
    .trim();
}

/** Busca primero el nombre completo ("La Quiaca", "Los Ángeles") y, si no hay resultados, sin artículo ("el Obelisco"). */
async function place(q: string, lang: string): Promise<Place> {
  const full = clean(q);
  let r = await searchBest(full, { lang });
  const bare = full.replace(/^(el|la|los|las|the)\s+/i, "");
  if (!r[0] && bare !== full) r = await searchBest(bare, { lang });
  if (!r[0]) throw new Error(lang === "es" ? `No encontré "${full}".` : `I couldn't find "${full}".`);
  return r[0];
}

function heightFor(p: Place): number {
  if (p.bbox) {
    const span = Math.max(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]);
    return Math.min(9_000_000, Math.max(800, span * 111_000 * 1.6));
  }
  return 2000;
}

type Ctx = { lang: string; center: { lat: number; lon: number }; sceneTime: Date };

interface Rule {
  re: RegExp;
  run: (m: RegExpMatchArray, ctx: Ctx) => Promise<LocalReply>;
}

const RULES: Rule[] = [
  {
    re: /(?:mostr[aá]me|ver|show(?: me)?)\s+(.+?)\s+(?:desde el espacio|from space|desde la [oó]rbita)/i,
    run: async (m, ctx) => {
      const p = await place(m[1]!, ctx.lang);
      return {
        text: ctx.lang === "es" ? `Te muestro ${p.name} desde el espacio.` : `Showing ${p.name} from space.`,
        actions: [{ tool: "view_from_space", input: { lat: p.lat, lon: p.lon } }],
        sources: [OSM],
      };
    },
  },
  {
    re: /(?:distancia|distance)\s+(?:entre|between)\s+(.+?)\s+(?:y|and|e)\s+(.+)/i,
    run: async (m, ctx) => {
      const [a, b] = await Promise.all([place(m[1]!, ctx.lang), place(m[2]!, ctx.lang)]);
      const inv = inverse(a, b);
      const d = formatDistance(inv.distance, "metric", ctx.lang);
      return {
        text:
          ctx.lang === "es"
            ? `La distancia geodésica entre ${a.name} y ${b.name} es de ${d} (rumbo inicial ${inv.initialBearing.toFixed(0)}°), calculada sobre el elipsoide WGS84.`
            : `The geodesic distance between ${a.name} and ${b.name} is ${d} (initial bearing ${inv.initialBearing.toFixed(0)}°), computed on the WGS84 ellipsoid.`,
        actions: [
          { tool: "draw_path", input: { points: [a, b].map((p) => ({ lat: p.lat, lon: p.lon })), label: `${a.name} ↔ ${b.name}: ${d}` } },
          { tool: "show_markers", input: { markers: [a, b].map((p) => ({ lat: p.lat, lon: p.lon, label: p.name })), fit_view: true } },
        ],
        sources: [OSM, { name: "Cálculo geodésico (Vincenty, WGS84)" }],
      };
    },
  },
  {
    re: /(?:edificios? m[aá]s altos?|rascacielos|tallest buildings?)\s+(?:de|en|in|of)\s+(.+)/i,
    run: async (m, ctx) => ranking("buildings", m[1]!, ctx),
  },
  {
    re: /(?:monta[ñn]as? m[aá]s altas?|cerros? m[aá]s altos?|highest (?:mountains?|peaks?))\s+(?:de|en|in|of)\s+(.+)/i,
    run: async (m, ctx) => ranking("peaks", m[1]!, ctx),
  },
  {
    re: /(?:ciudades? m[aá]s (?:pobladas?|grandes?)|largest cities)\s+(?:de|en|in|of)\s+(.+)/i,
    run: async (m, ctx) => ranking("cities", m[1]!, ctx),
  },
  {
    re: /(?:compar[aá](?:me)?|compare)\b.*?(?:hist[oó]ric|antig|pasad|historic|old|past)\w*(?:.*?(\d{4}))?/i,
    run: async (m, ctx) => {
      const year = m[1] ? Number(m[1]) : 2015;
      const source = year < 2000 ? "hist-landsat" : year < 2014 ? "hist-modis" : "wayback";
      return {
        text:
          ctx.lang === "es"
            ? `Abrí la comparación con imágenes reales de ${year} (${source === "wayback" ? "Esri Wayback" : source === "hist-landsat" ? "Landsat" : "MODIS"}) a la izquierda del divisor. Arrastralo para comparar.`
            : `Opened a comparison with real ${year} imagery on the left of the divider. Drag it to compare.`,
        actions: [{ tool: "compare_imagery", input: { source, date: String(year) } }],
        sources: [{ name: source === "wayback" ? "Esri World Imagery Wayback" : "NASA GIBS" }],
      };
    },
  },
  {
    re: /(?:c[oó]mo cambia la (?:iluminaci[oó]n|luz)|animar? (?:el )?d[ií]a|day ?light cycle|how (?:the )?light(?:ing)? changes)/i,
    run: async (_m, ctx) => {
      const st = sunTimes(ctx.sceneTime, ctx.center.lat, ctx.center.lon);
      return {
        text:
          ctx.lang === "es"
            ? `Acelero el tiempo para mostrar un día completo. Aquí el día dura ${st.regime === "normal" ? formatHours(st.dayLengthHours) : st.regime === "polar-day" ? "24 h" : "0 h"} en esta fecha.`
            : `Speeding up time to show a full day. Day length here: ${st.regime === "normal" ? formatHours(st.dayLengthHours) : st.regime === "polar-day" ? "24 h" : "0 h"}.`,
        actions: [{ tool: "set_scene_time", input: { preset: "sunrise", animate_day: true } }],
        sources: [{ name: "Algoritmos NOAA / Meeus" }],
      };
    },
  },
  {
    re: /(?:clima|tiempo|pron[oó]stico|weather|forecast)\s+(?:en|de|in|for)\s+(.+)/i,
    run: async (m, ctx) => {
      const p = await place(m[1]!, ctx.lang);
      const f = await forecastAt(p);
      const w = weatherCodeText(f.current.weatherCode, ctx.lang === "es" ? "es" : "en");
      return {
        text:
          ctx.lang === "es"
            ? `${p.name}: ${w.icon} ${w.text}, ${Math.round(f.current.temperature)} °C, viento ${Math.round(f.current.windSpeed)} km/h, humedad ${f.current.humidity}%. (Datos de modelo meteorológico, no observaciones.)`
            : `${p.name}: ${w.icon} ${w.text}, ${Math.round(f.current.temperature)} °C, wind ${Math.round(f.current.windSpeed)} km/h, humidity ${f.current.humidity}%. (Weather-model data, not observations.)`,
        actions: [{ tool: "fly_to", input: { lat: p.lat, lon: p.lon, height_m: heightFor(p), label: p.name } }],
        sources: [OSM, { name: "Open-Meteo", url: "https://open-meteo.com", license: "CC BY 4.0" }],
      };
    },
  },
  {
    re: /(?:expl[ií]came|explic[aá]|c[oó]mo se form[oó]|qu[eé] es|explain|how (?:was|did) .+ form|what is)\s+(.+)/i,
    run: async (m, ctx) => {
      const topic = clean(m[1]!.replace(/^(?:c[oó]mo se form[oó]|how .+ formed)\s+/i, "").replace(/\s+(?:se form[oó]|formed)$/i, ""));
      const s = (await wikiSummary(topic, ctx.lang)) ?? (await wikiSummary(topic, "en"));
      if (!s) return { text: ctx.lang === "es" ? `No encontré información confiable sobre "${topic}". En modo básico sólo consulto Wikipedia.` : `I found no reliable information about "${topic}".`, actions: [], sources: [] };
      const actions: AssistantAction[] = s.coordinates ? [{ tool: "fly_to", input: { lat: s.coordinates.lat, lon: s.coordinates.lon, height_m: 15000, pitch: -30, cinematic: true, label: s.title } }] : [];
      return { text: s.extract, actions, sources: [{ name: `Wikipedia — ${s.title}`, url: s.url, license: "CC BY-SA 4.0" }] };
    },
  },
  {
    re: /(?:altura|elevaci[oó]n|altitud|elevation|altitude)\s+(?:de|del|of)\s+(.+)/i,
    run: async (m, ctx) => {
      const p = await place(m[1]!, ctx.lang);
      const h = await elevationAt(p);
      return {
        text: ctx.lang === "es" ? `La elevación del terreno en ${p.name} es de aproximadamente ${Math.round(h)} m sobre el nivel del mar (modelo digital de elevación, resolución ~10–30 m).` : `Terrain elevation at ${p.name} is about ${Math.round(h)} m above sea level.`,
        actions: [{ tool: "fly_to", input: { lat: p.lat, lon: p.lon, height_m: 4000, pitch: -35, label: p.name } }],
        sources: [OSM, { name: "AWS Terrain Tiles (SRTM/ETOPO1)", url: "https://registry.opendata.aws/terrain-tiles/" }],
      };
    },
  },
  {
    re: /(?:qu[eé] hay (?:ac[aá]|aqu[ií])|d[oó]nde estoy|what(?:'s| is) here|where am i)/i,
    run: async (_m, ctx) => {
      const r = await reverse(ctx.center, { lang: ctx.lang, zoom: 14 });
      return { text: r ? `${r.label}` : ctx.lang === "es" ? "No hay una dirección conocida para este punto." : "No known address here.", actions: [], sources: [OSM] };
    },
  },
  {
    re: /(?:modo peat[oó]n|caminar|street ?view|nivel (?:de )?calle|walk)/i,
    run: async (_m, ctx) => ({
      text: ctx.lang === "es" ? "Busco imágenes a nivel de calle con licencia abierta aquí; si no hay, abro una vista 3D aproximada." : "Looking for open street-level imagery here.",
      actions: [{ tool: "open_street_level", input: { lat: ctx.center.lat, lon: ctx.center.lon } }],
      sources: [{ name: "Panoramax / Mapillary" }],
    }),
  },
  {
    re: /(?:radar|lluvia|precipitaci[oó]n|rain)/i,
    run: async (_m, ctx) => ({ text: ctx.lang === "es" ? "Activé el radar de precipitación (datos observados de RainViewer)." : "Radar enabled (RainViewer, observed).", actions: [{ tool: "weather_layers", input: { radar: true } }], sources: [{ name: "RainViewer" }] }),
  },
  {
    re: /(?:hurac[aá]n|hurricanes?|cicl[oó]n|tormentas? tropical)/i,
    run: async (_m, ctx) => ({ text: ctx.lang === "es" ? "Muestro los ciclones tropicales activos según GDACS." : "Showing active tropical cyclones (GDACS).", actions: [{ tool: "weather_layers", input: { storms: true } }, { tool: "view_from_space", input: {} }], sources: [{ name: "GDACS", url: "https://www.gdacs.org" }] }),
  },
  {
    re: /(?:vi?aj[aá]|vol[aá]|ir|llev[aá]me|and[aá]|fly|go|take me)\s+(?:hasta|a|al|hacia|to)\s+(.+)/i,
    run: async (m, ctx) => {
      const p = await place(m[1]!, ctx.lang);
      return {
        text: ctx.lang === "es" ? `Volando a ${p.name}${p.label ? ` (${p.label})` : ""}.` : `Flying to ${p.name}.`,
        actions: [{ tool: "fly_to", input: { lat: p.lat, lon: p.lon, height_m: heightFor(p), pitch: -40, cinematic: true, label: p.name } }],
        sources: [OSM],
      };
    },
  },
];

async function ranking(kind: "buildings" | "peaks" | "cities", country: string, ctx: Ctx): Promise<LocalReply> {
  const q = await countryQid(clean(country));
  if (!q) throw new Error(ctx.lang === "es" ? `No reconocí el país "${clean(country)}".` : `Unknown country "${clean(country)}".`);
  const items = kind === "buildings" ? await tallestStructures(q, { lang: ctx.lang, limit: 10 }) : kind === "peaks" ? await highestPeaks(q, { lang: ctx.lang }) : await largestCities(q, { lang: ctx.lang });
  if (!items.length) return { text: ctx.lang === "es" ? "Wikidata no devolvió resultados." : "No results from Wikidata.", actions: [], sources: [] };
  const unit = kind === "cities" ? " hab." : " m";
  const list = items.map((x, i) => `${i + 1}. ${x.name} — ${Math.round(x.value).toLocaleString(ctx.lang)}${unit}`).join("\n");
  return {
    text: `${list}\n\n${ctx.lang === "es" ? "Datos colaborativos de Wikidata: pueden estar incompletos." : "Crowdsourced Wikidata data; may be incomplete."}`,
    actions: [{ tool: "show_markers", input: { markers: items.map((x) => ({ lat: x.lat, lon: x.lon, label: `${x.name} (${Math.round(x.value)}${unit})` })), fit_view: true } }],
    sources: [{ name: "Wikidata", url: "https://www.wikidata.org", license: "CC0" }],
  };
}

export async function localAssistant(message: string, ctx: Ctx): Promise<LocalReply> {
  for (const rule of RULES) {
    const m = message.match(rule.re);
    if (m) return rule.run(m, ctx);
  }
  // Último intento: tratarlo como un lugar
  if (message.trim().split(/\s+/).length <= 6) {
    try {
      const p = await place(message, ctx.lang);
      return {
        text: ctx.lang === "es" ? `Encontré ${p.name}${p.label ? ` (${p.label})` : ""}.` : `Found ${p.name}.`,
        actions: [{ tool: "fly_to", input: { lat: p.lat, lon: p.lon, height_m: heightFor(p), pitch: -40, cinematic: true, label: p.name } }],
        sources: [OSM],
      };
    } catch {
      /* sigue */
    }
  }
  return {
    text:
      ctx.lang === "es"
        ? "En modo básico (sin IA configurada en el servidor) entiendo pedidos como: «Mostrame Buenos Aires desde el espacio», «Viajá hasta el Obelisco», «Distancia entre Madrid y Lisboa», «Edificios más altos de Argentina», «Compará esta zona con imágenes históricas de 2000», «Cómo cambia la iluminación durante el día», «Clima en Tokio», «Explicame cómo se formó el Aconcagua»."
        : "In basic mode (no AI configured on the server) I understand requests like: “Show me Buenos Aires from space”, “Fly to the Eiffel Tower”, “Distance between Madrid and Lisbon”, “Tallest buildings in Argentina”, “Compare this area with historic imagery from 2000”, “How the lighting changes during the day”, “Weather in Tokyo”.",
    actions: [],
    sources: [],
  };
}
