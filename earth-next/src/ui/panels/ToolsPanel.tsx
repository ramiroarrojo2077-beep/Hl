import { Ruler, Square, ArrowUpDown, LineChart, Mountain, MapPin, PenLine, Hexagon, Route as RouteIcon, Crosshair, Save, X, Download, Upload, FolderOpen, FileJson, Trash2 } from "lucide-preact";
import { Panel } from "./PanelHost.tsx";
import { useEngine } from "../context.ts";
import { activeTool, toolResult, profileHover, type ToolId } from "../../engine/tools.ts";
import { downloadBlob, userFeatures } from "../../engine/userdata.ts";
import { settings, notify } from "../../state/store.ts";
import { formatArea, formatDistance, formatHeight, formatBearing, formatDuration } from "../../geo/format.ts";
import { formatDMS, lonLatToUtm, formatUtm } from "../../geo/coords.ts";
import { t } from "../../i18n/index.ts";
import { ProfileChart } from "../components/ProfileChart.tsx";
import { exportProject, importProject, saveProjectLocal, projects, loadProjectLocal, deleteProjectLocal } from "../projects.ts";

const TOOLS: { id: ToolId; icon: typeof Ruler; label: string; hint: string }[] = [
  { id: "distance", icon: Ruler, label: "Distancia", hint: "Clic en cada punto; doble clic para terminar." },
  { id: "area", icon: Square, label: "Superficie", hint: "Marcá los vértices del polígono; doble clic para cerrar." },
  { id: "height", icon: ArrowUpDown, label: "Altura", hint: "Clic en la base y luego en la cima (funciona sobre edificios 3D)." },
  { id: "profile", icon: LineChart, label: "Perfil de elevación", hint: "Trazá un recorrido; doble clic para calcular el perfil." },
  { id: "slope", icon: Mountain, label: "Pendiente", hint: "Clic en un punto del terreno." },
  { id: "coordinates", icon: Crosshair, label: "Coordenadas", hint: "Clic para obtener coordenadas en varios formatos." },
  { id: "route", icon: RouteIcon, label: "Ruta por calles", hint: "Clic en el origen y en el destino." },
  { id: "draw-point", icon: MapPin, label: "Marcador", hint: "Clic para colocar un marcador." },
  { id: "draw-line", icon: PenLine, label: "Línea", hint: "Dibujá una línea; doble clic para terminar." },
  { id: "draw-polygon", icon: Hexagon, label: "Polígono", hint: "Dibujá un polígono; doble clic para cerrar." },
];

