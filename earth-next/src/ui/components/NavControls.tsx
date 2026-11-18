import { Plus, Minus, Globe2, Plane, PersonStanding, Orbit, Satellite, Clapperboard, ChevronsUp, ChevronsDown, LocateFixed } from "lucide-preact";
import { Math as CMath } from "cesium";
import { useEngine } from "../context.ts";
import { cameraState, navMode, notify, type NavMode } from "../../state/store.ts";
import { t } from "../../i18n/index.ts";

const MODES: { id: NavMode; icon: typeof Plane; label: string }[] = [
  { id: "orbital", icon: Globe2, label: "Orbital" },
  { id: "aerial", icon: Plane, label: "Aéreo" },
  { id: "drone", icon: Orbit, label: "Dron" },
  { id: "pedestrian", icon: PersonStanding, label: "Peatón" },
  { id: "satellite", icon: Satellite, label: "Satélite" },
];

export function NavControls() {
  const engine = useEngine();
  const cam = engine.viewer.camera;
  const heading = cameraState.value.heading;

  const zoom = (dir: 1 | -1) => {
    const h = Math.max(10, cameraState.value.heightAboveGround);
    if (dir > 0) cam.zoomIn(h * 0.4);
    else cam.zoomOut(h * 0.6);
  };
  const tilt = (deg: number) => {
    const p = CMath.clamp(cam.pitch + CMath.toRadians(deg), -CMath.PI_OVER_TWO, -0.05);
    cam.setView({ orientation: { heading: cam.heading, pitch: p, roll: 0 } });
  };
  const resetNorth = () => {
    cam.flyTo({ destination: cam.positionWC.clone(), orientation: { heading: 0, pitch: cam.pitch, roll: 0 }, duration: 0.6 });
  };
  const locate = () => {
    if (!navigator.geolocation) return notify(t("Geolocalización no disponible en este navegador."), "warning");
    navigator.geolocation.getCurrentPosition(
      (pos) => void engine.flyTo({ lon: pos.coords.longitude, lat: pos.coords.latitude, height: 1200, pitch: -45 }),
      (err) => notify(t("No se pudo obtener tu ubicación: {e}", { e: err.message }), "warning"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div class="navctl">
      <div class="mode-pill glass" role="radiogroup" aria-label={t("Modo de navegación")}>
        {MODES.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            class={`icon-btn ${navMode.value === id ? "active" : ""}`}
            role="radio"
            aria-checked={navMode.value === id}
            title={`${t(label)} — ${t(MODE_HELP[id])}`}
            aria-label={t(label)}
            onClick={() => engine.nav.setMode(id)}
          >
            <Icon size={18} />
          </button>
        ))}
        {navMode.value === "cinematic" && (
          <button class="icon-btn active" title={t("Cinematográfico")} onClick={() => engine.tours.stop()}>
            <Clapperboard size={18} />
          </button>
        )}
      </div>
      <button class="compass glass" onClick={resetNorth} title={t("Apuntar al norte")} aria-label={t("Apuntar al norte")}>
        <svg width="40" height="40" viewBox="0 0 40 40" style={{ transform: `rotate(${-heading}deg)` }} aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-opacity=".25" />
          <path d="M20 4 L25 20 L20 17 L15 20 Z" fill="#ef4444" />
          <path d="M20 36 L25 20 L20 23 L15 20 Z" fill="currentColor" fill-opacity=".55" />
          <text x="20" y="13" text-anchor="middle" font-size="7" font-weight="700" fill="#fff">
            N
          </text>
        </svg>
      </button>
      <div class="group glass">
        <button class="icon-btn" onClick={() => zoom(1)} title={t("Acercar")} aria-label={t("Acercar")}>
          <Plus size={18} />
        </button>
        <button class="icon-btn" onClick={() => zoom(-1)} title={t("Alejar")} aria-label={t("Alejar")}>
          <Minus size={18} />
        </button>
        <button class="icon-btn" onClick={() => tilt(15)} title={t("Inclinar hacia el horizonte")} aria-label={t("Inclinar")}>
          <ChevronsUp size={18} />
        </button>
        <button class="icon-btn" onClick={() => tilt(-15)} title={t("Mirar hacia abajo")} aria-label={t("Mirar hacia abajo")}>
          <ChevronsDown size={18} />
        </button>
        <button class="icon-btn" onClick={locate} title={t("Mi ubicación")} aria-label={t("Mi ubicación")}>
          <LocateFixed size={18} />
        </button>
      </div>
    </div>
  );
}

const MODE_HELP: Record<NavMode, string> = {
  orbital: "arrastrar para girar el planeta, rueda para acercar",
  aerial: "WASD para volar, Q/E para subir y bajar",
  drone: "arrastrar para mirar, WASD/QE para moverse libremente",
  pedestrian: "a la altura de los ojos: WASD para caminar, arrastrar para mirar",
  satellite: "vista cenital desde alturas orbitales",
  cinematic: "recorrido automático",
};
