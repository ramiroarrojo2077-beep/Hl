/**
 * Consultas geográficas del lado del servidor (para el asistente de IA).
 * Cada resultado incluye su fuente para poder citarla.
 */
import { decode } from "fast-png";
import { lonLatToTilePixel } from "../src/geo/tiles.ts";
import { rgbaToHeights, sampleBilinear } from "../src/geo/terrarium.ts";

const UA = process.env.EARTH_USER_AGENT ?? "EarthNext/0.1 (+https://github.com/; open-source geospatial viewer)";

export interface Source {
  name: string;
  url?: string;
  license?: string;
}

export class GeoDataError extends Error {}

async function getJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) } });
    if (!res.ok) throw new GeoDataError(`HTTP ${res.status} desde ${new URL(url).host}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// Nominatim: máximo 1 pedido por segundo (política de uso).
let lastNominatim = 0;
async function nominatimSlot(): Promise<void> {
  const wait = lastNominatim + 1100 - Date.now();
  lastNominatim = Math.max(Date.now(), lastNominatim + 1100);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export interface GeocodeHit {
  name: string;
  display: string;
  lat: number;
  lon: number;
  kind: string;
  bbox?: [number, number, number, number];
  wikidata?: string;
  wikipedia?: string;
  population?: string;
}

export async function geocode(query: string, lang = "es", limit = 5): Promise<{ results: GeocodeHit[]; source: Source }> {
  try {
    await nominatimSlot();
    const params = new URLSearchParams({ q: query, format: "jsonv2", limit: String(limit), extratags: "1", "accept-language": lang });
    const r = await getJson<{ name?: string; display_name: string; lat: string; lon: string; type: string; boundingbox?: string[]; extratags?: Record<string, string> }[]>(
      `https://nominatim.openstreetmap.org/search?${params}`,
    );
    if (r.length) {
      return {
        results: r.map((x) => {
          const bb = x.boundingbox?.map(Number);
          return {
            name: x.name || x.display_name.split(",")[0]!,
            display: x.display_name,
            lat: Number(x.lat),
            lon: Number(x.lon),
            kind: x.type,
            bbox: bb ? ([bb[2], bb[0], bb[3], bb[1]] as [number, number, number, number]) : undefined,
            wikidata: x.extratags?.["wikidata"],
            wikipedia: x.extratags?.["wikipedia"],
            population: x.extratags?.["population"],
          };
        }),
        source: { name: "Nominatim / OpenStreetMap", url: "https://nominatim.org", license: "ODbL" },
      };
    }
  } catch {
    /* respaldo con Photon */
  }
  const p = await getJson<{ features: { geometry: { coordinates: [number, number] }; properties: Record<string, string | number | number[]> }[] }>(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
  return {
    results: p.features.map((f) => ({
      name: String(f.properties["name"] ?? query),
      display: [f.properties["name"], f.properties["city"], f.properties["state"], f.properties["country"]].filter(Boolean).join(", "),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      kind: String(f.properties["osm_value"] ?? "place"),
    })),
    source: { name: "Photon (komoot) / OpenStreetMap", url: "https://photon.komoot.io", license: "ODbL" },
  };
}

export async function reverseGeocode(lat: number, lon: number, lang = "es", zoom = 14): Promise<{ result: { display: string; address: Record<string, string>; wikidata?: string } | null; source: Source }> {
  await nominatimSlot();
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: "jsonv2", zoom: String(zoom), addressdetails: "1", extratags: "1", "accept-language": lang });
  const r = await getJson<{ display_name?: string; address?: Record<string, string>; extratags?: Record<string, string>; error?: string }>(`https://nominatim.openstreetmap.org/reverse?${params}`);
  return {
    result: r.error || !r.display_name ? null : { display: r.display_name, address: r.address ?? {}, wikidata: r.extratags?.["wikidata"] },
    source: { name: "Nominatim / OpenStreetMap", url: "https://nominatim.org", license: "ODbL" },
  };
}

