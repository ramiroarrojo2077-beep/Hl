import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Loader2, Play, Pause, RefreshCw } from "lucide-preact";
import { Panel } from "./PanelHost.tsx";
import { useEngine } from "../context.ts";
import { forecastAt, weatherCodeText, precipitationKind, type PointForecast, WEATHER_SOURCES } from "../../services/weather.ts";
import { weatherLayers, radarState, weatherEffect } from "../../engine/weather-viz.ts";
import { activeOverlays } from "../../engine/imagery.ts";
import { settings } from "../../state/store.ts";
import { NATURE_LABEL } from "../../engine/catalog.ts";
import { t } from "../../i18n/index.ts";

export const weatherTarget = signal<{ lon: number; lat: number; name?: string } | null>(null);

function Nature({ kind }: { kind: keyof typeof NATURE_LABEL }) {
  const n = NATURE_LABEL[kind];
  return (
    <span class="chip" style={{ color: n.color }}>
      {settings.value.lang === "es" ? n.es : n.en}
    </span>
  );
}

export function WeatherPanel() {
  const engine = useEngine();
  const [fc, setFc] = useState<PointForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = weatherTarget.value ?? engine.viewCenter();
  const lang = settings.value.lang;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setFc(await forecastAt(target));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [weatherTarget.value]);

  const wl = weatherLayers.value;
  const overlay = (id: string) => activeOverlays.value.some((o) => o.id === id);
  const bbox = () => engine.viewBBox();
  const c = fc?.current;
  const code = c ? weatherCodeText(c.weatherCode, lang) : null;

  return (
    <Panel
      title={t("Clima")}
      actions={
        <button class="icon-btn" onClick={load} aria-label={t("Actualizar")}>
          <RefreshCw size={16} />
        </button>
      }
    >
      <div class="faint">
        {weatherTarget.value?.name ?? t("Centro de la vista")} · {target.lat.toFixed(3)}, {target.lon.toFixed(3)}
        {weatherTarget.value && (
          <button class="btn small ghost" onClick={() => (weatherTarget.value = null)}>
            {t("usar centro de la vista")}
          </button>
        )}
      </div>
      {loading && (
        <div class="row faint">
          <Loader2 size={16} /> {t("Consultando modelos…")}
        </div>
      )}
      {error && <div class="notice">{t("Pronóstico no disponible")}: {error}</div>}
      {c && code && (
        <div class="card col">
          <div class="row between">
            <div class="row">
              <span style={{ fontSize: "34px" }}>{code.icon}</span>
              <div>
                <div style={{ fontSize: "1.8em", fontWeight: 700 }}>{Math.round(c.temperature)}°C</div>
                <div class="muted">{code.text}</div>
              </div>
            </div>
            <Nature kind="model" />
          </div>
          <dl class="kv">
            <dt>{t("Sensación térmica")}</dt>
            <dd>{Math.round(c.apparent)}°C</dd>
            <dt>{t("Humedad")}</dt>
            <dd>{c.humidity}%</dd>
            <dt>{t("Viento")}</dt>
            <dd>
              {Math.round(c.windSpeed)} km/h {t("desde")} {Math.round(c.windDirection)}° ({t("ráfagas")} {Math.round(c.windGusts)})
            </dd>
            <dt>{t("Presión")}</dt>
            <dd>{Math.round(c.pressure)} hPa</dd>
            <dt>{t("Nubosidad")}</dt>
            <dd>{c.cloudCover}%</dd>
            <dt>{t("Precipitación")}</dt>
            <dd>
              {c.precipitation} mm{c.snowfall > 0 ? ` · ${t("nieve")} ${c.snowfall} cm` : ""}
            </dd>
          </dl>
          <span class="faint">
            {t("Análisis del modelo para")} {c.time} ({c.timezone}). {t("No es una medición: para observaciones activá estaciones METAR.")}
          </span>
        </div>
      )}
      {fc && (
        <>
          <div class="section-title row">
            {t("Pronóstico 7 días")} <Nature kind="forecast" />
          </div>
          <div class="col" style={{ gap: "4px" }}>
            {fc.daily.map((d) => {
              const w = weatherCodeText(d.weatherCode, lang);
              return (
                <div key={d.date} class="row" style={{ fontSize: "0.92em" }}>
                  <span style={{ width: "86px" }}>{new Date(d.date + "T12:00:00").toLocaleDateString(lang, { weekday: "short", day: "numeric" })}</span>
                  <span title={w.text}>{w.icon}</span>
                  <span class="grow faint">{w.text}</span>
                  <span>
                    {Math.round(d.tMin)}° / <b>{Math.round(d.tMax)}°</b>
                  </span>
                  <span class="faint" style={{ width: "62px", textAlign: "right" }}>
                    {d.precipitation.toFixed(1)} mm
                  </span>
                </div>
              );
            })}
          </div>
          <HourlyChart fc={fc} />
        </>
      )}

      <div class="section-title">{t("Capas en el globo")}</div>
      <label class="row">
        <input type="checkbox" checked={wl.radar} onChange={(e) => void engine.weather.setRadar((e.target as HTMLInputElement).checked)} />
        <span class="grow">{t("Radar de precipitación")}</span>
        <Nature kind="observed" />
      </label>
      {wl.radar && radarState.value.frames.length > 0 && (
        <div class="row">
          <button class="icon-btn" onClick={() => engine.weather.toggleRadarAnimation()} aria-label={t("Animar radar")}>
            {radarState.value.playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <input type="range" min={0} max={radarState.value.frames.length - 1} value={radarState.value.index} onInput={(e) => engine.weather.showRadarFrame(Number((e.target as HTMLInputElement).value))} />
          <span class="faint" style={{ minWidth: "88px" }}>
            {radarState.value.time ? new Date(radarState.value.time * 1000).toLocaleTimeString() : ""}
            {radarState.value.frames[radarState.value.index]?.kind === "nowcast" ? ` (${t("pronóstico")})` : ""}
          </span>
        </div>
      )}
      <label class="row">
        <input type="checkbox" checked={wl.metar} onChange={(e) => void engine.weather.setMetar((e.target as HTMLInputElement).checked, bbox())} />
        <span class="grow">{t("Estaciones meteorológicas (METAR)")}</span>
        <Nature kind="observed" />
      </label>
      <label class="row">
        <input type="checkbox" checked={wl.wind} onChange={(e) => void engine.weather.setWind((e.target as HTMLInputElement).checked, bbox())} />
        <span class="grow">{t("Viento y temperatura (grilla del modelo)")}</span>
        <Nature kind="model" />
      </label>
      <label class="row">
        <input type="checkbox" checked={wl.storms} onChange={(e) => void engine.weather.setStorms((e.target as HTMLInputElement).checked)} />
        <span class="grow">{t("Ciclones y huracanes activos")}</span>
        <Nature kind="observed" />
      </label>
      {(
        [
          ["clouds-observed", "Nubes del día (satélite)"],
          ["imerg", "Precipitación diaria por satélite"],
          ["airs-temp", "Temperatura de superficie (satélite)"],
          ["sst", "Temperatura del mar"],
        ] as const
      ).map(([id, label]) => (
        <label class="row" key={id}>
          <input type="checkbox" checked={overlay(id)} onChange={() => engine.imagery.toggleOverlay(id)} />
          <span class="grow">{t(label)}</span>
          <Nature kind="observed" />
        </label>
      ))}
      <div class="row">
        <span class="grow">{t("Efecto visual de precipitación")}</span>
        <Nature kind="simulated" />
      </div>
      <div class="seg">
        {(
          [
            ["none", "Ninguno"],
            ["rain", "Lluvia"],
            ["snow", "Nieve"],
            ["storm", "Tormenta"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} class={weatherEffect.value === id ? "on" : ""} onClick={() => engine.weather.setEffect(id)}>
            {t(label)}
          </button>
        ))}
        {c && (
          <button onClick={() => engine.weather.setEffect(precipitationKind(c.weatherCode))} title={t("Según el tiempo actual del modelo")}>
            {t("Según pronóstico")}
          </button>
        )}
      </div>
      <span class="faint">{t("El efecto de partículas es decorativo y sólo se ve cerca del suelo; no representa la intensidad real.")}</span>
      <div class="sources">
        {t("Fuentes")}:{" "}
        {Object.values(WEATHER_SOURCES).map((s, i) => (
          <span key={s.name}>
            {i > 0 && " · "}
            <a href={s.url} target="_blank" rel="noopener">
              {s.name}
            </a>{" "}
            ({s.license})
          </span>
        ))}
        {" · NASA GIBS"}
      </div>
    </Panel>
  );
}

