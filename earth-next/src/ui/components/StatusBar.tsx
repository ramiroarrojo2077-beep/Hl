import { useState } from "preact/hooks";
import type { RefObject } from "preact";
import { Wifi, WifiOff } from "lucide-preact";
import { cameraState, cursorPosition, fps, lod, settings, effectiveQuality, loadingTiles } from "../../state/store.ts";
import { networkOnline } from "../../services/http.ts";
import { formatAltitude, formatHeight } from "../../geo/format.ts";
import { formatDMS, lonLatToUtm, formatUtm } from "../../geo/coords.ts";
import { buildingStatus } from "../../engine/buildings.ts";
import { t } from "../../i18n/index.ts";

const LOD_NAMES = ["Espacio", "Países y regiones", "Ciudades", "Barrios y edificios", "Calles", "Detalles"];

export function StatusBar({ creditsRef }: { creditsRef: RefObject<HTMLDivElement> }) {
  const [fmt, setFmt] = useState<"dd" | "dms" | "utm">("dd");
  const c = cursorPosition.value;
  const cam = cameraState.value;
  const u = settings.value.units;
  const coordText = c
    ? fmt === "dd"
      ? `${c.lat.toFixed(5)}°, ${c.lon.toFixed(5)}°`
      : fmt === "dms"
        ? formatDMS(c)
        : (() => {
            const utm = lonLatToUtm(c);
            return utm ? formatUtm(utm) : "UPS";
          })()
    : "—";
  const b = buildingStatus.value;
  return (
    <footer class="status" aria-live="off">
      <button class="btn ghost small mono" style={{ height: "22px" }} onClick={() => setFmt(fmt === "dd" ? "dms" : fmt === "dms" ? "utm" : "dd")} title={t("Cambiar formato de coordenadas")}>
        {coordText}
      </button>
      {c?.height !== null && c?.height !== undefined && <span class="hide-mobile">{t("Elev.")} {formatHeight(c.height, u)}</span>}
      <span>
        {t("Cámara")} {formatAltitude(cam.height, u)}
      </span>
      <span class="lod-badge" title={t("Nivel de detalle semántico")}>
        LOD {lod.value.level} · {t(LOD_NAMES[lod.value.level]!)}
      </span>
      {b.active && b.source === "osm" && (
        <span class="hide-mobile" title={t("Edificios OSM cargados")}>
          🏢 {b.buildings.toLocaleString()} {b.tilesLoading > 0 ? `(${t("cargando")} ${b.tilesLoading})` : ""}
        </span>
      )}
      {loadingTiles.value > 0 && <span class="hide-mobile">{t("Teselas")}: {loadingTiles.value}</span>}
      {settings.value.showFps && (
        <span class="hide-mobile">
          {fps.value} FPS · {effectiveQuality.value}
        </span>
      )}
      <span title={networkOnline.value ? t("Conectado") : t("Sin conexión: se usan datos en caché")}>{networkOnline.value ? <Wifi size={13} /> : <WifiOff size={13} color="var(--warn)" />}</span>
      <div class="credits" ref={creditsRef} />
    </footer>
  );
}
