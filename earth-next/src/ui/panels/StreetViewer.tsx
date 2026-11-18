import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { X, ChevronLeft, ChevronRight, Maximize, ExternalLink, Camera, PersonStanding, History, Loader2, Map as MapIcon } from "lucide-preact";
import { Panel } from "./PanelHost.tsx";
import { useEngine } from "../context.ts";
import type { Engine } from "../../engine/engine.ts";
import { PanoramaViewer } from "../../engine/panorama.ts";
import { streetImagesNear, panoramaxById, capturesByYear, type StreetImage } from "../../services/streetlevel.ts";
import { nearbyPois, type OsmPoi } from "../../services/overpass.ts";
import { cameraState, notify, settings, activePanel } from "../../state/store.ts";
import { downloadBlob } from "../../engine/userdata.ts";
import { haversine } from "../../geo/geodesy.ts";
import { formatDistance } from "../../geo/format.ts";
import { t } from "../../i18n/index.ts";

export const streetImage = signal<StreetImage | null>(null);
export const streetNearby = signal<StreetImage[]>([]);
export const streetSearching = signal(false);

/**
 * Abre la vista a nivel de calle: panorámica/foto real si existe cobertura;
 * si no, vista 3D aproximada a la altura de los ojos (claramente rotulada).
 */
export async function openStreetLevel(engine: Engine, p: { lon: number; lat: number }): Promise<void> {
  streetSearching.value = true;
  try {
    const imgs = await streetImagesNear(p, 120);
    streetNearby.value = imgs;
    if (imgs[0]) {
      streetImage.value = imgs[0];
      return;
    }
    notify(t("No hay fotografías a nivel de calle con licencia abierta aquí. Se muestra una vista 3D aproximada."), "info", 6000);
    engine.nav.setMode("pedestrian");
    engine.nav.dropToGround(p);
  } catch (err) {
    notify(t("Imágenes de calle no disponibles ({e}). Se muestra una vista 3D aproximada.", { e: err instanceof Error ? err.message : String(err) }), "warning");
    engine.nav.setMode("pedestrian");
    engine.nav.dropToGround(p);
  } finally {
    streetSearching.value = false;
  }
}

