/**
 * Catálogo de capas de imágenes con metadatos de licencia y naturaleza del dato.
 * Todas las fuentes por defecto son abiertas o de uso público con atribución;
 * las que requieren clave del usuario se marcan con `requires`.
 */

export type LayerCategory = "base" | "overlay" | "weather" | "history" | "analysis";
/** Naturaleza del dato, mostrada siempre en la interfaz para no confundir observaciones con simulaciones. */
export type DataNature = "observed" | "composite" | "model" | "forecast" | "reference" | "simulated";

export interface LayerDef {
  id: string;
  name: string;
  nameEn: string;
  category: LayerCategory;
  nature: DataNature;
  /** Plantilla XYZ: {z} {x} {y} y opcionalmente {time} */
  url: string;
  maxLevel: number;
  minLevel?: number;
  attribution: string;
  license: string;
  licenseUrl?: string;
  description: string;
  /** Formato de fecha si la capa es temporal */
  time?: { format: "day" | "month" | "year"; start: string; end?: string; default?: string; latencyDays?: number };
  /** Opacidad sugerida al activarla */
  opacity?: number;
  /** Mostrar solo en el lado nocturno */
  nightOnly?: boolean;
  requires?: "ion" | "google";
  /** Subdominios para {s} */
  subdomains?: string[];
  credit?: string;
  /** Leyenda de colores */
  legend?: { label: string; stops: { color: string; label: string }[] };
}

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const GIBS_ATTR = "NASA EOSDIS GIBS";
const GIBS_LICENSE = "Dominio público (NASA). Se solicita atribución.";
const GIBS_LICENSE_URL = "https://www.earthdata.nasa.gov/engage/open-data-services-software-policies";
const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services";
const ESRI_LICENSE = "Términos de uso de Esri: atribución obligatoria; uso comercial requiere cuenta ArcGIS.";
const ESRI_LICENSE_URL = "https://www.esri.com/en-us/legal/terms/full-master-agreement";

function gibs(layer: string, matrix: string, ext: string, timed: boolean): string {
  return `${GIBS}/${layer}/default/${timed ? "{time}/" : ""}${matrix}/{z}/{y}/{x}.${ext}`;
}