// ----------------------------------------------------------------- Elevación (Terrarium)

const tileCache = new Map<string, Float32Array>();

async function terrariumTile(z: number, x: number, y: number): Promise<Float32Array> {
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new GeoDataError(`Terreno no disponible (HTTP ${res.status})`);
  const img = decode(new Uint8Array(await res.arrayBuffer()));
  const channels = img.channels;
  let rgba: Uint8Array;
  if (channels === 4) rgba = img.data as Uint8Array;
  else {
    rgba = new Uint8Array(img.width * img.height * 4);
    for (let i = 0, j = 0; i < img.width * img.height; i++, j += channels) {
      rgba[i * 4] = (img.data as Uint8Array)[j]!;
      rgba[i * 4 + 1] = (img.data as Uint8Array)[j + 1]!;
      rgba[i * 4 + 2] = (img.data as Uint8Array)[j + 2]!;
      rgba[i * 4 + 3] = 255;
    }
  }
  const heights = rgbaToHeights(rgba, img.width);
  tileCache.set(key, heights);
  if (tileCache.size > 64) tileCache.delete(tileCache.keys().next().value!);
  return heights;
}

export async function elevations(points: { lat: number; lon: number }[], zoom = 13): Promise<{ elevations: number[]; source: Source }> {
  const out: number[] = [];
  for (const p of points.slice(0, 50)) {
    const { tile, px, py } = lonLatToTilePixel(p, zoom);
    const h = await terrariumTile(tile.z, tile.x, tile.y);
    out.push(Math.round(sampleBilinear(h, 256, px, py) * 10) / 10);
  }
  return {
    elevations: out,
    source: { name: "AWS Terrain Tiles (SRTM, ETOPO1, GMTED y otras)", url: "https://registry.opendata.aws/terrain-tiles/", license: "Fuentes abiertas con atribución" },
  };
}

// ----------------------------------------------------------------- Meteorología

export async function weatherAt(lat: number, lon: number): Promise<{ data: unknown; source: Source }> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: "auto",
    forecast_days: "3",
  });
  const data = await getJson<unknown>(`https://api.open-meteo.com/v1/forecast?${params}`);
  return { data, source: { name: "Open-Meteo (modelos meteorológicos; valores de MODELO/PRONÓSTICO, no observaciones)", url: "https://open-meteo.com", license: "CC BY 4.0" } };
}

// ----------------------------------------------------------------- Wikipedia / Wikidata

export async function wikipedia(query: string, lang = "es"): Promise<{ title: string; extract: string; url: string; coordinates?: { lat: number; lon: number } } | null> {
  const search = await getJson<{ query?: { search?: { title: string }[] } }>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`,
  );
  const title = search.query?.search?.[0]?.title;
  if (!title) return null;
  const s = await getJson<{ title: string; extract: string; content_urls?: { desktop?: { page?: string } }; coordinates?: { lat: number; lon: number } }>(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  );
  return { title: s.title, extract: s.extract, url: s.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`, coordinates: s.coordinates };
}

async function sparql(query: string): Promise<Record<string, { value: string }>[]> {
  const r = await getJson<{ results: { bindings: Record<string, { value: string }>[] } }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    timeoutMs: 45000,
    headers: { Accept: "application/sparql-results+json" },
  });
  return r.results.bindings;
}

