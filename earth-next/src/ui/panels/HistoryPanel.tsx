import { useEffect, useState } from "preact/hooks";
import { Loader2, Columns2, Image as ImageIcon, X, CloudOff } from "lucide-preact";
import { Panel } from "./PanelHost.tsx";
import { NatureChip } from "./LayersPanel.tsx";
import { useEngine } from "../context.ts";
import { LAYERS, clampLayerDate, formatLayerTime } from "../../engine/catalog.ts";
import { compareLayer } from "../../engine/imagery.ts";
import { waybackReleases, waybackLayerDef, hlsAcquisitions, type WaybackRelease, type AcquisitionDate } from "../../services/history.ts";
import { notify, settings } from "../../state/store.ts";
import { t } from "../../i18n/index.ts";

type SourceId = "wayback" | "hist-landsat" | "hist-modis" | "hist-hls" | "landcover";

const SOURCES: { id: SourceId; label: string; range: string; res: string }[] = [
  { id: "wayback", label: "Esri Wayback (alta resolución)", range: "2014 → hoy", res: "≤ 1 m" },
  { id: "hist-landsat", label: "Landsat anual (WELD)", range: "1985 → 2000", res: "30 m" },
  { id: "hist-modis", label: "MODIS diario", range: "2000 → hoy", res: "250 m" },
  { id: "hist-hls", label: "Sentinel-2 (HLS)", range: "2015 → hoy", res: "30 m" },
  { id: "landcover", label: "Cobertura del suelo (MODIS)", range: "2001 → 2024", res: "500 m" },
];

