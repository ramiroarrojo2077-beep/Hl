import { useState } from "preact/hooks";
import { Play, Pause, Square, Plus, Trash2, Save, Video, CircleStop, Plane, RotateCw, Route, ArrowUp, ArrowDown, Mic } from "lucide-preact";
import { Panel } from "./PanelHost.tsx";
import { useEngine } from "../context.ts";
import { tourState, savedTours, recording, CanvasRecorder } from "../../engine/tours.ts";
import { downloadBlob, userFeatures } from "../../engine/userdata.ts";
import { flightBetween, orbitAround, followRoute, tourDuration, newId, type Keyframe, type Tour } from "../../geo/tour.ts";
import { searchBest } from "../../services/geocoder.ts";
import { elevationsAt } from "../../services/elevation.ts";
import { notify, settings } from "../../state/store.ts";
import { formatDuration } from "../../geo/format.ts";
import { t } from "../../i18n/index.ts";

/** Recorridos cinematográficos: vuelo A→B, órbitas, seguimiento de rutas y editor de puntos clave. */
export function ToursPanel() {
  const engine = useEngine();
  const [kfs, setKfs] = useState<Keyframe[]>([]);
  const [name, setName] = useState(t("Mi recorrido"));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const ts = tourState.value;
  const rec = recording.value;

  const addCurrent = () => {
    const p = engine.getPose();
    setKfs([...kfs, { id: newId(), ...p, duration: kfs.length ? 5 : 0, hold: 0, easing: "smooth" }]);
  };

  const flight = async () => {
    setBusy(true);
    try {
      const a = from.trim() ? (await searchBest(from, { lang: settings.value.lang }))[0] : null;
      const b = (await searchBest(to, { lang: settings.value.lang }))[0];
      if (!b) throw new Error(t("No se encontró el destino."));
      const start = a ? { lon: a.lon, lat: a.lat, height: 4000, heading: 0, pitch: -40, roll: 0 } : engine.getPose();
      const k = flightBetween(start, b, { arrivalHeight: 1500 });
      k[k.length - 1]!.narration = b.name;
      k[k.length - 1]!.hold = 2;
      if (a) k[0]!.narration = a.name;
      setKfs(k);
      await engine.tours.play(k);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const orbit = () => {
    const c = engine.viewCenter();
    const h = Math.max(150, Math.min(3000, engine.getPose().height * 0.4));
    const k = orbitAround(c, { radius: h * 1.6, height: h, duration: 30 });
    setKfs(k);
    void engine.tours.play(k);
  };

  const followDrawnRoute = async () => {
    const line = [...userFeatures.value].reverse().find((f) => f.geometry.type === "LineString");
    if (!line || line.geometry.type !== "LineString") return notify(t("Dibujá una línea o guardá una ruta en Herramientas primero."), "info");
    const pts = line.geometry.coordinates.map(([lon, lat]) => ({ lon, lat }));
    const ground = await elevationsAt(pts, 13).catch(() => pts.map(() => 0));
    const k = followRoute(
      pts.map((p, i) => ({ ...p, ground: ground[i] })),
      { heightAboveGround: 250, speed: 120, pitch: -25 },
    );
    setKfs(k);
    void engine.tours.play(k);
  };

  const update = (i: number, patch: Partial<Keyframe>) => setKfs(kfs.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= kfs.length) return;
    const copy = [...kfs];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    setKfs(copy);
  };

  const save = () => {
    const tour: Tour = { id: newId("tour"), name, keyframes: kfs, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    savedTours.value = [tour, ...savedTours.value];
    notify(t("Recorrido guardado."), "success");
  };

  const toggleRecord = async () => {
    if (engine.recorder.active) {
      const blob = await engine.recorder.stop();
      if (blob) downloadBlob(blob, `earth-next-${Date.now()}.${blob.type.includes("mp4") ? "mp4" : "webm"}`);
      return;
    }
    engine.recorder.start(30);
  };

  const recordTour = async () => {
    if (kfs.length < 2) return;
    engine.recorder.start(30);
    await engine.tours.play(kfs);
    const blob = await engine.recorder.stop();
    if (blob) downloadBlob(blob, `${name.replace(/\W+/g, "-")}.${blob.type.includes("mp4") ? "mp4" : "webm"}`);
  };

  return (
    <Panel title={t("Recorridos cinematográficos")}>
      <div class="card col">
        <b>{t("Viaje entre dos lugares")}</b>
        <input class="input" placeholder={t("Origen (vacío = vista actual)")} value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
        <input class="input" placeholder={t("Destino (p. ej. Machu Picchu)")} value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && flight()} />
        <button class="btn primary" onClick={flight} disabled={busy || !to.trim()}>
          <Plane size={16} /> {t("Volar")}
        </button>
      </div>
      <div class="row wrap">
        <button class="btn small" onClick={orbit}>
          <RotateCw size={14} /> {t("Órbita alrededor del centro")}
        </button>
        <button class="btn small" onClick={followDrawnRoute}>
          <Route size={14} /> {t("Seguir última ruta dibujada")}
        </button>
      </div>

      <div class="section-title">{t("Editor de puntos clave")}</div>
      <div class="row wrap">
        <button class="btn small" onClick={addCurrent}>
          <Plus size={14} /> {t("Agregar vista actual")}
        </button>
        {kfs.length >= 2 &&
          (ts.playing ? (
            <button class="btn small" onClick={() => engine.tours.pause()}>
              <Pause size={14} /> {t("Pausar")}
            </button>
          ) : ts.time > 0 && ts.time < ts.duration ? (
            <button class="btn small" onClick={() => engine.tours.resume()}>
              <Play size={14} /> {t("Continuar")}
            </button>
          ) : (
            <button class="btn small primary" onClick={() => engine.tours.play(kfs)}>
              <Play size={14} /> {t("Reproducir")}
            </button>
          ))}
        {(ts.playing || ts.time > 0) && (
          <button class="btn small" onClick={() => engine.tours.stop()}>
            <Square size={14} /> {t("Detener")}
          </button>
        )}
      </div>
      {kfs.length >= 2 && (
        <div class="col" style={{ gap: "4px" }}>
          <input type="range" min={0} max={tourDuration(kfs)} step={0.1} value={ts.time} onInput={(e) => engine.tours.seek(Number((e.target as HTMLInputElement).value))} aria-label={t("Posición del recorrido")} />
          <span class="faint">
            {formatDuration(ts.time)} / {formatDuration(tourDuration(kfs))}
          </span>
        </div>
      )}
      {kfs.map((k, i) => (
        <div key={k.id} class={`card col ${ts.index === i && ts.playing ? "active" : ""}`} style={{ gap: "6px", padding: "8px" }}>
          <div class="row">
            <b class="grow">
              #{i + 1} <span class="faint mono">{k.lat.toFixed(3)}, {k.lon.toFixed(3)} · {Math.round(k.height).toLocaleString()} m</span>
            </b>
            <button class="icon-btn" style={{ width: "26px", height: "26px" }} onClick={() => engine.tours.applyPose(k)} title={t("Ver")}>
              👁
            </button>
            <button class="icon-btn" style={{ width: "26px", height: "26px" }} onClick={() => move(i, -1)} aria-label={t("Subir")}>
              <ArrowUp size={14} />
            </button>
            <button class="icon-btn" style={{ width: "26px", height: "26px" }} onClick={() => move(i, 1)} aria-label={t("Bajar")}>
              <ArrowDown size={14} />
            </button>
            <button class="icon-btn" style={{ width: "26px", height: "26px" }} onClick={() => setKfs(kfs.filter((_, j) => j !== i))} aria-label={t("Eliminar")}>
              <Trash2 size={14} />
            </button>
          </div>
          <div class="grid2">
            {i > 0 && (
              <label class="col faint" style={{ gap: "2px" }}>
                {t("Duración (s)")}
                <input class="input" type="number" min={0.5} step={0.5} value={k.duration} onChange={(e) => update(i, { duration: Number((e.target as HTMLInputElement).value) })} />
              </label>
            )}
            <label class="col faint" style={{ gap: "2px" }}>
              {t("Pausa (s)")}
              <input class="input" type="number" min={0} step={0.5} value={k.hold} onChange={(e) => update(i, { hold: Number((e.target as HTMLInputElement).value) })} />
            </label>
            <label class="col faint" style={{ gap: "2px" }}>
              {t("Rumbo (°)")}
              <input class="input" type="number" step={1} value={Math.round(k.heading)} onChange={(e) => update(i, { heading: Number((e.target as HTMLInputElement).value) })} />
            </label>
            <label class="col faint" style={{ gap: "2px" }}>
              {t("Cabeceo (°)")}
              <input class="input" type="number" min={-90} max={30} step={1} value={Math.round(k.pitch)} onChange={(e) => update(i, { pitch: Number((e.target as HTMLInputElement).value) })} />
            </label>
            <label class="col faint" style={{ gap: "2px" }}>
              {t("Altura (m)")}
              <input class="input" type="number" min={2} step={10} value={Math.round(k.height)} onChange={(e) => update(i, { height: Number((e.target as HTMLInputElement).value) })} />
            </label>
            {i > 0 && (
              <label class="col faint" style={{ gap: "2px" }}>
                {t("Velocidad")}
                <select class="input" value={k.easing} onChange={(e) => update(i, { easing: (e.target as HTMLSelectElement).value as Keyframe["easing"] })}>
                  <option value="smooth">{t("Suave")}</option>
                  <option value="ease-in-out">{t("Acelerar y frenar")}</option>
                  <option value="linear">{t("Constante")}</option>
                </select>
              </label>
            )}
          </div>
          <label class="row faint">
            <Mic size={13} />
            <input class="input" placeholder={t("Narración en este punto (opcional)")} value={k.narration ?? ""} onChange={(e) => update(i, { narration: (e.target as HTMLInputElement).value || undefined })} />
          </label>
        </div>
      ))}
      {kfs.length >= 2 && (
        <div class="row wrap">
          <input class="input grow" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label={t("Nombre del recorrido")} />
          <button class="btn small" onClick={save}>
            <Save size={14} /> {t("Guardar")}
          </button>
          <button
            class="btn small"
            onClick={() => downloadBlob(new Blob([JSON.stringify({ name, keyframes: kfs }, null, 2)], { type: "application/json" }), `${name.replace(/\W+/g, "-")}.tour.json`)}
          >
            JSON
          </button>
        </div>
      )}

      <div class="section-title">{t("Grabación de video")}</div>
      {!CanvasRecorder.supportedMime() ? (
        <div class="notice">{t("Este navegador no admite grabar el lienzo (MediaRecorder).")}</div>
      ) : (
        <div class="row wrap">
          <button class={`btn small ${rec ? "danger" : ""}`} onClick={toggleRecord}>
            {rec ? <CircleStop size={14} /> : <Video size={14} />} {rec ? `${t("Detener")} (${Math.round(rec.seconds)} s)` : t("Grabar pantalla del globo")}
          </button>
          {kfs.length >= 2 && (
            <button class="btn small" onClick={recordTour} disabled={!!rec}>
              <Video size={14} /> {t("Grabar recorrido completo")}
            </button>
          )}
        </div>
      )}
      <span class="faint">{t("El video se exporta en {f} con la resolución de la ventana. Incluí las atribuciones de datos al publicarlo.", { f: CanvasRecorder.supportedMime()?.split(";")[0] ?? "—" })}</span>

      {savedTours.value.length > 0 && (
        <>
          <div class="section-title">{t("Recorridos guardados")}</div>
          {savedTours.value.map((tour) => (
            <div key={tour.id} class="row card" style={{ padding: "6px 8px" }}>
              <div class="grow">
                <div style={{ fontWeight: 600 }}>{tour.name}</div>
                <div class="faint">
                  {tour.keyframes.length} {t("puntos")} · {formatDuration(tourDuration(tour.keyframes))}
                </div>
              </div>
              <button class="btn small" onClick={() => (setKfs(tour.keyframes), setName(tour.name))}>
                {t("Editar")}
              </button>
              <button class="icon-btn" onClick={() => engine.tours.play(tour.keyframes, tour.id)} aria-label={t("Reproducir")}>
                <Play size={15} />
              </button>
              <button class="icon-btn" onClick={() => (savedTours.value = savedTours.value.filter((x) => x.id !== tour.id))} aria-label={t("Eliminar")}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}
