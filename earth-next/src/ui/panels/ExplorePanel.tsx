import { useEffect, useState } from "preact/hooks";
import { Loader2, Trophy, Mountain, Building2, Users, MapPinned, GraduationCap, Scale, Landmark } from "lucide-preact";
import { Panel } from "./PanelHost.tsx";
import { useEngine } from "../context.ts";
import { countryQid, tallestStructures, highestPeaks, largestCities, type RankedFeature, WIKIDATA_SOURCE } from "../../services/knowledge.ts";
import { wikidataFactsheet, nearbyArticles, wikiSummary, type Factsheet, type NearbyArticle } from "../../services/wiki.ts";
import { nearbyPois, type OsmPoi } from "../../services/overpass.ts";
import { reverse, searchBest } from "../../services/geocoder.ts";
import { notify, settings } from "../../state/store.ts";
import { inverse } from "../../geo/geodesy.ts";
import { formatDistance, formatArea } from "../../geo/format.ts";
import { t } from "../../i18n/index.ts";

type Tab = "here" | "rankings" | "compare" | "learn";

export function ExplorePanel() {
  const [tab, setTab] = useState<Tab>("here");
  return (
    <Panel title={t("Explorar")}>
      <div class="seg">
        <button class={tab === "here" ? "on" : ""} onClick={() => setTab("here")}>
          <MapPinned size={13} /> {t("Aquí")}
        </button>
        <button class={tab === "rankings" ? "on" : ""} onClick={() => setTab("rankings")}>
          <Trophy size={13} /> {t("Rankings")}
        </button>
        <button class={tab === "compare" ? "on" : ""} onClick={() => setTab("compare")}>
          <Scale size={13} /> {t("Comparar")}
        </button>
        <button class={tab === "learn" ? "on" : ""} onClick={() => setTab("learn")}>
          <GraduationCap size={13} /> {t("Educación")}
        </button>
      </div>
      {tab === "here" && <HereTab />}
      {tab === "rankings" && <RankingsTab />}
      {tab === "compare" && <CompareTab />}
      {tab === "learn" && <LearnTab />}
    </Panel>
  );
}

function FactsheetView({ f }: { f: Factsheet }) {
  const u = settings.value.units;
  return (
    <dl class="kv">
      {f.population !== undefined && (
        <>
          <dt>{t("Población")}</dt>
          <dd>
            {Math.round(f.population).toLocaleString()} {f.populationDate ? `(${f.populationDate.slice(0, 4)})` : ""}
          </dd>
        </>
      )}
      {f.area !== undefined && (
        <>
          <dt>{t("Superficie")}</dt>
          <dd>{formatArea(f.area * 1e6, u)}</dd>
        </>
      )}
      {f.population !== undefined && f.area !== undefined && f.area > 0 && (
        <>
          <dt>{t("Densidad")}</dt>
          <dd>{(f.population / f.area).toFixed(1)} hab/km²</dd>
        </>
      )}
      {f.capital && (
        <>
          <dt>{t("Capital")}</dt>
          <dd>{f.capital}</dd>
        </>
      )}
      {f.elevation !== undefined && (
        <>
          <dt>{t("Altitud")}</dt>
          <dd>{Math.round(f.elevation)} m</dd>
        </>
      )}
      {f.officialLanguages && f.officialLanguages.length > 0 && (
        <>
          <dt>{t("Idiomas oficiales")}</dt>
          <dd>{f.officialLanguages.slice(0, 4).join(", ")}</dd>
        </>
      )}
      {f.currency && (
        <>
          <dt>{t("Moneda")}</dt>
          <dd>{f.currency}</dd>
        </>
      )}
      {f.hdi !== undefined && (
        <>
          <dt>IDH</dt>
          <dd>{f.hdi.toFixed(3)}</dd>
        </>
      )}
      {f.inception && (
        <>
          <dt>{t("Fundación")}</dt>
          <dd>{f.inception.replace(/^\+/, "").slice(0, 10)}</dd>
        </>
      )}
    </dl>
  );
}

