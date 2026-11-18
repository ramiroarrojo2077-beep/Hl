import { Fragment } from "preact";
import { X, Star, Navigation, PersonStanding, ExternalLink, AlertTriangle, Plane, CloudSun } from "lucide-preact";
import { useEngine } from "../context.ts";
import { infoOpen, selection, activePanel, notify } from "../../state/store.ts";
import { addFavorite } from "../places.ts";
import { openStreetLevel } from "../panels/StreetViewer.tsx";
import { weatherTarget } from "../panels/WeatherPanel.tsx";
import { t } from "../../i18n/index.ts";

/** Panel de información contextual del elemento seleccionado, siempre con sus fuentes. */
export function InfoPanel() {
  const engine = useEngine();
  const s = selection.value;
  if (!s) return null;
  return (
    <aside class="drawer-right glass" aria-label={t("Información")}>
      <div class="panel-head">
        <h2>{s.title}</h2>
        <button class="icon-btn" onClick={() => (infoOpen.value = false)} aria-label={t("Cerrar")}>
          <X size={18} />
        </button>
      </div>
      <div class="panel-body">
        {s.subtitle && <div class="muted">{s.subtitle}</div>}
        {s.image && <img class="info-image" src={s.image} alt={s.title} loading="lazy" />}
        {s.notices?.map((n) => (
          <div class="notice" key={n}>
            <AlertTriangle size={16} />
            <span>{n}</span>
          </div>
        ))}
        {s.description && <p style={{ margin: 0, lineHeight: 1.5 }}>{s.description}</p>}
        {s.items.length > 0 && (
          <dl class="kv">
            {s.items.map((it) => (
              <Fragment key={it.label}>
                <dt>{it.label}</dt>
                <dd class={it.label === "METAR" ? "mono" : ""}>
                  {it.href ? (
                    <a href={it.href} target="_blank" rel="noopener">
                      {it.value}
                    </a>
                  ) : (
                    it.value
                  )}
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
        <div class="mono faint">
          {s.lat.toFixed(6)}, {s.lon.toFixed(6)}
        </div>
        <div class="row wrap">
          <button class="btn small" onClick={() => engine.cinematicFlyTo(s, s.kind === "building" ? 350 : 1200)}>
            <Plane size={14} /> {t("Volar aquí")}
          </button>
          <button class="btn small" onClick={() => void openStreetLevel(engine, s)}>
            <PersonStanding size={14} /> {t("Nivel calle")}
          </button>
          <button
            class="btn small"
            onClick={() => {
              addFavorite({ name: s.title, lon: s.lon, lat: s.lat, collection: "Favoritos", note: s.subtitle });
              notify(t("Agregado a Favoritos."), "success");
            }}
          >
            <Star size={14} /> {t("Guardar")}
          </button>
          <button
            class="btn small"
            onClick={() => {
              weatherTarget.value = { lon: s.lon, lat: s.lat, name: s.title };
              activePanel.value = "weather";
            }}
          >
            <CloudSun size={14} /> {t("Clima")}
          </button>
          <button
            class="btn small"
            onClick={() => {
              engine.userData.addMarker(s, s.title);
              notify(t("Marcador agregado al proyecto."), "success");
            }}
          >
            <Navigation size={14} /> {t("Marcar")}
          </button>
        </div>
        {s.wikipedia && (
          <a href={s.wikipedia} target="_blank" rel="noopener" class="row">
            <ExternalLink size={14} /> {t("Leer en Wikipedia")}
          </a>
        )}
        {s.sources.length > 0 && (
          <div class="sources">
            {t("Fuentes")}:{" "}
            {s.sources.map((src, i) => (
              <span key={src.name}>
                {i > 0 && " · "}
                {src.url ? (
                  <a href={src.url} target="_blank" rel="noopener">
                    {src.name}
                  </a>
                ) : (
                  src.name
                )}
                {src.license ? ` (${src.license})` : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
