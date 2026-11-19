import { useEffect, useState } from "preact/hooks";
import { KeyRound, Trash2, Gauge, Accessibility, Languages, Database } from "lucide-preact";
import { Panel } from "./PanelHost.tsx";
import { useEngine } from "../context.ts";
import { settings, updateSettings, resetSettings, effectiveQuality, fps, notify, type Settings } from "../../state/store.ts";
import { cacheClear, cacheStats } from "../../services/cache.ts";
import { serverStatus, type ServerStatus } from "../../services/api.ts";
import { LANGUAGES, t } from "../../i18n/index.ts";

function Toggle({ k, label }: { k: keyof Settings; label: string }) {
  return (
    <label class="row">
      <input type="checkbox" checked={Boolean(settings.value[k])} onChange={(e) => updateSettings({ [k]: (e.target as HTMLInputElement).checked } as Partial<Settings>)} />
      <span>{t(label)}</span>
    </label>
  );
}

function Slider({ k, label, min, max, step, unit = "" }: { k: keyof Settings; label: string; min: number; max: number; step: number; unit?: string }) {
  const v = Number(settings.value[k]);
  return (
    <label class="col" style={{ gap: "2px" }}>
      <span class="row between">
        <span class="faint">{t(label)}</span>
        <span class="mono">
          {v}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={v} onInput={(e) => updateSettings({ [k]: Number((e.target as HTMLInputElement).value) } as Partial<Settings>)} />
    </label>
  );
}