export const LAYERS: LayerDef[] = [
  // ----------------------------------------------------------------- Bases
  {
    id: "esri-imagery",
    name: "Satélite de alta resolución",
    nameEn: "High-resolution satellite",
    category: "base",
    nature: "composite",
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    maxLevel: 19,
    attribution: "Esri, Maxar, Earthstar Geographics, comunidad de usuarios GIS",
    license: ESRI_LICENSE,
    licenseUrl: ESRI_LICENSE_URL,
    description: "Mosaico de imágenes satelitales y aéreas de distintas fechas (no es tiempo real). Hasta ~0,3 m en ciudades.",
  },
  {
    id: "bluemarble",
    name: "Blue Marble (NASA)",
    nameEn: "Blue Marble (NASA)",
    category: "base",
    nature: "composite",
    url: gibs("BlueMarble_ShadedRelief_Bathymetry", "GoogleMapsCompatible_Level8", "jpeg", false),
    maxLevel: 8,
    attribution: `${GIBS_ATTR} — Blue Marble: Next Generation`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Composición sin nubes de MODIS con relieve sombreado y batimetría (500 m/píxel).",
  },
  {
    id: "viirs-today",
    name: "Satélite del día (VIIRS)",
    nameEn: "Daily satellite (VIIRS)",
    category: "base",
    nature: "observed",
    url: gibs("VIIRS_NOAA20_CorrectedReflectance_TrueColor", "GoogleMapsCompatible_Level9", "jpg", true),
    maxLevel: 9,
    attribution: `${GIBS_ATTR} — VIIRS NOAA-20`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Imagen observada del día (incluye nubes reales). Latencia de horas; resolución ~375 m.",
    time: { format: "day", start: "2018-01-05", latencyDays: 1 },
  },
  {
    id: "osm",
    name: "Mapa de calles (OpenStreetMap)",
    nameEn: "Street map (OpenStreetMap)",
    category: "base",
    nature: "reference",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxLevel: 19,
    attribution: "© colaboradores de OpenStreetMap",
    license: "ODbL — teselas sujetas a la política de uso de la OSMF (uso moderado).",
    licenseUrl: "https://operations.osmfoundation.org/policies/tiles/",
    description: "Mapa cartográfico mundial de OpenStreetMap.",
  },
  {
    id: "esri-topo",
    name: "Mapa topográfico",
    nameEn: "Topographic map",
    category: "base",
    nature: "reference",
    url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
    maxLevel: 19,
    attribution: "Esri, HERE, Garmin, USGS, NGA, EPA, NPS",
    license: ESRI_LICENSE,
    licenseUrl: ESRI_LICENSE_URL,
    description: "Mapa topográfico con curvas de nivel, relieve y toponimia.",
  },
  {
    id: "esri-physical",
    name: "Mapa físico",
    nameEn: "Physical map",
    category: "base",
    nature: "reference",
    url: `${ESRI}/World_Physical_Map/MapServer/tile/{z}/{y}/{x}`,
    maxLevel: 8,
    attribution: "Esri, US National Park Service",
    license: ESRI_LICENSE,
    licenseUrl: ESRI_LICENSE_URL,
    description: "Relieve y cobertura natural (Natural Earth II).",
  },
  {
    id: "esri-natgeo",
    name: "Mapa de referencia (estilo atlas)",
    nameEn: "Reference map (atlas style)",
    category: "base",
    nature: "reference",
    url: `${ESRI}/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}`,
    maxLevel: 16,
    attribution: "Esri, National Geographic, Garmin, HERE, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA",
    license: ESRI_LICENSE,
    licenseUrl: ESRI_LICENSE_URL,
    description: "Mapa general estilo atlas.",
  },
  // -------------------------------------------------------------- Overlays
  {
    id: "labels",
    name: "Límites y nombres (político)",
    nameEn: "Borders and place names (political)",
    category: "overlay",
    nature: "reference",
    url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    maxLevel: 19,
    attribution: "Esri, HERE, Garmin",
    license: ESRI_LICENSE,
    licenseUrl: ESRI_LICENSE_URL,
    description: "Fronteras, divisiones administrativas y nombres de lugares.",
  },
  {
    id: "transport",
    name: "Rutas y transporte",
    nameEn: "Roads and transport",
    category: "overlay",
    nature: "reference",
    url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
    maxLevel: 19,
    attribution: "Esri, HERE, Garmin",
    license: ESRI_LICENSE,
    licenseUrl: ESRI_LICENSE_URL,
    description: "Autopistas, rutas, calles y ferrocarriles sobre la imagen satelital.",
  },
  {
    id: "osm-reference",
    name: "Costas y referencias OSM",
    nameEn: "OSM coastlines and features",
    category: "overlay",
    nature: "reference",
    url: gibs("Reference_Features_15m", "GoogleMapsCompatible_Level13", "png", false),
    maxLevel: 13,
    attribution: `${GIBS_ATTR}, © colaboradores de OpenStreetMap`,
    license: "ODbL (datos OSM) servidos por NASA GIBS",
    licenseUrl: "https://www.openstreetmap.org/copyright",
    description: "Costas, ríos, lagos y rutas principales derivados de OSM.",
  },
  {
    id: "night-lights",
    name: "Luces nocturnas (Black Marble)",
    nameEn: "Night lights (Black Marble)",
    category: "overlay",
    nature: "composite",
    url: gibs("VIIRS_Black_Marble", "GoogleMapsCompatible_Level8", "png", true),
    maxLevel: 8,
    attribution: `${GIBS_ATTR} — Black Marble 2016`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Composición anual de luces nocturnas (2016), visible sólo en el lado nocturno del planeta.",
    time: { format: "year", start: "2012-01-01", end: "2016-01-01", default: "2016-01-01" },
    nightOnly: true,
  },
  {
    id: "clouds-observed",
    name: "Nubes observadas del día",
    nameEn: "Observed clouds (daily)",
    category: "weather",
    nature: "observed",
    url: gibs("VIIRS_SNPP_CorrectedReflectance_TrueColor", "GoogleMapsCompatible_Level9", "jpg", true),
    maxLevel: 9,
    attribution: `${GIBS_ATTR} — VIIRS Suomi NPP`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Imagen en color verdadero del día seleccionado (nubes reales). Se recomienda opacidad parcial.",
    time: { format: "day", start: "2015-11-24", latencyDays: 1 },
    opacity: 0.55,
  },
  // --------------------------------------------------------------- Clima
  {
    id: "imerg",
    name: "Precipitación (IMERG)",
    nameEn: "Precipitation (IMERG)",
    category: "weather",
    nature: "observed",
    url: gibs("IMERG_Precipitation_Rate", "GoogleMapsCompatible_Level6", "png", true),
    maxLevel: 6,
    attribution: `${GIBS_ATTR} — GPM IMERG`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Tasa de precipitación estimada por satélite (GPM IMERG, diaria).",
    time: { format: "day", start: "2000-06-01", latencyDays: 2 },
    opacity: 0.8,
  },
  {
    id: "airs-temp",
    name: "Temperatura del aire en superficie (AIRS)",
    nameEn: "Surface air temperature (AIRS)",
    category: "weather",
    nature: "observed",
    url: gibs("AIRS_L3_Surface_Air_Temperature_Daily_Day", "GoogleMapsCompatible_Level6", "png", true),
    maxLevel: 6,
    attribution: `${GIBS_ATTR} — AIRS (Aqua)`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Temperatura del aire en superficie medida por el sondeador AIRS (diurna, diaria).",
    time: { format: "day", start: "2002-09-01", latencyDays: 10 },
    opacity: 0.7,
  },
  {
    id: "sst",
    name: "Temperatura del mar (GHRSST)",
    nameEn: "Sea surface temperature (GHRSST)",
    category: "weather",
    nature: "observed",
    url: gibs("GHRSST_L4_MUR_Sea_Surface_Temperature", "GoogleMapsCompatible_Level7", "png", true),
    maxLevel: 7,
    attribution: `${GIBS_ATTR} — GHRSST MUR`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Temperatura superficial del mar (análisis L4, multisensor).",
    time: { format: "day", start: "2002-06-01", latencyDays: 2 },
    opacity: 0.75,
  },
  // ------------------------------------------------------------- Análisis
  {
    id: "population",
    name: "Densidad de población 2020 (GPW)",
    nameEn: "Population density 2020 (GPW)",
    category: "analysis",
    nature: "model",
    url: gibs("GPW_Population_Density_2020", "GoogleMapsCompatible_Level7", "png", false),
    maxLevel: 7,
    attribution: "CIESIN / SEDAC — Gridded Population of the World v4, vía NASA GIBS",
    license: "CC BY 4.0",
    licenseUrl: "https://sedac.ciesin.columbia.edu/data/collection/gpw-v4",
    description: "Habitantes por km² modelados a partir de censos nacionales (~1 km).",
    opacity: 0.7,
    legend: {
      label: "hab/km²",
      stops: [
        { color: "#ffffb2", label: "<1" },
        { color: "#fecc5c", label: "5" },
        { color: "#fd8d3c", label: "25" },
        { color: "#f03b20", label: "250" },
        { color: "#bd0026", label: ">1000" },
      ],
    },
  },
  {
    id: "landcover",
    name: "Cobertura del suelo (MODIS)",
    nameEn: "Land cover (MODIS)",
    category: "analysis",
    nature: "observed",
    url: gibs("MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual", "GoogleMapsCompatible_Level8", "png", true),
    maxLevel: 8,
    attribution: `${GIBS_ATTR} — MODIS MCD12Q1`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Clasificación IGBP anual: bosques, sabanas, cultivos, zonas urbanas, nieve y hielo… Útil para ver deforestación y expansión urbana.",
    time: { format: "year", start: "2001-01-01", end: "2024-01-01", default: "2024-01-01" },
    opacity: 0.65,
  },
  {
    id: "relief",
    name: "Relieve sombreado (ASTER GDEM)",
    nameEn: "Shaded relief (ASTER GDEM)",
    category: "analysis",
    nature: "observed",
    url: gibs("ASTER_GDEM_Color_Shaded_Relief", "GoogleMapsCompatible_Level12", "jpeg", false),
    maxLevel: 12,
    attribution: `${GIBS_ATTR} — ASTER GDEM (METI/NASA)`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Modelo digital de elevación coloreado por altura con sombreado.",
    opacity: 0.8,
  },
  {
    id: "transport-infra",
    name: "Infraestructura (rutas y vías)",
    nameEn: "Infrastructure (roads and rail)",
    category: "analysis",
    nature: "reference",
    url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
    maxLevel: 19,
    attribution: "Esri, HERE, Garmin",
    license: ESRI_LICENSE,
    licenseUrl: ESRI_LICENSE_URL,
    description: "Red vial y ferroviaria.",
  },
  // ------------------------------------------------------------- Histórico
  {
    id: "hist-landsat",
    name: "Landsat anual 1984–2000 (WELD)",
    nameEn: "Annual Landsat 1984–2000 (WELD)",
    category: "history",
    nature: "composite",
    url: gibs("Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual", "GoogleMapsCompatible_Level12", "jpg", true),
    maxLevel: 12,
    attribution: `${GIBS_ATTR} — Landsat WELD (USGS/NASA)`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Mosaicos anuales Landsat (30 m). Cobertura global en años seleccionados.",
    time: { format: "year", start: "1985-12-01", end: "2000-12-01", default: "2000-12-01" },
  },
  {
    id: "hist-modis",
    name: "MODIS diario 2000–hoy",
    nameEn: "Daily MODIS 2000–today",
    category: "history",
    nature: "observed",
    url: gibs("MODIS_Terra_CorrectedReflectance_TrueColor", "GoogleMapsCompatible_Level9", "jpg", true),
    maxLevel: 9,
    attribution: `${GIBS_ATTR} — MODIS Terra`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Una imagen observada por día desde febrero de 2000 (250 m). Ideal para glaciares, costas, incendios, deforestación a gran escala.",
    time: { format: "day", start: "2000-02-24", latencyDays: 1 },
  },
  {
    id: "hist-hls",
    name: "Landsat/Sentinel-2 armonizado (HLS)",
    nameEn: "Harmonized Landsat/Sentinel-2 (HLS)",
    category: "history",
    nature: "observed",
    url: gibs("HLS_S30_Nadir_BRDF_Adjusted_Reflectance", "GoogleMapsCompatible_Level12", "png", true),
    maxLevel: 12,
    attribution: `${GIBS_ATTR} — HLS (NASA/USGS/ESA Copernicus)`,
    license: GIBS_LICENSE,
    licenseUrl: GIBS_LICENSE_URL,
    description: "Pasadas individuales de Sentinel-2 a 30 m. Hay días sin cobertura o con nubes: usar el buscador de fechas disponibles.",
    time: { format: "day", start: "2015-11-28", latencyDays: 3 },
  },
];