function HereTab() {
  const engine = useEngine();
  const [loading, setLoading] = useState(false);
  const [country, setCountry] = useState<{ name: string; facts: Factsheet | null } | null>(null);
  const [city, setCity] = useState<{ name: string; facts: Factsheet | null } | null>(null);
  const [articles, setArticles] = useState<NearbyArticle[]>([]);
  const [pois, setPois] = useState<OsmPoi[]>([]);

  const load = async () => {
    setLoading(true);
    const c = engine.viewCenter();
    const lang = settings.value.lang;
    try {
      const [countryPlace, cityPlace] = await Promise.all([reverse(c, { lang, zoom: 3 }).catch(() => null), reverse(c, { lang, zoom: 10 }).catch(() => null)]);
      const facts = async (p: typeof countryPlace) => {
        const q = p?.extratags?.["wikidata"];
        return q ? wikidataFactsheet(q, lang) : null;
      };
      const [cf, ctf] = await Promise.all([facts(countryPlace), facts(cityPlace)]);
      setCountry(countryPlace ? { name: countryPlace.name, facts: cf } : null);
      setCity(cityPlace && cityPlace.id !== countryPlace?.id ? { name: cityPlace.name, facts: ctf } : null);
      const [arts, ps] = await Promise.all([nearbyArticles(c, 5000, lang, 15).catch(() => []), nearbyPois(c, 1500).catch(() => [])]);
      setArticles(arts);
      setPois(ps.slice(0, 25));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div class="col" style={{ gap: "10px" }}>
      <button class="btn small" onClick={load} disabled={loading}>
        {loading ? <Loader2 size={14} /> : null} {t("Actualizar para el centro de la vista")}
      </button>
      {country && (
        <div class="card col">
          <b>🌎 {country.name}</b>
          {country.facts ? <FactsheetView f={country.facts} /> : <span class="faint">{t("Sin datos estructurados.")}</span>}
        </div>
      )}
      {city && (
        <div class="card col">
          <b>🏙️ {city.name}</b>
          {city.facts ? <FactsheetView f={city.facts} /> : <span class="faint">{t("Sin datos estructurados.")}</span>}
        </div>
      )}
      {pois.length > 0 && (
        <>
          <div class="section-title row">
            <Landmark size={12} /> {t("Lugares de interés cercanos (OSM)")}
          </div>
          {pois.map((p) => (
            <button key={p.id} class="list-item" onClick={() => (engine.cinematicFlyTo(p, 500), void engine.selectPlace({ id: p.id, name: p.name, label: `${p.category}: ${p.kind}`, lon: p.lon, lat: p.lat, kind: p.kind, category: p.category, source: "nominatim", osm: { type: p.osmType, id: p.osmId }, extratags: p.tags }))}>
              <div class="grow">
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div class="faint">
                  {p.category} · {p.kind}
                </div>
              </div>
            </button>
          ))}
        </>
      )}
      {articles.length > 0 && (
        <>
          <div class="section-title">{t("Artículos de Wikipedia cercanos")}</div>
          {articles.map((a) => (
            <button
              key={a.pageid}
              class="list-item"
              onClick={async () => {
                void engine.cinematicFlyTo(a, 800);
                const s = await wikiSummary(a.title, settings.value.lang);
                if (s) notify(`${s.title}: ${s.extract.slice(0, 220)}…`, "info", 9000);
              }}
            >
              <div class="grow">
                <div style={{ fontWeight: 600 }}>{a.title}</div>
                <div class="faint">{formatDistance(a.dist, settings.value.units)}</div>
              </div>
            </button>
          ))}
        </>
      )}
      <div class="sources">{t("Fuentes")}: Nominatim/OSM (ODbL) · Wikidata (CC0) · Wikipedia (CC BY-SA)</div>
    </div>
  );
}

function RankingsTab() {
  const engine = useEngine();
  const [country, setCountry] = useState("Argentina");
  const [kind, setKind] = useState<"buildings" | "peaks" | "cities">("buildings");
  const [items, setItems] = useState<RankedFeature[] | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const q = await countryQid(country);
      if (!q) throw new Error(t("No se reconoció el país \"{c}\".", { c: country }));
      const lang = settings.value.lang;
      const r = kind === "buildings" ? await tallestStructures(q, { lang, limit: 15 }) : kind === "peaks" ? await highestPeaks(q, { lang }) : await largestCities(q, { lang });
      setItems(r);
      const bbox = r.reduce((b, x) => [Math.min(b[0], x.lon), Math.min(b[1], x.lat), Math.max(b[2], x.lon), Math.max(b[3], x.lat)], [180, 90, -180, -90]);
      if (r.length) void engine.flyToBBox([bbox[0] - 0.2, bbox[1] - 0.2, bbox[2] + 0.2, bbox[3] + 0.2]);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div class="col">
      <div class="seg">
        <button class={kind === "buildings" ? "on" : ""} onClick={() => setKind("buildings")}>
          <Building2 size={13} /> {t("Edificios más altos")}
        </button>
        <button class={kind === "peaks" ? "on" : ""} onClick={() => setKind("peaks")}>
          <Mountain size={13} /> {t("Montañas")}
        </button>
        <button class={kind === "cities" ? "on" : ""} onClick={() => setKind("cities")}>
          <Users size={13} /> {t("Ciudades")}
        </button>
      </div>
      <div class="row">
        <input class="input grow" value={country} onInput={(e) => setCountry((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && run()} aria-label={t("País")} />
        <button class="btn primary" onClick={run} disabled={loading}>
          {loading ? <Loader2 size={14} /> : t("Consultar")}
        </button>
      </div>
      {loading && <span class="faint">{t("Consultando Wikidata (puede tardar hasta 30 s)…")}</span>}
      {items?.map((it, i) => (
        <button key={it.qid} class="list-item" onClick={() => engine.cinematicFlyTo(it, kind === "buildings" ? 600 : kind === "peaks" ? 9000 : 25000)}>
          <b style={{ width: "22px" }}>{i + 1}</b>
          <div class="grow">
            <div style={{ fontWeight: 600 }}>{it.name}</div>
            <div class="faint">
              {kind === "cities" ? `${Math.round(it.value).toLocaleString()} hab.` : `${Math.round(it.value)} m`}
            </div>
          </div>
        </button>
      ))}
      {items && items.length === 0 && <span class="faint">{t("Wikidata no devolvió resultados para esta consulta.")}</span>}
      <div class="sources">
        {t("Fuente")}: <a href={WIKIDATA_SOURCE.url}>{WIKIDATA_SOURCE.name}</a> ({WIKIDATA_SOURCE.license}). {t("Los datos colaborativos pueden estar incompletos o desactualizados.")}
      </div>
    </div>
  );
}

function CompareTab() {
  const engine = useEngine();
  const [a, setA] = useState("Buenos Aires");
  const [b, setB] = useState("Madrid");
  const [res, setRes] = useState<{ a: { name: string; f: Factsheet | null; lon: number; lat: number }; b: { name: string; f: Factsheet | null; lon: number; lat: number }; d: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const lang = settings.value.lang;
      const [pa, pb] = await Promise.all([searchBest(a, { lang }), searchBest(b, { lang })]);
      const A = pa[0];
      const B = pb[0];
      if (!A || !B) throw new Error(t("No se encontró alguno de los lugares."));
      const [fa, fb] = await Promise.all([A.extratags?.["wikidata"] ? wikidataFactsheet(A.extratags["wikidata"], lang) : null, B.extratags?.["wikidata"] ? wikidataFactsheet(B.extratags["wikidata"], lang) : null]);
      setRes({ a: { name: A.name, f: fa, lon: A.lon, lat: A.lat }, b: { name: B.name, f: fb, lon: B.lon, lat: B.lat }, d: inverse(A, B).distance });
      engine.userData.add({
        geometry: { type: "LineString", coordinates: [[A.lon, A.lat], [B.lon, B.lat]] },
        properties: { name: `${A.name} ↔ ${B.name}`, color: "#f472b6", kind: "measurement", createdAt: new Date().toISOString() },
      });
      const w = Math.min(A.lon, B.lon);
      const e = Math.max(A.lon, B.lon);
      void engine.flyToBBox([w - 5, Math.min(A.lat, B.lat) - 5, e + 5, Math.max(A.lat, B.lat) + 5]);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setLoading(false);
    }
  };
  const row = (label: string, va?: number, vb?: number, fmt = (v: number) => Math.round(v).toLocaleString()) => (
    <tr>
      <td class="faint">{label}</td>
      <td style={{ textAlign: "right" }}>{va !== undefined ? fmt(va) : "—"}</td>
      <td style={{ textAlign: "right" }}>{vb !== undefined ? fmt(vb) : "—"}</td>
    </tr>
  );
  return (
    <div class="col">
      <div class="row">
        <input class="input" value={a} onInput={(e) => setA((e.target as HTMLInputElement).value)} aria-label={t("Lugar A")} />
        <input class="input" value={b} onInput={(e) => setB((e.target as HTMLInputElement).value)} aria-label={t("Lugar B")} />
      </div>
      <button class="btn primary" onClick={run} disabled={loading}>
        {loading ? <Loader2 size={14} /> : <Scale size={14} />} {t("Comparar ciudades")}
      </button>
      {res && (
        <div class="card">
          <table style={{ width: "100%", fontSize: "0.92em" }}>
            <thead>
              <tr>
                <th />
                <th style={{ textAlign: "right" }}>{res.a.name}</th>
                <th style={{ textAlign: "right" }}>{res.b.name}</th>
              </tr>
            </thead>
            <tbody>
              {row(t("Población"), res.a.f?.population, res.b.f?.population)}
              {row(t("Superficie (km²)"), res.a.f?.area, res.b.f?.area, (v) => v.toFixed(0))}
              {row(t("Densidad (hab/km²)"), res.a.f?.population && res.a.f.area ? res.a.f.population / res.a.f.area : undefined, res.b.f?.population && res.b.f.area ? res.b.f.population / res.b.f.area : undefined)}
              {row(t("Altitud (m)"), res.a.f?.elevation, res.b.f?.elevation)}
              {row(t("Latitud"), res.a.lat, res.b.lat, (v) => v.toFixed(2) + "°")}
            </tbody>
          </table>
          <div style={{ marginTop: "8px" }}>
            {t("Distancia geodésica")}: <b>{formatDistance(res.d, settings.value.units)}</b>
          </div>
          <div class="faint">{t("Fuentes")}: Wikidata (CC0), OSM/Nominatim (ODbL)</div>
        </div>
      )}
    </div>
  );
}

const LESSONS: { title: string; text: string; lon: number; lat: number; height: number; pitch: number; layer?: string }[] = [
  { title: "Tectónica: la cordillera de los Andes", text: "Los Andes se forman por la subducción de la placa de Nazca bajo la Sudamericana. Activá la exageración vertical ×2 para apreciar el relieve.", lon: -70.0, lat: -32.65, height: 60000, pitch: -30 },
  { title: "Glaciares: Perito Moreno", text: "Glaciar del Campo de Hielo Patagónico Sur. Compará épocas en el modo histórico (Landsat 1986 vs. Sentinel-2).", lon: -73.05, lat: -50.48, height: 9000, pitch: -35 },
  { title: "Deltas: el delta del Paraná", text: "Un delta en crecimiento que avanza sobre el Río de la Plata por la sedimentación.", lon: -58.6, lat: -34.2, height: 70000, pitch: -60 },
  { title: "Desiertos: el Sahara", text: "El desierto cálido más grande del mundo. Activá la capa de cobertura del suelo.", lon: 10, lat: 23, height: 3500000, pitch: -90, layer: "landcover" },
  { title: "Selvas: la Amazonia", text: "Observá la deforestación en Rondônia comparando MODIS 2000 con imágenes recientes.", lon: -62.5, lat: -10.5, height: 400000, pitch: -80, layer: "landcover" },
  { title: "Volcanes: el Teide", text: "Estratovolcán de Tenerife, 3715 m. Usá la herramienta de perfil para medir su desnivel.", lon: -16.64, lat: 28.27, height: 12000, pitch: -30 },
  { title: "Fosas oceánicas: las Marianas", text: "Activá la batimetría en Capas → Terreno para ver el fondo marino (datos ETOPO1).", lon: 142.2, lat: 11.35, height: 900000, pitch: -60 },
  { title: "Población urbana mundial", text: "La capa de densidad de población (GPW) muestra dónde vive la humanidad.", lon: 80, lat: 25, height: 7000000, pitch: -90, layer: "population" },
];

function LearnTab() {
  const engine = useEngine();
  return (
    <div class="col">
      <span class="faint">{t("Lecciones guiadas con datos reales. Cada una lleva la cámara al lugar y activa las capas útiles.")}</span>
      {LESSONS.map((l) => (
        <button
          key={l.title}
          class="tile-btn"
          onClick={() => {
            if (l.layer) engine.imagery.toggleOverlay(l.layer, true);
            void engine.flyTo({ lon: l.lon, lat: l.lat, height: l.height, pitch: l.pitch, duration: 4 });
            notify(t(l.text), "info", 10000);
          }}
        >
          <span class="tb-t">{t(l.title)}</span>
          <span class="tb-s">{t(l.text)}</span>
        </button>
      ))}
    </div>
  );
}