export async function countryQid(name: string): Promise<string | null> {
  const safe = name.replace(/["\\]/g, "");
  const rows = await sparql(
    `SELECT ?c WHERE { ?c wdt:P31/wdt:P279* wd:Q6256 . { ?c rdfs:label "${safe}"@es } UNION { ?c rdfs:label "${safe}"@en } UNION { ?c skos:altLabel "${safe}"@es } } LIMIT 1`,
  );
  return rows[0]?.["c"]?.value.split("/").pop() ?? null;
}

export async function ranking(kind: "tallest_buildings" | "highest_peaks" | "largest_cities", country: string, lang = "es", limit = 10) {
  const qid = /^Q\d+$/.test(country) ? country : await countryQid(country);
  if (!qid) throw new GeoDataError(`País no reconocido en Wikidata: ${country}`);
  const pattern =
    kind === "tallest_buildings"
      ? `VALUES ?cls { wd:Q41176 wd:Q11303 } ?item wdt:P31/wdt:P279* ?cls ; wdt:P17 wd:${qid} ; wdt:P625 ?coord ; p:P2048/psn:P2048/wikibase:quantityAmount ?v .`
      : kind === "highest_peaks"
        ? `?item wdt:P31/wdt:P279* wd:Q8502 ; wdt:P17 wd:${qid} ; wdt:P625 ?coord ; p:P2044/psn:P2044/wikibase:quantityAmount ?v .`
        : `?item wdt:P31/wdt:P279* wd:Q515 ; wdt:P17 wd:${qid} ; wdt:P1082 ?v ; wdt:P625 ?coord .`;
  const rows = await sparql(`SELECT ?item ?itemLabel ?v ?coord WHERE { ${pattern} SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". } } ORDER BY DESC(?v) LIMIT ${limit * 3}`);
  const seen = new Set<string>();
  const items: { name: string; value: number; lat: number; lon: number; wikidata: string }[] = [];
  for (const r of rows) {
    const id = r["item"]!.value.split("/").pop()!;
    const m = r["coord"]?.value.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
    if (!m || seen.has(id)) continue;
    seen.add(id);
    items.push({ name: r["itemLabel"]?.value ?? id, value: Number(r["v"]!.value), lon: Number(m[1]), lat: Number(m[2]), wikidata: id });
    if (items.length >= limit) break;
  }
  return {
    country_qid: qid,
    unit: kind === "largest_cities" ? "habitantes" : "metros",
    items,
    source: { name: "Wikidata (consulta SPARQL)", url: "https://query.wikidata.org", license: "CC0" } satisfies Source,
    caveat: "Datos colaborativos: pueden estar incompletos o desactualizados.",
  };
}

// ----------------------------------------------------------------- OpenStreetMap (Overpass)

export async function nearbyPlaces(lat: number, lon: number, radius = 1000, category?: string) {
  const r = Math.min(5000, Math.max(50, Math.round(radius)));
  const filters = category
    ? [`nwr["${category.replace(/[^a-z_:]/gi, "")}"]["name"]`]
    : ['nwr["tourism"]["name"]', 'nwr["historic"]["name"]', 'nwr["amenity"~"theatre|museum|university|townhall|place_of_worship"]["name"]', 'nwr["leisure"~"park|stadium"]["name"]', 'nwr["natural"~"peak|volcano|waterfall"]["name"]'];
  const q = `[out:json][timeout:20];(${filters.map((f) => `${f}(around:${r},${lat},${lon});`).join("")});out center tags 40;`;
  const mirrors = [process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  let lastErr: unknown;
  for (const m of mirrors) {
    try {
      const d = await getJson<{ elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] }>(m, {
        method: "POST",
        body: new URLSearchParams({ data: q }),
        timeoutMs: 25000,
      });
      return {
        places: d.elements
          .filter((e) => e.tags?.["name"])
          .map((e) => ({ name: e.tags!["name"]!, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: Object.fromEntries(Object.entries(e.tags!).filter(([k]) => /^(tourism|historic|amenity|leisure|natural|wikipedia|height|ele|start_date)$/.test(k))) })),
        source: { name: "OpenStreetMap (Overpass API)", url: "https://www.openstreetmap.org/copyright", license: "ODbL" } satisfies Source,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new GeoDataError("Overpass no disponible");
}

// ----------------------------------------------------------------- METAR (proxy sin CORS)

export async function metarBbox(bbox: string): Promise<unknown> {
  if (!/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(bbox)) throw new GeoDataError("bbox inválido");
  return getJson<unknown>(`https://aviationweather.gov/api/data/metar?bbox=${bbox}&format=json`, { timeoutMs: 15000 });
}