export function layerById(id: string): LayerDef | undefined {
  return LAYERS.find((l) => l.id === id);
}

export function formatLayerTime(def: LayerDef, date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  if (!def.time) return "";
  if (def.time.format === "year") {
    // Las capas anuales usan la fecha publicada del período (p. ej. 2016-01-01 o 2000-12-01).
    const suffix = def.time.start.slice(4);
    const startYear = Number(def.time.start.slice(0, 4));
    const endYear = Number((def.time.end ?? def.time.start).slice(0, 4));
    const year = Math.min(endYear, Math.max(startYear, y));
    return `${year}${suffix}`;
  }
  if (def.time.format === "month") return `${y}-${m}-01`;
  return `${y}-${m}-${d}`;
}

/** Fecha válida más reciente para una capa temporal (respeta latencia y fin). */
export function clampLayerDate(def: LayerDef, date: Date): Date {
  if (!def.time) return date;
  const start = new Date(def.time.start + "T00:00:00Z").getTime();
  const latest = def.time.end ? new Date(def.time.end + "T00:00:00Z").getTime() : Date.now() - (def.time.latencyDays ?? 0) * 86400000;
  return new Date(Math.min(latest, Math.max(start, date.getTime())));
}

export const NATURE_LABEL: Record<DataNature, { es: string; en: string; color: string }> = {
  observed: { es: "Observado", en: "Observed", color: "#34d399" },
  composite: { es: "Mosaico (varias fechas)", en: "Composite (multi-date)", color: "#60a5fa" },
  model: { es: "Modelo", en: "Model", color: "#a78bfa" },
  forecast: { es: "Pronóstico", en: "Forecast", color: "#fbbf24" },
  reference: { es: "Cartografía", en: "Cartography", color: "#94a3b8" },
  simulated: { es: "Efecto visual simulado", en: "Simulated visual effect", color: "#f472b6" },
};