export function SettingsPanel() {
  const engine = useEngine();
  const s = settings.value;
  const [stats, setStats] = useState<{ entries: number; memoryEntries: number; memoryBytes: number } | null>(null);
  const [server, setServer] = useState<ServerStatus | null>(null);
  useEffect(() => {
    void cacheStats().then(setStats);
  }, []);
  useEffect(() => {
    void serverStatus().then(setServer);
  }, [s.serverUrl]);

  return (
    <Panel title={t("Ajustes")}>
      <div class="section-title row">
        <Languages size={12} /> {t("Idioma y unidades")}
      </div>
      <div class="row">
        <select class="input" value={s.lang} onChange={(e) => updateSettings({ lang: (e.target as HTMLSelectElement).value as Settings["lang"] })} aria-label={t("Idioma")}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <div class="seg">
          <button class={s.units === "metric" ? "on" : ""} onClick={() => updateSettings({ units: "metric" })}>
            {t("Métrico")}
          </button>
          <button class={s.units === "imperial" ? "on" : ""} onClick={() => updateSettings({ units: "imperial" })}>
            {t("Imperial")}
          </button>
        </div>
      </div>
      <div class="seg">
        {(["dark", "light", "auto"] as const).map((th) => (
          <button key={th} class={s.theme === th ? "on" : ""} onClick={() => updateSettings({ theme: th })}>
            {t({ dark: "Oscuro", light: "Claro", auto: "Automático" }[th])}
          </button>
        ))}
      </div>

      <div class="section-title row">
        <Gauge size={12} /> {t("Rendimiento")}
      </div>
      <div class="seg">
        {(["auto", "low", "medium", "high", "ultra"] as const).map((q) => (
          <button key={q} class={s.quality === q ? "on" : ""} onClick={() => updateSettings({ quality: q })}>
            {t({ auto: "Auto", low: "Baja", medium: "Media", high: "Alta", ultra: "Ultra" }[q])}
          </button>
        ))}
      </div>
      <span class="faint">
        {t("Calidad efectiva")}: <b>{effectiveQuality.value}</b> · {fps.value} FPS. {t("En automático se reduce la calidad si no se alcanza el objetivo de FPS.")}
      </span>
      <Slider k="targetFps" label="Objetivo de FPS" min={30} max={120} step={10} />
      <Toggle k="showFps" label="Mostrar FPS en la barra de estado" />

      <div class="section-title">{t("Navegación")}</div>
      <Slider k="fov" label="Campo de visión" min={30} max={100} step={5} unit="°" />
      <Slider k="navSpeed" label="Velocidad de movimiento" min={0.2} max={5} step={0.1} unit="×" />
      <Slider k="sensitivity" label="Sensibilidad del ratón" min={0.2} max={3} step={0.1} unit="×" />
      <Slider k="pedestrianEyeHeight" label="Altura de los ojos (peatón)" min={1} max={2.5} step={0.1} unit=" m" />
      <Toggle k="minimap" label="Minimapa" />
      <Toggle k="narrator" label="Narrador por voz en recorridos y asistente" />

      <div class="section-title row">
        <Accessibility size={12} /> {t("Accesibilidad")}
      </div>
      <Toggle k="reducedMotion" label="Reducir movimiento (saltos directos sin animación)" />
      <Toggle k="highContrast" label="Alto contraste" />
      <Toggle k="largeText" label="Texto grande" />

      <div class="section-title row">
        <KeyRound size={12} /> {t("Claves de servicios opcionales")}
      </div>
      <span class="faint">{t("Se guardan sólo en este navegador. Permiten usar fuentes con licencia propia del usuario.")}</span>
      <label class="col" style={{ gap: "2px" }}>
        <span class="faint">{t("Token de Cesium ion (terreno mundial, Bing, OSM Buildings)")}</span>
        <input class="input" type="password" value={s.ionToken} onChange={(e) => updateSettings({ ionToken: (e.target as HTMLInputElement).value.trim() })} autocomplete="off" />
      </label>
      <label class="col" style={{ gap: "2px" }}>
        <span class="faint">{t("Clave de Google Map Tiles API (3D fotorrealista)")}</span>
        <input class="input" type="password" value={s.googleKey} onChange={(e) => updateSettings({ googleKey: (e.target as HTMLInputElement).value.trim() })} autocomplete="off" />
      </label>
      <label class="col" style={{ gap: "2px" }}>
        <span class="faint">{t("Token de cliente de Mapillary (imágenes de calle)")}</span>
        <input class="input" type="password" value={s.mapillaryToken} onChange={(e) => updateSettings({ mapillaryToken: (e.target as HTMLInputElement).value.trim() })} autocomplete="off" />
      </label>
      <label class="col" style={{ gap: "2px" }}>
        <span class="faint">{t("Servidor de EARTH NEXT (asistente con IA, estaciones METAR, PostGIS)")}</span>
        <input class="input" placeholder="https://mi-servidor.example.com" value={s.serverUrl} onChange={(e) => updateSettings({ serverUrl: (e.target as HTMLInputElement).value.trim() })} autocomplete="off" inputMode="url" />
      </label>
      <label class="col" style={{ gap: "2px" }}>
        <span class="faint">{t("Servidor Overpass (OpenStreetMap)")}</span>
        <input class="input" value={s.overpassUrl} onChange={(e) => updateSettings({ overpassUrl: (e.target as HTMLInputElement).value.trim() })} />
      </label>
      {s.ionToken && (
        <button class="btn small" onClick={() => void engine.imagery.setIonBase(2)}>
          {t("Usar Bing Maps Aerial (Cesium ion) como base")}
        </button>
      )}

      <div class="section-title row">
        <Database size={12} /> {t("Datos y servidor")}
      </div>
      <dl class="kv">
        <dt>{t("Asistente de IA")}</dt>
        <dd>{server ? (server.ai ? `${t("activo")} (${server.model})` : t("modo básico (sin clave)")) : "…"}</dd>
        <dt>PostGIS</dt>
        <dd>{server ? (server.postgis ? t("conectado") : t("no configurado")) : "…"}</dd>
        <dt>{t("Caché local")}</dt>
        <dd>{stats ? `${stats.entries} ${t("entradas")} · ${(stats.memoryBytes / 1e6).toFixed(1)} MB ${t("en memoria")}` : "…"}</dd>
      </dl>
      <Toggle k="aiEnabled" label="Usar IA del servidor cuando esté disponible" />
      <div class="row wrap">
        <button
          class="btn small"
          onClick={async () => {
            await cacheClear();
            setStats(await cacheStats());
            notify(t("Caché borrada."), "success");
          }}
        >
          <Trash2 size={14} /> {t("Borrar caché")}
        </button>
        <button class="btn small danger" onClick={() => confirm(t("¿Restablecer todos los ajustes?")) && resetSettings()}>
          {t("Restablecer ajustes")}
        </button>
      </div>
    </Panel>
  );
}
