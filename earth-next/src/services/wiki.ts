/**
 * Información enciclopédica: Wikipedia (resúmenes, artículos cercanos) y Wikidata
 * (datos estructurados de países y ciudades). Contenido CC BY-SA.
 */
import type { LonLat } from "../geo/coords.ts";
import { getJson } from "./http.ts";

export interface WikiSummary {
  title: string;
  extract: string;
  description?: string;
  url: string;
  thumbnail?: string;
  lang: string;
  coordinates?: LonLat;
}

export const WIKI_SOURCE = { name: "Wikipedia", license: "CC BY-SA 4.0", url: "https://www.wikipedia.org" };

interface RestSummary {
  title: string;
  extract: string;
  description?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source: string };
  coordinates?: { lat: number; lon: number };
  type?: string;
}

export async function wikiSummary(title: string, lang = "es", signal?: AbortSignal): Promise<WikiSummary | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`;
  try {
    const r = await getJson<RestSummary>(url, { signal, timeoutMs: 10000, retries: 1, cacheKey: `wiki:${lang}:${title}`, cacheTtlMs: 7 * 86400_000 });
    if (r.type === "disambiguation" || !r.extract) return null;
    return {
      title: r.title,
      extract: r.extract,
      description: r.description,
      url: r.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      thumbnail: r.thumbnail?.source,
      lang,
      coordinates: r.coordinates ? { lat: r.coordinates.lat, lon: r.coordinates.lon } : undefined,
    };
  } catch {
    return null;
  }
}

/** Resuelve una etiqueta OSM "wikipedia" (p. ej. "es:Obelisco de Buenos Aires"). */
export async function wikiFromTag(tag: string, preferLang = "es", signal?: AbortSignal): Promise<WikiSummary | null> {
  const m = tag.match(/^([a-z-]{2,10}):(.+)$/);
  if (!m) return wikiSummary(tag, preferLang, signal);
  return wikiSummary(m[2]!, m[1]!, signal);
}

export interface NearbyArticle {
  title: string;
  lat: number;
  lon: number;
  dist: number;
  pageid: number;
}

/** Artículos de Wikipedia geolocalizados cerca de un punto (hasta 10 km). */
export async function nearbyArticles(p: LonLat, radius = 2000, lang = "es", limit = 20, signal?: AbortSignal): Promise<NearbyArticle[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${p.lat.toFixed(5)}|${p.lon.toFixed(5)}`,
    gsradius: String(Math.min(10000, Math.max(10, Math.round(radius)))),
    gslimit: String(limit),
    format: "json",
    origin: "*",
  });
  const r = await getJson<{ query?: { geosearch: NearbyArticle[] } }>(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
    signal,
    timeoutMs: 10000,
    cacheKey: `wikigeo:${lang}:${params}`,
    cacheTtlMs: 86400_000,
  });
  return r.query?.geosearch ?? [];
}

/** Busca el título de Wikipedia de una entidad Wikidata en el idioma pedido. */
export async function wikidataSitelink(qid: string, lang = "es", signal?: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({ action: "wbgetentities", ids: qid, props: "sitelinks", sitefilter: `${lang}wiki|enwiki`, format: "json", origin: "*" });
  try {
    const r = await getJson<{ entities: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(`https://www.wikidata.org/w/api.php?${params}`, {
      signal,
      timeoutMs: 10000,
      cacheKey: `wd-sitelink:${qid}:${lang}`,
      cacheTtlMs: 30 * 86400_000,
    });
    const links = r.entities[qid]?.sitelinks;
    return links?.[`${lang}wiki`]?.title ?? (links?.["enwiki"] ? `en:${links["enwiki"].title}` : null);
  } catch {
    return null;
  }
}

export interface Factsheet {
  qid: string;
  label: string;
  population?: number;
  populationDate?: string;
  area?: number;
  capital?: string;
  elevation?: number;
  inception?: string;
  officialLanguages?: string[];
  currency?: string;
  hdi?: number;
  gdpPerCapita?: number;
}

/** Ficha de datos estructurados (población, superficie, capital...) desde Wikidata SPARQL. */
export async function wikidataFactsheet(qid: string, lang = "es", signal?: AbortSignal): Promise<Factsheet | null> {
  if (!/^Q\d+$/.test(qid)) return null;
  const query = `SELECT ?label ?population ?popDate ?area ?capitalLabel ?elevation ?inception ?langLabel ?currencyLabel ?hdi ?gdppc WHERE {
    BIND(wd:${qid} AS ?item)
    OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "${lang}") }
    OPTIONAL { ?item p:P1082 ?ps . ?ps ps:P1082 ?population . ?ps wikibase:rank ?rank FILTER(?rank != wikibase:DeprecatedRank) OPTIONAL { ?ps pq:P585 ?popDate } }
    OPTIONAL { ?item wdt:P2046 ?area }
    OPTIONAL { ?item wdt:P36 ?capital }
    OPTIONAL { ?item wdt:P2044 ?elevation }
    OPTIONAL { ?item wdt:P571 ?inception }
    OPTIONAL { ?item wdt:P37 ?lang }
    OPTIONAL { ?item wdt:P38 ?currency }
    OPTIONAL { ?item wdt:P1081 ?hdi }
    OPTIONAL { ?item wdt:P2132 ?gdppc }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
  } ORDER BY DESC(?popDate) LIMIT 30`;
  try {
    const r = await getJson<{ results: { bindings: Record<string, { value: string }>[] } }>(
      `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`,
      { signal, timeoutMs: 15000, retries: 1, cacheKey: `wd-facts:${qid}:${lang}`, cacheTtlMs: 7 * 86400_000, headers: { Accept: "application/sparql-results+json" } },
    );
    const rows = r.results.bindings;
    if (!rows.length) return null;
    const first = rows[0]!;
    const num = (k: string) => (first[k] ? Number(first[k]!.value) : undefined);
    return {
      qid,
      label: first["label"]?.value ?? qid,
      population: num("population"),
      populationDate: first["popDate"]?.value.slice(0, 10),
      area: num("area"),
      capital: first["capitalLabel"]?.value,
      elevation: num("elevation"),
      inception: first["inception"]?.value.slice(0, 10),
      officialLanguages: [...new Set(rows.map((x) => x["langLabel"]?.value).filter((x): x is string => !!x))],
      currency: first["currencyLabel"]?.value,
      hdi: num("hdi"),
      gdpPerCapita: num("gdppc"),
    };
  } catch {
    return null;
  }
}
