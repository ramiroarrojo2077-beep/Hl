import { useState } from "preact/hooks";
import { Info, Upload, Eye, EyeOff, Trash2, Crosshair, Building2, Mountain } from "lucide-preact";
import { Panel } from "./PanelHost.tsx";
import { useEngine } from "../context.ts";
import { LAYERS, NATURE_LABEL, type LayerDef, type LayerCategory } from "../../engine/catalog.ts";
import { activeBase, activeOverlays } from "../../engine/imagery.ts";
import { buildingStatus, QUALITY_COLORS } from "../../engine/buildings.ts";
import { importedLayers } from "../../engine/userdata.ts";
import { settings, updateSettings, notify } from "../../state/store.ts";
import { t } from "../../i18n/index.ts";

export function NatureChip({ def }: { def: LayerDef }) {
  const n = NATURE_LABEL[def.nature];
  return (
    <span class="chip" style={{ color: n.color }}>
      {settings.value.lang === "es" ? n.es : n.en}
    </span>
  );
}

function LayerRow({ def, active, onToggle, kind }: { def: LayerDef; active: boolean; onToggle: () => void; kind: "radio" | "check" }) {
  const engine = useEngine();
  const [info, setInfo] = useState(false);
  const ov = activeOverlays.value.find((o) => o.id === def.id);
  const name = settings.value.lang === "es" ? def.name : def.nameEn;
  return (
    <div class={`card ${active ? "" : ""}`} style={{ padding: "8px 10px", borderColor: active ? "var(--accent)" : undefined }}>
      <div class="row">
        <input type={kind === "radio" ? "radio" : "checkbox"} name={kind === "radio" ? "base-layer" : undefined} checked={active} onChange={onToggle} id={`lyr-${def.id}`} aria-label={name} />
        <label for={`lyr-${def.id}`} class="grow" style={{ cursor: "pointer", fontWeight: 600 }}>
          {name}
        </label>
        <NatureChip def={def} />
        <button class="icon-btn" style={{ width: "28px", height: "28px" }} onClick={() => setInfo(!info)} aria-label={t("Información de la capa")}>
          <Info size={15} />
        </button>
      </div>
      {active && ov && (
        <div class="row" style={{ marginTop: "6px" }}>
          <span class="faint">{t("Opacidad")}</span>
          <input type="range" min={0} max={1} step={0.05} value={ov.opacity} onInput={(e) => engine.imagery.setOpacity(def.id, Number((e.target as HTMLInputElement).value))} aria-label={t("Opacidad")} />
          {def.time && (
            <input
              type="date"
              class="input"
              style={{ width: "140px", height: "28px" }}
              value={ov.date?.slice(0, 10)}
              min={def.time.start}
              max={def.time.end ?? new Date().toISOString().slice(0, 10)}
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v) engine.imagery.setDate(def.id, new Date(v + "T12:00:00Z"));
              }}
              aria-label={t("Fecha de la capa")}
            />
          )}
        </div>
      )}
      {info && (
        <div class="col faint" style={{ marginTop: "6px", gap: "4px" }}>
          <span>{def.description}</span>
          <span>
            {t("Fuente")}: {def.attribution}
          </span>
          <span>
            {t("Licencia")}: {def.licenseUrl ? <a href={def.licenseUrl} target="_blank" rel="noopener">{def.license}</a> : def.license}
          </span>
          {def.time && <span>{t("Disponible desde")} {def.time.start}{def.time.end ? ` ${t("hasta")} ${def.time.end}` : ""}</span>}
          {def.legend && (
            <div class="row wrap" style={{ gap: "4px" }}>
              {def.legend.stops.map((s) => (
                <span key={s.label} class="row" style={{ gap: "3px" }}>
                  <span class="badge-dot" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
              <span>{def.legend.label}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const GROUPS: { cat: LayerCategory; title: string }[] = [
  { cat: "overlay", title: "Superposiciones" },
  { cat: "analysis", title: "Análisis y población" },
  { cat: "weather", title: "Clima observado (satélite)" },
];

export function LayersPanel() {
  const engine = useEngine();
  const s = settings.value;
  const b = buildingStatus.value;
  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    for (const f of Array.from(input.files ?? [])) {
      try {
        await engine.userData.importFile(f);
        notify(t("Capa \"{n}\" importada.", { n: f.name }), "success");
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), "error", 8000);
      }
    }
    input.value = "";
  };
  return (
    <Panel title={t("Capas")}>
      <div class="section-title">{t("Mapa base")}</div>
      {LAYERS.filter((l) => l.category === "base").map((def) => (
        <LayerRow key={def.id} def={def} kind="radio" active={activeBase.value === def.id} onToggle={() => engine.imagery.setBase(def.id)} />
      ))}

      <div class="section-title">
        <Mountain size={12} /> {t("Terreno")}
      </div>
      <div class="seg" role="radiogroup">
        {(
          [
            ["terrarium", "Abierto (AWS)"],
            ["ion", "Cesium World"],
            ["ellipsoid", "Sin relieve"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} class={s.terrain === id ? "on" : ""} onClick={() => updateSettings({ terrain: id })} role="radio" aria-checked={s.terrain === id}>
            {t(label)}
          </button>
        ))}
      </div>
      <label class="row">
        <span class="grow faint">
          {t("Exageración vertical")} ×{s.terrainExaggeration.toFixed(1)}
        </span>
        <input type="range" min={1} max={5} step={0.5} value={s.terrainExaggeration} style={{ width: "140px" }} onInput={(e) => updateSettings({ terrainExaggeration: Number((e.target as HTMLInputElement).value) })} />
      </label>
      <label class="row">
        <input type="checkbox" checked={s.bathymetry} onChange={(e) => updateSettings({ bathymetry: (e.target as HTMLInputElement).checked })} />
        <span>{t("Mostrar batimetría (relieve del fondo oceánico)")}</span>
      </label>

      <div class="section-title">
        <Building2 size={12} /> {t("Edificios 3D")}
      </div>
      <div class="seg" role="radiogroup">
        {(
          [
            ["osm", "OSM (abierto)"],
            ["ion-osm", "Cesium OSM"],
            ["google", "Fotorrealista Google"],
            ["off", "Ninguno"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} class={s.buildings === id ? "on" : ""} onClick={() => updateSettings({ buildings: id })} role="radio" aria-checked={s.buildings === id}>
            {t(label)}
          </button>
        ))}
      </div>
      {s.buildings === "osm" && (
        <div class="card col" style={{ gap: "6px" }}>
          <div class="row between">
            <span class="faint">{t("Colorear por")}</span>
            <div class="seg">
              {(
                [
                  ["quality", "Calidad del dato"],
                  ["height", "Altura"],
                  ["neutral", "Neutro"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} class={s.buildingColorMode === id ? "on" : ""} onClick={() => updateSettings({ buildingColorMode: id })}>
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
          {s.buildingColorMode === "quality" && (
            <div class="col faint" style={{ gap: "3px" }}>
              <span class="row">
                <span class="badge-dot" style={{ background: QUALITY_COLORS.measured }} /> {t("Altura registrada en OSM")} ({b.measured})
              </span>
              <span class="row">
                <span class="badge-dot" style={{ background: QUALITY_COLORS.levels }} /> {t("Estimada por cantidad de pisos")} ({b.levels})
              </span>
              <span class="row">
                <span class="badge-dot" style={{ background: QUALITY_COLORS.default, opacity: 0.6 }} /> {t("Sin dato: volumen aproximado (semitransparente)")} ({b.defaults})
              </span>
            </div>
          )}
          <span class="faint">
            {b.active ? t("{n} edificios en memoria · {t} teselas", { n: b.buildings, t: b.tilesLoaded }) : t("Se cargan al acercarse a menos de 6 km de altura.")}
          </span>
          {b.error && <span class="faint" style={{ color: "var(--warn)" }}>{b.error}</span>}
          <label class="row">
            <input type="checkbox" checked={s.urbanDetails} onChange={(e) => updateSettings({ urbanDetails: (e.target as HTMLInputElement).checked })} />
            <span>{t("Elementos urbanos OSM (árboles, faroles, paradas) bajo 900 m")}</span>
          </label>
        </div>
      )}
      {(s.buildings === "google" || s.buildings === "ion-osm") && (
        <div class="notice info">
          <Info size={16} />
          <span>{s.buildings === "google" ? t("Requiere clave propia de Google Map Tiles API (Ajustes). Incluye fachadas fotorrealistas donde Google las ofrece.") : t("Requiere token de Cesium ion (Ajustes).")}</span>
        </div>
      )}

      {GROUPS.map((g) => (
        <>
          <div class="section-title" key={g.cat}>
            {t(g.title)}
          </div>
          {LAYERS.filter((l) => l.category === g.cat).map((def) => (
            <LayerRow key={def.id} def={def} kind="check" active={activeOverlays.value.some((o) => o.id === def.id)} onToggle={() => engine.imagery.toggleOverlay(def.id)} />
          ))}
        </>
      ))}

      <div class="section-title">{t("Capas personalizadas")}</div>
      <label class="btn">
        <Upload size={16} /> {t("Importar GeoJSON, KML o KMZ")}
        <input type="file" accept=".geojson,.json,.kml,.kmz" multiple onChange={onFile} style={{ display: "none" }} />
      </label>
      {importedLayers.value.map((l) => (
        <div key={l.id} class="row card" style={{ padding: "6px 8px" }}>
          <button class="icon-btn" onClick={() => engine.userData.setImportedVisible(l.id, !l.visible)} aria-label={l.visible ? t("Ocultar") : t("Mostrar")}>
            {l.visible ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <div class="grow">
            <div style={{ fontWeight: 600 }}>{l.name}</div>
            <div class="faint">
              {l.format.toUpperCase()} · {l.featureCount} {t("elementos")}
            </div>
          </div>
          <button class="icon-btn" onClick={() => engine.userData.zoomToImported(l.id)} aria-label={t("Ir a la capa")}>
            <Crosshair size={16} />
          </button>
          <button class="icon-btn" onClick={() => engine.userData.removeImported(l.id)} aria-label={t("Quitar")}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </Panel>
  );
}
