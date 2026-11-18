/**
 * Consultas de conocimiento geográfico estructurado (Wikidata SPARQL, CC0).
 * Todas las respuestas incluyen la fuente para poder citarla.
 */
import { getJson } from "./http.ts";

export const WIKIDATA_SOURCE = { name: "Wikidata", url: "https://www.wikidata.org", license: "CC0 1.0" };

interface SparqlResponse {
  results: { bindings: Record<string, { value: string }>[] };
}

async function sparql(query: string, cacheKey: string, signal?: AbortSignal): Promise<SparqlResponse["results"]["bindings"]> {
  const r = await getJson<SparqlResponse>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    signal,
    timeoutMs: 30000,
    retries: 1,
    cacheKey,
    cacheTtlMs: 7 * 86400_000,
    headers: { Accept: "application/sparql-results+json" },
  });
  return r.results.bindings;
}

function parsePoint(wkt: string | undefined): { lon: number; lat: number } | null {
  const m = wkt?.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

export interface RankedFeature {
  qid: string;
  name: string;
  lon: number;
  lat: number;
  value: number;
  unit: string;
  url: string;
}

/** Busca el QID de Wikidata de un país por nombre (en español o inglés). */
export async function countryQid(name: string, signal?: AbortSignal): Promise<string | null> {
  const safe = name.replace(/["\\]/g, "");
  const q = `SELECT ?c WHERE { ?c wdt:P31/wdt:P279* wd:Q6256 . { ?c rdfs:label "${safe}"@es } UNION { ?c rdfs:label "${safe}"@en } UNION { ?c skos:altLabel "${safe}"@es } } LIMIT 1`;
  const rows = await sparql(q, `wd-country:${safe.toLowerCase()}`, signal);
  return rows[0]?.["c"]?.value.split("/").pop() ?? null;
}

/**
 * Edificios más altos de un país (altura normalizada a metros con coordenadas).
 * Incluye rascacielos, torres de oficinas, torres de comunicaciones, etc. (subclases de edificio/estructura alta).
 */
export async function tallestStructures(countryQidValue: string, opts: { limit?: number; lang?: string; includeTowers?: boolean; signal?: AbortSignal } = {}): Promise<RankedFeature[]> {
  const lang = opts.lang ?? "es";
  const limit = opts.limit ?? 15;
  const classes = opts.includeTowers ? "wd:Q41176 wd:Q12518 wd:Q11303" : "wd:Q41176 wd:Q11303";
  const q = `SELECT ?item ?itemLabel ?h ?coord WHERE {
    VALUES ?cls { ${classes} }
    ?item wdt:P31/wdt:P279* ?cls ; wdt:P17 wd:${countryQidValue} ; wdt:P625 ?coord ;
          p:P2048/psn:P2048/wikibase:quantityAmount ?h .
    FILTER NOT EXISTS { ?item wdt:P5817 wd:Q811683 }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
  } ORDER BY DESC(?h) LIMIT ${limit * 3}`;
  const rows = await sparql(q, `wd-tallest:${countryQidValue}:${opts.includeTowers ? 1 : 0}:${lang}`, opts.signal);
  const seen = new Set<string>();
  const out: RankedFeature[] = [];
  for (const r of rows) {
    const url = r["item"]!.value;
    const qid = url.split("/").pop()!;
    if (seen.has(qid)) continue;
    const p = parsePoint(r["coord"]?.value);
    if (!p) continue;
    seen.add(qid);
    out.push({ qid, name: r["itemLabel"]?.value ?? qid, ...p, value: Number(r["h"]!.value), unit: "m", url });
    if (out.length >= limit) break;
  }
  return out;
}

/** Montañas más altas de un país. */
export async function highestPeaks(countryQidValue: string, opts: { limit?: number; lang?: string; signal?: AbortSignal } = {}): Promise<RankedFeature[]> {
  const lang = opts.lang ?? "es";
  const limit = opts.limit ?? 10;
  const q = `SELECT ?item ?itemLabel ?h ?coord WHERE {
    ?item wdt:P31/wdt:P279* wd:Q8502 ; wdt:P17 wd:${countryQidValue} ; wdt:P625 ?coord ;
          p:P2044/psn:P2044/wikibase:quantityAmount ?h .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
  } ORDER BY DESC(?h) LIMIT ${limit * 2}`;
  const rows = await sparql(q, `wd-peaks:${countryQidValue}:${lang}`, opts.signal);
  const seen = new Set<string>();
  const out: RankedFeature[] = [];
  for (const r of rows) {
    const url = r["item"]!.value;
    const qid = url.split("/").pop()!;
    const p = parsePoint(r["coord"]?.value);
    if (!p || seen.has(qid)) continue;
    seen.add(qid);
    out.push({ qid, name: r["itemLabel"]?.value ?? qid, ...p, value: Number(r["h"]!.value), unit: "m", url });
    if (out.length >= limit) break;
  }
  return out;
}

/** Ciudades más pobladas de un país (o del mundo si no se indica). */
export async function largestCities(countryQidValue: string | null, opts: { limit?: number; lang?: string; signal?: AbortSignal } = {}): Promise<RankedFeature[]> {
  const lang = opts.lang ?? "es";
  const limit = opts.limit ?? 10;
  const country = countryQidValue ? `wdt:P17 wd:${countryQidValue} ;` : "";
  const q = `SELECT ?item ?itemLabel ?pop ?coord WHERE {
    ?item wdt:P31/wdt:P279* wd:Q515 ; ${country} wdt:P1082 ?pop ; wdt:P625 ?coord .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
  } ORDER BY DESC(?pop) LIMIT ${limit * 3}`;
  const rows = await sparql(q, `wd-cities:${countryQidValue}:${lang}`, opts.signal);
  const seen = new Set<string>();
  const out: RankedFeature[] = [];
  for (const r of rows) {
    const url = r["item"]!.value;
    const qid = url.split("/").pop()!;
    const p = parsePoint(r["coord"]?.value);
    if (!p || seen.has(qid)) continue;
    seen.add(qid);
    out.push({ qid, name: r["itemLabel"]?.value ?? qid, ...p, value: Number(r["pop"]!.value), unit: "hab", url });
    if (out.length >= limit) break;
  }
  return out;
}