function HourlyChart({ fc }: { fc: PointForecast }) {
  const n = Math.min(48, fc.hourly.time.length);
  if (n < 2) return null;
  const temps = fc.hourly.temperature.slice(0, n);
  const precip = fc.hourly.precipitation.slice(0, n);
  const W = 320;
  const H = 110;
  const min = Math.min(...temps.filter(Number.isFinite));
  const max = Math.max(...temps.filter(Number.isFinite));
  const pMax = Math.max(1, ...precip.filter(Number.isFinite));
  const x = (i: number) => 24 + (i / (n - 1)) * (W - 30);
  const y = (v: number) => 10 + (1 - (v - min) / Math.max(1, max - min)) * (H - 30);
  const path = temps.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Temperatura y precipitación de las próximas 48 horas")}>
      {precip.map((p, i) => (p > 0 ? <rect key={i} x={x(i) - 2} width="4" y={H - 20 - (p / pMax) * 40} height={(p / pMax) * 40} fill="#38bdf8" opacity="0.6" /> : null))}
      <path d={path} fill="none" stroke="#f59e0b" stroke-width="2" />
      <text x="2" y={y(max) + 3}>
        {Math.round(max)}°
      </text>
      <text x="2" y={y(min) + 3}>
        {Math.round(min)}°
      </text>
      <text x={W - 4} y={H - 4} text-anchor="end">
        48 h
      </text>
    </svg>
  );
}