export function StreetViewer() {
  const engine = useEngine();
  const img = streetImage.value;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<PanoramaViewer | null>(null);
  const [loading, setLoading] = useState(false);
  const [heading, setHeading] = useState(0);
  const [showYears, setShowYears] = useState(false);
  const [pois, setPois] = useState<OsmPoi[]>([]);

  useEffect(() => {
    if (!img?.is360 || !canvasRef.current) return;
    const v = new PanoramaViewer(canvasRef.current);
    viewerRef.current = v;
    v.onChange = (view) => setHeading(((img.heading ?? 0) + view.yaw) % 360);
    canvasRef.current.focus();
    return () => {
      v.destroy();
      viewerRef.current = null;
    };
  }, [img?.is360, !!img]);

  useEffect(() => {
    if (!img) return;
    setLoading(true);
    if (img.is360 && viewerRef.current) {
      viewerRef.current
        .load(img.url)
        .catch(() => notify(t("No se pudo cargar la panorámica."), "error"))
        .finally(() => setLoading(false));
    } else setLoading(false);
    setHeading(img.heading ?? 0);
    // Lugares cercanos (OSM) para orientarse
    nearbyPois(img, 250)
      .then((p) => setPois(p.map((x) => ({ ...x, distance: haversine(img, x) })).sort((a, b) => a.distance! - b.distance!).slice(0, 8)))
      .catch(() => setPois([]));
  }, [img?.id]);

  if (!img) return null;

  const step = async (dir: "prev" | "next") => {
    const target = img[dir];
    if (!target) return;
    setLoading(true);
    try {
      const next = img.provider === "panoramax" ? await panoramaxById(target.id, img.sequence) : null;
      if (next) streetImage.value = next;
    } catch {
      notify(t("No se pudo avanzar a la siguiente imagen."), "warning");
    } finally {
      setLoading(false);
    }
  };

  const years = capturesByYear(streetNearby.value);

  return (
    <div class="street" role="dialog" aria-label={t("Vista a nivel de calle")}>
      {img.is360 ? <canvas ref={canvasRef} aria-label={t("Panorámica 360°: arrastrar para mirar")} /> : <img class="flat" src={img.url} alt={t("Fotografía a nivel de calle")} crossOrigin="anonymous" onLoad={() => setLoading(false)} />}
      <div class="street-hud">
        <div class="glass col" style={{ padding: "10px 12px", gap: "4px", maxWidth: "380px" }}>
          <b>{img.is360 ? t("Panorámica 360°") : t("Fotografía a nivel de calle")}</b>
          <span class="faint">
            {new Date(img.capturedAt).toLocaleDateString(settings.value.lang)} · {img.author ?? "—"} · {img.provider === "panoramax" ? "Panoramax" : "Mapillary"}
          </span>
          <span class="faint">
            {t("Licencia")}: {img.licenseUrl ? <a href={img.licenseUrl} target="_blank" rel="noopener">{img.license}</a> : img.license}
            {img.heading !== null && ` · ${t("Rumbo")} ${Math.round(heading)}°`}
          </span>
          {!img.is360 && <span class="faint">{t("Imagen plana (no 360°): se muestra tal como fue capturada.")}</span>}
          {pois.length > 0 && (
            <div class="col" style={{ gap: "2px", marginTop: "4px" }}>
              <span class="faint">{t("Cerca")}:</span>
              {pois.map((p) => (
                <span key={p.id} class="faint">
                  • {p.name} ({formatDistance(p.distance ?? 0, settings.value.units)})
                </span>
              ))}
            </div>
          )}
        </div>
        <div class="grow" />
        <div class="glass row" style={{ padding: "4px" }}>
          {loading && <Loader2 size={18} class="muted" />}
          {years.size > 1 && (
            <button class={`icon-btn ${showYears ? "active" : ""}`} onClick={() => setShowYears(!showYears)} title={t("Comparar con otras fechas")} aria-label={t("Comparar con otras fechas")}>
              <History size={18} />
            </button>
          )}
          {img.is360 && (
            <button
              class="icon-btn"
              title={t("Guardar captura")}
              aria-label={t("Guardar captura")}
              onClick={async () => {
                const data = viewerRef.current?.snapshot();
                if (data) downloadBlob(await (await fetch(data)).blob(), `calle-${img.id}.jpg`);
              }}
            >
              <Camera size={18} />
            </button>
          )}
          <a class="icon-btn" href={img.pageUrl} target="_blank" rel="noopener" title={t("Ver en el sitio del proveedor")} aria-label={t("Ver en el sitio del proveedor")}>
            <ExternalLink size={18} />
          </a>
          <button class="icon-btn" title={t("Pantalla completa")} aria-label={t("Pantalla completa")} onClick={() => document.querySelector(".street")?.requestFullscreen?.()}>
            <Maximize size={18} />
          </button>
          <button
            class="icon-btn"
            title={t("Volver a la vista aérea")}
            aria-label={t("Volver a la vista aérea")}
            onClick={() => {
              streetImage.value = null;
              void engine.flyTo({ lon: img.lon, lat: img.lat, height: 400, heading: img.heading ?? 0, pitch: -35, duration: 1.5 });
            }}
          >
            <MapIcon size={18} />
          </button>
          <button class="icon-btn" onClick={() => (streetImage.value = null)} aria-label={t("Cerrar")}>
            <X size={18} />
          </button>
        </div>
      </div>
      {showYears && (
        <div class="glass col" style={{ position: "absolute", right: "12px", top: "64px", padding: "10px", maxHeight: "60vh", overflow: "auto", width: "240px" }}>
          <b>{t("Capturas en esta zona")}</b>
          {[...years.entries()].map(([y, list]) => (
            <div key={y} class="col" style={{ gap: "4px" }}>
              <span class="section-title">{y}</span>
              {list.slice(0, 4).map((x) => (
                <button key={x.id} class={`list-item ${x.id === img.id ? "active" : ""}`} onClick={() => (streetImage.value = x)}>
                  <span class="thumb" style={{ backgroundImage: `url(${x.thumb})` }} />
                  <span class="faint">
                    {new Date(x.capturedAt).toLocaleDateString()} {x.is360 ? "· 360°" : ""}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div class="street-nav glass">
        <button class="btn" disabled={!img.prev} onClick={() => step("prev")}>
          <ChevronLeft size={18} /> {t("Anterior")}
        </button>
        <button class="btn" disabled={!img.next} onClick={() => step("next")}>
          {t("Siguiente")} <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

export function StreetPanel() {
  const engine = useEngine();
  const near = streetNearby.value;
  const search = async () => {
    const c = engine.viewCenter();
    await openStreetLevel(engine, c);
  };
  return (
    <Panel title={t("Exploración a nivel de calle")}>
      <p class="muted" style={{ margin: 0, lineHeight: 1.5 }}>
        {t("Busca fotografías y panorámicas 360° con licencia abierta (Panoramax; Mapillary con tu token) alrededor del centro de la vista. Si no hay cobertura, se ofrece una vista 3D aproximada a la altura de los ojos.")}
      </p>
      <button class="btn primary" onClick={search} disabled={streetSearching.value}>
        {streetSearching.value ? <Loader2 size={16} /> : <PersonStanding size={16} />} {t("Buscar imágenes aquí")}
      </button>
      <button
        class="btn"
        onClick={() => {
          engine.nav.setMode("pedestrian");
          activePanel.value = null;
        }}
      >
        <PersonStanding size={16} /> {t("Caminar en 3D (vista aproximada)")}
      </button>
      {near.length > 0 && (
        <>
          <div class="section-title">
            {near.length} {t("imágenes cercanas")}
          </div>
          {near.slice(0, 30).map((img) => (
            <button key={img.id} class="list-item" onClick={() => (streetImage.value = img)}>
              <span class="thumb" style={{ backgroundImage: `url(${img.thumb})` }} />
              <div class="grow">
                <div style={{ fontWeight: 600 }}>
                  {img.is360 ? "360°" : t("Foto")} · {new Date(img.capturedAt).toLocaleDateString()}
                </div>
                <div class="faint">
                  {formatDistance(img.distance ?? 0, settings.value.units)} · {img.provider} · {img.license}
                </div>
              </div>
            </button>
          ))}
        </>
      )}
      {!settings.value.mapillaryToken && <div class="faint">{t("Sugerencia: agregá un token gratuito de Mapillary en Ajustes para ampliar la cobertura mundial.")}</div>}
      <div class="faint">
        {t("Altura de la cámara actual")}: {Math.round(cameraState.value.heightAboveGround)} m
      </div>
    </Panel>
  );
}
