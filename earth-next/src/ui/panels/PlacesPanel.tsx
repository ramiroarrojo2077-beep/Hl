import { useEffect, useState } from "preact/hooks";
import { Cartesian3, Math as CMath } from "cesium";
import { Star, Trash2, Plus, Plane, FolderPlus, Pencil, Share2, Database, Upload, Download } from "lucide-preact";
import { serverStatus } from "../../services/api.ts";
import { uploadPlace, placesInView, type ServerPlace } from "../../services/places-server.ts";
import { Panel } from "./PanelHost.tsx";
import { useEngine } from "../context.ts";
import { favorites, collections, addFavorite, removeFavorite, renameCollection, deleteCollection, recentPlaces } from "../places.ts";
import { cameraState, notify } from "../../state/store.ts";
import { t } from "../../i18n/index.ts";

export function PlacesPanel() {
  const engine = useEngine();
  const [col, setCol] = useState(collections.value[0] ?? "Favoritos");
  const [postgis, setPostgis] = useState(false);
  const [remote, setRemote] = useState<ServerPlace[] | null>(null);
  useEffect(() => {
    void serverStatus().then((s) => setPostgis(s.postgis));
  }, []);

  const upload = async () => {
    const items = favorites.value.filter((f) => f.collection === col);
    let ok = 0;
    for (const f of items) {
      try {
        await uploadPlace({ name: f.name, collection: col, note: f.note, lat: f.lat, lon: f.lon, camera: f.height !== undefined ? { height: f.height, heading: f.heading, pitch: f.pitch } : undefined });
        ok++;
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), "error");
        break;
      }
    }
    notify(t("{n} lugares subidos al servidor.", { n: ok }), "success");
  };

  const loadRemote = async () => {
    try {
      setRemote(await placesInView(engine.viewBBox()));
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const saveView = () => {
    const c = cameraState.value;
    const center = engine.viewCenter();
    const name = prompt(t("Nombre del lugar"), `${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}`);
    if (!name) return;
    addFavorite({ name, lon: c.lon, lat: c.lat, height: c.height, heading: c.heading, pitch: c.pitch, collection: col });
    notify(t("Vista guardada en \"{c}\".", { c: col }), "success");
  };

  const go = (f: (typeof favorites.value)[number]) => {
    if (f.height !== undefined && f.pitch !== undefined) {
      // Vista guardada: se restaura exactamente la pose de cámara.
      engine.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(f.lon, f.lat, f.height),
        orientation: { heading: CMath.toRadians(f.heading ?? 0), pitch: CMath.toRadians(f.pitch), roll: 0 },
        duration: 3,
      });
    } else void engine.cinematicFlyTo({ lon: f.lon, lat: f.lat }, 1500);
  };

  const shareCollection = async () => {
    const items = favorites.value.filter((f) => f.collection === col);
    const geojson = {
      type: "FeatureCollection",
      name: col,
      features: items.map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: [f.lon, f.lat] }, properties: { name: f.name, note: f.note ?? "" } })),
    };
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
    const file = new File([blob], `${col}.geojson`, { type: "application/geo+json" });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: col });
    else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
    }
  };

  const list = favorites.value.filter((f) => f.collection === col);
  return (
    <Panel title={t("Lugares")}>
      <div class="row">
        <select class="input grow" value={col} onChange={(e) => setCol((e.target as HTMLSelectElement).value)} aria-label={t("Colección")}>
          {collections.value.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          class="icon-btn"
          title={t("Nueva colección")}
          aria-label={t("Nueva colección")}
          onClick={() => {
            const name = prompt(t("Nombre de la colección"));
            if (name && !collections.value.includes(name)) {
              collections.value = [...collections.value, name];
              setCol(name);
            }
          }}
        >
          <FolderPlus size={17} />
        </button>
        <button
          class="icon-btn"
          title={t("Renombrar")}
          aria-label={t("Renombrar")}
          onClick={() => {
            const name = prompt(t("Nuevo nombre"), col);
            if (name) {
              renameCollection(col, name);
              setCol(name);
            }
          }}
        >
          <Pencil size={16} />
        </button>
        <button class="icon-btn" title={t("Compartir colección (GeoJSON)")} aria-label={t("Compartir colección")} onClick={shareCollection}>
          <Share2 size={16} />
        </button>
        {collections.value.length > 1 && (
          <button
            class="icon-btn"
            title={t("Eliminar colección")}
            aria-label={t("Eliminar colección")}
            onClick={() => {
              if (confirm(t("¿Eliminar la colección \"{c}\" y sus lugares?", { c: col }))) {
                deleteCollection(col);
                setCol(collections.value[0] ?? "Favoritos");
              }
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <button class="btn primary" onClick={saveView}>
        <Plus size={16} /> {t("Guardar la vista actual")}
      </button>
      {list.length === 0 && <div class="faint">{t("Todavía no hay lugares en esta colección. Buscá un lugar o guardá la vista actual.")}</div>}
      {list.map((f) => (
        <div key={f.id} class="row card" style={{ padding: "6px 8px" }}>
          <Star size={15} color="var(--warn)" />
          <button class="grow list-item" style={{ padding: "2px 4px" }} onClick={() => go(f)}>
            <div>
              <div style={{ fontWeight: 600 }}>{f.name}</div>
              <div class="faint mono">
                {f.lat.toFixed(4)}, {f.lon.toFixed(4)}
              </div>
            </div>
          </button>
          <button class="icon-btn" onClick={() => go(f)} aria-label={t("Volar")}>
            <Plane size={15} />
          </button>
          <button class="icon-btn" onClick={() => removeFavorite(f.id)} aria-label={t("Eliminar")}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {postgis && (
        <>
          <div class="section-title row">
            <Database size={12} /> {t("Servidor (PostGIS)")}
          </div>
          <div class="row wrap">
            <button class="btn small" onClick={upload}>
              <Upload size={14} /> {t("Subir esta colección")}
            </button>
            <button class="btn small" onClick={loadRemote}>
              <Download size={14} /> {t("Lugares compartidos en esta vista")}
            </button>
          </div>
          {remote?.map((p) => (
            <button key={p.id} class="list-item" onClick={() => engine.cinematicFlyTo({ lon: p.lon, lat: p.lat }, 1500)}>
              <div class="grow">
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div class="faint">
                  {p.collection} · {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                </div>
              </div>
            </button>
          ))}
          {remote && remote.length === 0 && <span class="faint">{t("No hay lugares compartidos en esta vista.")}</span>}
        </>
      )}
      {recentPlaces.value.length > 0 && (
        <>
          <div class="section-title">{t("Búsquedas recientes")}</div>
          {recentPlaces.value.slice(0, 8).map((p) => (
            <button key={p.id} class="list-item" onClick={() => engine.flyToPlace(p)}>
              <div class="grow">
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div class="faint">{p.label}</div>
              </div>
            </button>
          ))}
        </>
      )}
    </Panel>
  );
}
