import { Play, Pause, RotateCcw, FastForward } from "lucide-preact";
import { useEngine } from "../context.ts";
import { cameraState, sceneTime, timeMultiplier, timePlaying } from "../../state/store.ts";
import { sunTimes } from "../../geo/astronomy.ts";
import { locale, t } from "../../i18n/index.ts";

const SPEEDS = [1, 60, 600, 3600, 86400];

/** Línea de tiempo: hora de la escena (iluminación, sombras, capas diarias) con animación acelerada. */
export function Timeline() {
  const engine = useEngine();
  const now = sceneTime.value;
  const cam = cameraState.value;
  // Hora solar local aproximada según la longitud de la cámara
  const offsetH = Math.round(cam.lon / 15);
  const local = new Date(now.getTime() + offsetH * 3600_000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const st = sunTimes(now, cam.lat, cam.lon);
  const fmt = (d: Date | null) => (d ? new Date(d.getTime() + offsetH * 3600_000).toISOString().slice(11, 16) : "—");

  const setMinutes = (m: number) => {
    const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetH * 3600_000;
    engine.time.setTime(new Date(base + m * 60_000));
  };

  const setDate = (value: string) => {
    if (!value) return;
    const [y, mo, d] = value.split("-").map(Number);
    const base = Date.UTC(y!, mo! - 1, d!) - offsetH * 3600_000;
    engine.time.setTime(new Date(base + minutes * 60_000));
  };

  const nextSpeed = () => {
    const i = SPEEDS.indexOf(timeMultiplier.value);
    engine.time.setMultiplier(SPEEDS[(i + 1) % SPEEDS.length]!);
    engine.time.play();
  };

  return (
    <div class="timeline glass" role="group" aria-label={t("Línea de tiempo")}>
      <button class="icon-btn" onClick={() => (timePlaying.value ? engine.time.pause() : engine.time.play())} aria-label={timePlaying.value ? t("Pausar") : t("Reproducir")}>
        {timePlaying.value ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button class="btn small" onClick={nextSpeed} title={t("Velocidad del tiempo")}>
        <FastForward size={14} /> ×{timeMultiplier.value >= 3600 ? `${timeMultiplier.value / 3600}h/s` : timeMultiplier.value}
      </button>
      <div class="when">
        <b>
          {local.toISOString().slice(11, 16)} <span class="faint">UTC{offsetH >= 0 ? "+" : ""}{offsetH} {t("solar")}</span>
        </b>
        <div>
          <input
            type="date"
            class="input"
            style={{ height: "24px", padding: "0 4px", fontSize: "12px", width: "130px" }}
            value={local.toISOString().slice(0, 10)}
            onChange={(e) => setDate((e.target as HTMLInputElement).value)}
            aria-label={t("Fecha de la escena")}
          />
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={1439}
        step={1}
        value={minutes}
        onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value))}
        aria-label={t("Hora del día")}
        style={{
          background: `linear-gradient(90deg, #0b1530 0%, #0b1530 ${pct(st.civilDawn, offsetH)}%, #f59e0b ${pct(st.sunrise, offsetH)}%, #7dd3fc 50%, #f59e0b ${pct(st.sunset, offsetH)}%, #0b1530 ${pct(st.civilDusk, offsetH)}%, #0b1530 100%)`,
          height: "6px",
          borderRadius: "4px",
        }}
      />
      <div class="faint hide-mobile" style={{ lineHeight: 1.2, textAlign: "right", minWidth: "92px" }}>
        ☀ {fmt(st.sunrise)} – {fmt(st.sunset)}
        <br />
        {st.regime === "polar-day" ? t("Sol de medianoche") : st.regime === "polar-night" ? t("Noche polar") : `${st.dayLengthHours.toFixed(1)} h ${t("de luz")}`}
      </div>
      <button class="icon-btn hide-mobile" onClick={() => engine.time.now()} title={t("Volver a la hora actual")} aria-label={t("Hora actual")}>
        <RotateCcw size={17} />
      </button>
      <span class="sr-only" aria-live="polite">
        {now.toLocaleString(locale())}
      </span>
    </div>
  );
}

function pct(d: Date | null, offsetH: number): number {
  if (!d) return 50;
  const l = new Date(d.getTime() + offsetH * 3600_000);
  return ((l.getUTCHours() * 60 + l.getUTCMinutes()) / 1440) * 100;
}