/** Modo histórico: línea temporal sobre fuentes reales y comparación con divisor. */
export function HistoryPanel() {
  const engine = useEngine();
  const [source, setSource] = useState<SourceId>("wayback");
  const [releases, setReleases] = useState<WaybackRelease[]>([]);
  const [wbIndex, setWbIndex] = useState(0);
  const [date, setDate] = useState("2005-06-15");
  const [loading, setLoading] = useState(false);
  const [acq, setAcq] = useState<AcquisitionDate[] | null>(null);
  const [mode, setMode] = useState<"compare" | "replace">("compare");

  useEffect(() => {
    setLoading(true);
    waybackReleases()
      .then((r) => {
        setReleases(r);
        setWbIndex(0);
      })
      .catch(() => notify(t("No se pudo obtener la lista de versiones de Esri Wayback."), "warning"))
      .finally(() => setLoading(false));
  }, []);

  const def = source === "wayback" ? null : LAYERS.find((l) => l.id === source)!;

  const apply = (id: string, d?: Date) => {
    if (mode === "compare") engine.imagery.setCompare(id, d);
    else engine.imagery.setBase(id, d && engine.imagery.definition(id)?.time ? formatLayerTime(engine.imagery.definition(id)!, d) : undefined);
  };

  const showWayback = (i: number) => {
    const r = releases[i];
    if (!r) return;
    setWbIndex(i);
    const d = waybackLayerDef(r);
    engine.imagery.register(d);
    apply(d.id);
  };

  const showDated = (value: string) => {
    if (!def) return;
    setDate(value);
    const d = clampLayerDate(def, new Date(value + "T12:00:00Z"));
    apply(def.id, d);
  };

  const findClearDates = async () => {
    setLoading(true);
    try {
      const b = engine.viewBBox();
      const c = engine.viewCenter();
      // Se consulta un área pequeña alrededor del centro para fechas representativas.
      const small = { west: Math.max(b.west, c.lon - 0.05), east: Math.min(b.east, c.lon + 0.05), south: Math.max(b.south, c.lat - 0.05), north: Math.min(b.north, c.lat + 0.05) };
      setAcq(await hlsAcquisitions(small, { maxCloud: 15 }));
    } catch (err) {
      notify(t("No se pudieron consultar las fechas disponibles: {e}", { e: err instanceof Error ? err.message : String(err) }), "warning");
    } finally {
      setLoading(false);
    }
  };

  const years = source === "hist-landsat" ? [1985, 1990, 1995, 2000] : source === "landcover" ? [2001, 2005, 2010, 2015, 2020, 2024] : null;

  return (
    <Panel title={t("Modo histórico")}>
      <p class="muted" style={{ margin: 0, lineHeight: 1.5 }}>
        {t("Viajá en el tiempo con imágenes satelitales reales de archivo. Compará épocas con el divisor deslizable: a la izquierda la fecha elegida, a la derecha el mapa base actual.")}
      </p>
      <div class="seg">
        <button class={mode === "compare" ? "on" : ""} onClick={() => setMode("compare")}>
          <Columns2 size={14} /> {t("Comparar")}
        </button>
        <button class={mode === "replace" ? "on" : ""} onClick={() => setMode("replace")}>
          <ImageIcon size={14} /> {t("Pantalla completa")}
        </button>
      </div>
      <div class="col" style={{ gap: "6px" }}>
        {SOURCES.map((s) => (
          <button key={s.id} class={`tile-btn ${source === s.id ? "active" : ""}`} onClick={() => setSource(s.id)}>
            <span class="tb-t">{t(s.label)}</span>
            <span class="tb-s">
              {s.range} · {s.res}
            </span>
          </button>
        ))}
      </div>

      {source === "wayback" && (
        <div class="card col">
          {loading && <Loader2 size={16} />}
          {releases.length > 0 && (
            <>
              <div class="row between">
                <b>{releases[wbIndex]?.date}</b>
                <span class="faint">
                  {wbIndex + 1}/{releases.length} {t("versiones")}
                </span>
              </div>
              <input type="range" min={0} max={releases.length - 1} value={wbIndex} onChange={(e) => showWayback(Number((e.target as HTMLInputElement).value))} aria-label={t("Versión de Wayback")} />
              <div class="row between faint">
                <span>{releases[0]?.date}</span>
                <span>{releases[releases.length - 1]?.date}</span>
              </div>
              <button class="btn small" onClick={() => showWayback(wbIndex)}>
                {t("Mostrar esta versión")}
              </button>
              <span class="faint">{t("Cada versión es el mosaico tal como se publicó en esa fecha; las imágenes de una zona pueden ser anteriores. Licencia: términos de Esri.")}</span>
            </>
          )}
        </div>
      )}

      {def && (
        <div class="card col">
          <div class="row between">
            <b>{settings.value.lang === "es" ? def.name : def.nameEn}</b>
            <NatureChip def={def} />
          </div>
          {years ? (
            <div class="seg">
              {years.map((y) => (
                <button key={y} class={date.startsWith(String(y)) ? "on" : ""} onClick={() => showDated(`${y}-06-15`)}>
                  {y}
                </button>
              ))}
            </div>
          ) : (
            <input type="date" class="input" value={date} min={def.time?.start} max={new Date().toISOString().slice(0, 10)} onChange={(e) => showDated((e.target as HTMLInputElement).value)} aria-label={t("Fecha")} />
          )}
          <span class="faint">{def.description}</span>
          {source === "hist-hls" && (
            <>
              <button class="btn small" onClick={findClearDates} disabled={loading}>
                <CloudOff size={14} /> {t("Buscar fechas con poca nubosidad aquí")}
              </button>
              {acq && (
                <div class="row wrap" style={{ gap: "4px" }}>
                  {acq.length === 0 && <span class="faint">{t("Sin pasadas despejadas registradas para esta zona.")}</span>}
                  {acq.slice(0, 40).map((a) => (
                    <button key={a.date} class="btn small" onClick={() => showDated(a.date)} title={`${a.sensor} · ${a.cloudCover ?? "?"}% ${t("nubes")}`}>
                      {a.date}
                    </button>
                  ))}
                </div>
              )}
              <span class="faint">{t("Fechas reales de adquisición consultadas en NASA CMR.")}</span>
            </>
          )}
        </div>
      )}

      {compareLayer.value && (
        <button class="btn" onClick={() => engine.imagery.setCompare(null)}>
          <X size={16} /> {t("Cerrar comparación")}
        </button>
      )}
      <div class="notice info">
        <span>{t("Sugerencias: retroceso de glaciares (Upsala, Perito Moreno), deforestación (Rondônia, Brasil), crecimiento urbano (Dubái, Shenzhen), cambios de costa (delta del Paraná). Las reconstrucciones generadas por IA no se mezclan con estas imágenes reales.")}</span>
      </div>
    </Panel>
  );
}
