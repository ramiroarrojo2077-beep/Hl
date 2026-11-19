import { Sunrise, Sunset, Moon, Sun, Timer } from "lucide-preact";
import { Panel } from "./PanelHost.tsx";
import { useEngine } from "../context.ts";
import { cameraState, sceneTime, settings, updateSettings } from "../../state/store.ts";
import { sunPosition, sunTimes, moonPosition, moonIllumination, seasons, astronomicalSeason, dayLengthCurve } from "../../geo/astronomy.ts";
import { formatBearing, formatHours } from "../../geo/format.ts";
import { t } from "../../i18n/index.ts";

const PHASES: Record<string, string> = {
  new: "Luna nueva",
  "waxing-crescent": "Creciente",
  "first-quarter": "Cuarto creciente",
  "waxing-gibbous": "Gibosa creciente",
  full: "Luna llena",
  "waning-gibbous": "Gibosa menguante",
  "last-quarter": "Cuarto menguante",
  "waning-crescent": "Menguante",
};
const SEASONS: Record<string, string> = { spring: "Primavera", summer: "Verano", autumn: "Otoño", winter: "Invierno" };

/** Simulador astronómico: Sol, Luna, estaciones y duración del día para la ubicación de la cámara. */
export function LightingPanel() {
  const engine = useEngine();
  const date = sceneTime.value;
  const c = engine.viewCenter();
  void cameraState.value;
  const sun = sunPosition(date, c.lat, c.lon);
  const st = sunTimes(date, c.lat, c.lon);
  const moon = moonPosition(date, c.lat, c.lon);
  const ill = moonIllumination(date);
  const ss = seasons(date.getUTCFullYear());
  const offset = Math.round(c.lon / 15) * 3600_000;
  const hhmm = (d: Date | null) => (d ? new Date(d.getTime() + offset).toISOString().slice(11, 16) : "—");
  const s = settings.value;

  const curve = dayLengthCurve(date.getUTCFullYear(), c.lat, c.lon).filter((_, i) => i % 3 === 0);
  const W = 320;
  const H = 90;
  const path = curve.map((p, i) => `${i ? "L" : "M"}${((p.day / 365) * W).toFixed(1)},${(H - 6 - (p.hours / 24) * (H - 12)).toFixed(1)}`).join("");
  const doy = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000);

  const jump = (d: Date | null) => d && engine.time.setTime(d);

  return (
    <Panel title={t("Iluminación y astronomía")}>
      <div class="faint">
        {c.lat.toFixed(3)}, {c.lon.toFixed(3)} · {t(SEASONS[astronomicalSeason(date, c.lat)]!)} {t("astronómico")}
      </div>
      <div class="card col">
        <div class="row between">
          <b class="row">
            <Sun size={16} color="#fbbf24" /> {t("Sol")}
          </b>
          <span class="faint">{sun.altitude > 0 ? t("sobre el horizonte") : t("bajo el horizonte")}</span>
        </div>
        <dl class="kv">
          <dt>{t("Altura")}</dt>
          <dd>{sun.altitude.toFixed(1)}°</dd>
          <dt>{t("Acimut")}</dt>
          <dd>{formatBearing(sun.azimuth)}</dd>
          <dt>{t("Declinación")}</dt>
          <dd>{sun.declination.toFixed(2)}°</dd>
          <dt>{t("Ecuación del tiempo")}</dt>
          <dd>{sun.equationOfTime.toFixed(1)} min</dd>
          <dt>{t("Amanecer / atardecer")}</dt>
          <dd>
            {hhmm(st.sunrise)} / {hhmm(st.sunset)}
          </dd>
          <dt>{t("Mediodía solar")}</dt>
          <dd>{hhmm(st.solarNoon)}</dd>
          <dt>{t("Crepúsculo civil")}</dt>
          <dd>
            {hhmm(st.civilDawn)} / {hhmm(st.civilDusk)}
          </dd>
          <dt>{t("Duración del día")}</dt>
          <dd>{st.regime === "polar-day" ? t("24 h (sol de medianoche)") : st.regime === "polar-night" ? t("0 h (noche polar)") : formatHours(st.dayLengthHours)}</dd>
        </dl>
        <div class="row wrap">
          <button class="btn small" onClick={() => jump(st.sunrise)}>
            <Sunrise size={14} /> {t("Amanecer")}
          </button>
          <button class="btn small" onClick={() => jump(st.solarNoon)}>
            <Sun size={14} /> {t("Mediodía")}
          </button>
          <button class="btn small" onClick={() => jump(st.sunset)}>
            <Sunset size={14} /> {t("Atardecer")}
          </button>
          <button class="btn small" onClick={() => engine.time.animateDay(settings.value.reducedMotion ? 120 : 40)}>
            <Timer size={14} /> {t("Animar un día")}
          </button>
        </div>
        <span class="faint">{t("Hora mostrada: hora solar media aproximada (UTC{o}).", { o: (offset >= 0 ? "+" : "") + offset / 3600_000 })}</span>
      </div>
      <div class="card col">
        <b class="row">
          <Moon size={16} /> {t("Luna")}
        </b>
        <dl class="kv">
          <dt>{t("Fase")}</dt>
          <dd>
            {t(PHASES[ill.name]!)} ({Math.round(ill.fraction * 100)}%)
          </dd>
          <dt>{t("Edad")}</dt>
          <dd>{ill.ageDays.toFixed(1)} {t("días")}</dd>
          <dt>{t("Altura / acimut")}</dt>
          <dd>
            {moon.altitude.toFixed(1)}° / {formatBearing(moon.azimuth)}
          </dd>
          <dt>{t("Distancia")}</dt>
          <dd>{Math.round(moon.distanceKm).toLocaleString()} km</dd>
        </dl>
      </div>
      <div class="card col">
        <b>{t("Duración del día a lo largo del año")}</b>
        <svg class="chart" viewBox={`0 0 ${W} ${H}`} style={{ height: "90px" }} role="img" aria-label={t("Duración del día a lo largo del año")}>
          <line class="axis" x1="0" x2={W} y1={H - 6 - 0.5 * (H - 12)} y2={H - 6 - 0.5 * (H - 12)} stroke-dasharray="3 3" />
          <path d={path} fill="none" stroke="#fbbf24" stroke-width="2" />
          <line x1={(doy / 365) * W} x2={(doy / 365) * W} y1="0" y2={H} stroke="var(--accent)" />
          <text x="2" y="10">
            24 h
          </text>
          <text x="2" y={H - 6 - 0.5 * (H - 12) - 2}>
            12 h
          </text>
        </svg>
        <dl class="kv">
          <dt>{t("Equinoccio de marzo")}</dt>
          <dd>{ss.marchEquinox.toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
          <dt>{t("Solsticio de junio")}</dt>
          <dd>{ss.juneSolstice.toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
          <dt>{t("Equinoccio de septiembre")}</dt>
          <dd>{ss.septemberEquinox.toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
          <dt>{t("Solsticio de diciembre")}</dt>
          <dd>{ss.decemberSolstice.toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
        </dl>
        <div class="row wrap">
          {(
            [
              ["marchEquinox", "Eq. marzo"],
              ["juneSolstice", "Sol. junio"],
              ["septemberEquinox", "Eq. sept."],
              ["decemberSolstice", "Sol. dic."],
            ] as const
          ).map(([k, label]) => (
            <button key={k} class="btn small" onClick={() => engine.time.setTime(ss[k])}>
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <div class="section-title">{t("Representación")}</div>
      <div class="seg">
        <button class={s.lightingMode === "auto" ? "on" : ""} onClick={() => updateSettings({ lightingMode: "auto" })}>
          {t("Automático")}
        </button>
        <button class={s.lightingMode === "realistic" ? "on" : ""} onClick={() => updateSettings({ lightingMode: "realistic" })}>
          {t("Realista")}
        </button>
      </div>
      <span class="faint">{s.lightingMode === "auto" ? t("Automático: el Sol real ilumina relieve y edificios (luces y sombras); de noche, de cerca, la imagen se muestra con luz plena para poder leerla.") : t("Realista: el Sol real en todo momento; de noche las ciudades se ven oscuras con el resplandor de las luces nocturnas (NASA Black Marble, 500 m).")}</span>
      {(
        [
          ["atmosphere", "Atmósfera"],
          ["stars", "Cielo estrellado y Luna"],
          ["nightLights", "Luces nocturnas (NASA Black Marble)"],
          ["shadows", "Sombras dinámicas de terreno y edificios"],
        ] as const
      ).map(([k, label]) => (
        <label class="row" key={k}>
          <input type="checkbox" checked={s[k]} onChange={(e) => updateSettings({ [k]: (e.target as HTMLInputElement).checked })} />
          <span>{t(label)}</span>
        </label>
      ))}
      <span class="faint">{t("Posiciones calculadas con algoritmos de la NOAA y Meeus (precisión ~1 minuto para el Sol). Las sombras requieren calidad Alta o Ultra.")}</span>
    </Panel>
  );
}