export function ToolsPanel() {
  const engine = useEngine();
  const r = toolResult.value;
  const u = settings.value.units;
  const current = TOOLS.find((x) => x.id === activeTool.value);
  return (
    <Panel title={t("Herramientas")}>
      <div class="grid2">
        {TOOLS.map(({ id, icon: Icon, label }) => (
          <button key={id} class={`tile-btn ${activeTool.value === id ? "active" : ""}`} onClick={() => engine.tools.start(activeTool.value === id ? "none" : id)} aria-pressed={activeTool.value === id}>
            <span class="tb-t">
              <Icon size={16} /> {t(label)}
            </span>
          </button>
        ))}
      </div>
      {current && (
        <div class="notice info">
          <span>{t(current.hint)} <kbd>Esc</kbd> {t("cancela")}, <kbd>⌫</kbd> {t("deshace")}.</span>
        </div>
      )}
      {r && (
        <div class="card col">
          <div class="row between">
            <b>{t(TOOLS.find((x) => x.id === r.tool)?.label ?? "Resultado")}</b>
            <div class="row">
              {!r.pending && r.points.length > 0 && (
                <button class="btn small" onClick={() => engine.tools.saveResult()}>
                  <Save size={14} /> {t("Guardar")}
                </button>
              )}
              <button class="icon-btn" onClick={() => engine.tools.clear()} aria-label={t("Borrar")}>
                <X size={16} />
              </button>
            </div>
          </div>
          {r.error && <div class="notice">{r.error}</div>}
          <dl class="kv">
            {r.distance !== undefined && (
              <>
                <dt>{t("Distancia geodésica")}</dt>
                <dd>{formatDistance(r.distance, u)}</dd>
              </>
            )}
            {r.area !== undefined && (
              <>
                <dt>{t("Superficie")}</dt>
                <dd>{formatArea(r.area, u)}</dd>
                <dt>{t("Perímetro")}</dt>
                <dd>{formatDistance(r.perimeter ?? 0, u)}</dd>
              </>
            )}
            {r.deltaHeight !== undefined && (
              <>
                <dt>{t("Diferencia de altura")}</dt>
                <dd>{formatHeight(r.deltaHeight, u)}</dd>
                <dt>{t("Distancia horizontal")}</dt>
                <dd>{formatDistance(r.horizontal ?? 0, u)}</dd>
                <dt>{t("Distancia en línea recta")}</dt>
                <dd>{formatDistance(r.slant ?? 0, u)}</dd>
                <dt>{t("Ángulo de elevación")}</dt>
                <dd>{((Math.atan2(r.deltaHeight, r.horizontal ?? 1) * 180) / Math.PI).toFixed(1)}°</dd>
                <dt>{t("Rumbo")}</dt>
                <dd>{formatBearing(r.bearing ?? 0)}</dd>
              </>
            )}
            {r.slope && (
              <>
                <dt>{t("Pendiente")}</dt>
                <dd>
                  {r.slope.degrees.toFixed(1)}° · {r.slope.percent.toFixed(1)} %
                </dd>
                <dt>{t("Orientación")}</dt>
                <dd>{r.slope.aspect !== null ? formatBearing(r.slope.aspect) : t("plano")}</dd>
                <dt>{t("Clase")}</dt>
                <dd>{t(SLOPE_CLASS[r.slope.cls] ?? r.slope.cls)}</dd>
                <dt>{t("Elevación")}</dt>
                <dd>{formatHeight(r.slope.elevation, u)}</dd>
              </>
            )}
            {r.tool === "coordinates" && r.points[0] && (
              <>
                <dt>{t("Decimal")}</dt>
                <dd class="mono">
                  {r.points[0].lat.toFixed(6)}, {r.points[0].lon.toFixed(6)}
                </dd>
                <dt>GMS</dt>
                <dd class="mono">{formatDMS(r.points[0])}</dd>
                <dt>UTM</dt>
                <dd class="mono">{(() => {
                  const x = lonLatToUtm(r.points[0]);
                  return x ? formatUtm(x) : "—";
                })()}</dd>
                <dt>{t("Elevación")}</dt>
                <dd>{formatHeight(r.points[0].height, u)}</dd>
              </>
            )}
            {r.route && (
              <>
                <dt>{t("Duración estimada")}</dt>
                <dd>{formatDuration(r.route.duration)}</dd>
                <dt>{t("Perfil")}</dt>
                <dd>{t("Auto")}</dd>
              </>
            )}
          </dl>
          {r.pending && <span class="faint">{t("Calculando…")}</span>}
          {r.profile && r.profileStats && (
            <>
              <ProfileChart samples={r.profile} onHover={(i) => (profileHover.value = i)} units={u} />
              <dl class="kv">
                <dt>{t("Mínima / máxima")}</dt>
                <dd>
                  {formatHeight(r.profileStats.minElevation, u)} / {formatHeight(r.profileStats.maxElevation, u)}
                </dd>
                <dt>{t("Desnivel positivo / negativo")}</dt>
                <dd>
                  +{formatHeight(r.profileStats.totalAscent, u)} / −{formatHeight(r.profileStats.totalDescent, u)}
                </dd>
                <dt>{t("Pendiente máx. / media")}</dt>
                <dd>
                  {r.profileStats.maxGradePercent.toFixed(1)} % / {r.profileStats.meanGradePercent.toFixed(1)} %
                </dd>
              </dl>
              <button
                class="btn small"
                onClick={() => {
                  const csv = ["distance_m,lat,lon,elevation_m", ...r.profile!.map((s) => `${s.distance.toFixed(1)},${s.lat.toFixed(6)},${s.lon.toFixed(6)},${s.elevation.toFixed(1)}`)].join("\n");
                  downloadBlob(new Blob([csv], { type: "text/csv" }), "perfil-elevacion.csv");
                }}
              >
                <Download size={14} /> CSV
              </button>
              <span class="faint">{t("Fuente: AWS Terrain Tiles (SRTM/ETOPO1 y otras). Resolución ~10–30 m.")}</span>
            </>
          )}
          {r.route && <span class="faint">{t("Ruteo: OSRM (servidor de demostración) — © OpenStreetMap. Uso no comercial y moderado.")}</span>}
        </div>
      )}

      <div class="section-title">{t("Elementos del proyecto")} ({userFeatures.value.length})</div>
      {userFeatures.value.slice(-12).reverse().map((f) => (
        <div class="row card" key={f.id} style={{ padding: "6px 8px" }}>
          <span class="badge-dot" style={{ background: f.properties.color }} />
          <input
            class="input grow"
            style={{ height: "28px" }}
            value={f.properties.name}
            onChange={(e) => engine.userData.update(f.id, { name: (e.target as HTMLInputElement).value })}
            aria-label={t("Nombre")}
          />
          <input type="color" value={f.properties.color} onInput={(e) => engine.userData.update(f.id, { color: (e.target as HTMLInputElement).value })} aria-label={t("Color")} style={{ width: "28px", height: "28px", border: "none", background: "none" }} />
          <button class="icon-btn" onClick={() => engine.userData.remove(f.id)} aria-label={t("Eliminar")}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <div class="row wrap">
        <button class="btn small" onClick={() => downloadBlob(new Blob([JSON.stringify(engine.userData.toGeoJson(), null, 2)], { type: "application/geo+json" }), "earth-next.geojson")}>
          <FileJson size={14} /> GeoJSON
        </button>
        <button class="btn small" onClick={async () => downloadBlob(await engine.userData.toKml(false), "earth-next.kml")}>
          <Download size={14} /> KML
        </button>
        <button class="btn small" onClick={async () => downloadBlob(await engine.userData.toKmzManual(), "earth-next.kmz")}>
          <Download size={14} /> KMZ
        </button>
      </div>

      <div class="section-title">{t("Proyectos")}</div>
      <div class="row wrap">
        <button
          class="btn small"
          onClick={() => {
            const name = prompt(t("Nombre del proyecto"), `Proyecto ${new Date().toLocaleDateString()}`);
            if (name) {
              saveProjectLocal(engine, name);
              notify(t("Proyecto guardado en este navegador."), "success");
            }
          }}
        >
          <Save size={14} /> {t("Guardar")}
        </button>
        <button class="btn small" onClick={() => exportProject(engine)}>
          <Download size={14} /> {t("Exportar archivo")}
        </button>
        <label class="btn small">
          <Upload size={14} /> {t("Abrir archivo")}
          <input
            type="file"
            accept=".json,.earthnext"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              try {
                await importProject(engine, await f.text());
                notify(t("Proyecto cargado."), "success");
              } catch (err) {
                notify(err instanceof Error ? err.message : String(err), "error");
              }
            }}
          />
        </label>
      </div>
      {projects.value.map((p) => (
        <div key={p.id} class="row card" style={{ padding: "6px 8px" }}>
          <FolderOpen size={15} />
          <div class="grow">
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            <div class="faint">{new Date(p.savedAt).toLocaleString()}</div>
          </div>
          <button class="btn small" onClick={() => loadProjectLocal(engine, p.id)}>
            {t("Abrir")}
          </button>
          <button class="icon-btn" onClick={() => deleteProjectLocal(p.id)} aria-label={t("Eliminar")}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </Panel>
  );
}

const SLOPE_CLASS: Record<string, string> = {
  flat: "Llano",
  gentle: "Suave",
  moderate: "Moderada",
  steep: "Empinada",
  "very-steep": "Muy empinada",
  cliff: "Escarpada / acantilado",
};
