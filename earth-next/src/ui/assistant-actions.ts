/**
 * Ejecuta en el globo las acciones que propone el asistente (IA o modo básico).
 * Las acciones se ejecutan en orden y se espera a que terminen las animaciones.
 */
import type { Engine } from "../engine/engine.ts";
import { sunTimes } from "../geo/astronomy.ts";
import { waybackReleases, waybackLayerDef } from "../services/history.ts";
import { speak } from "../engine/tours.ts";
import { newId, flightBetween, type Keyframe } from "../geo/tour.ts";
import { openStreetLevel } from "./panels/StreetViewer.tsx";
import { activePanel, cameraState, type NavMode } from "../state/store.ts";

export interface AssistantAction {
  tool: string;
  input: Record<string, unknown>;
}

type P = { lat: number; lon: number };

export function describeAction(a: AssistantAction, lang: string): string {
  const es = lang === "es";
  const i = a.input;
  switch (a.tool) {
    case "fly_to":
      return `${es ? "Volar a" : "Fly to"} ${(i["label"] as string) ?? `${Number(i["lat"]).toFixed(3)}, ${Number(i["lon"]).toFixed(3)}`}`;
    case "view_from_space":
      return es ? "Vista desde el espacio" : "View from space";
    case "set_scene_time":
      return `${es ? "Hora de la escena" : "Scene time"}: ${(i["preset"] as string) ?? (i["iso_datetime"] as string) ?? (i["animate_day"] ? (es ? "animar día" : "animate day") : "")}`;
    case "set_layers":
      return es ? "Cambiar capas" : "Change layers";
    case "compare_imagery":
      return `${es ? "Comparar con" : "Compare with"} ${i["source"]} ${i["date"]}`;
    case "show_markers":
      return `${(i["markers"] as unknown[]).length} ${es ? "marcadores" : "markers"}`;
    case "draw_path":
      return `${es ? "Dibujar" : "Draw"}: ${i["label"]}`;
    case "play_tour":
      return `${es ? "Recorrido" : "Tour"} (${(i["stops"] as unknown[]).length} ${es ? "paradas" : "stops"})`;
    case "set_navigation_mode":
      return `${es ? "Modo" : "Mode"}: ${i["mode"]}`;
    case "open_street_level":
      return es ? "Nivel de calle" : "Street level";
    case "weather_layers":
      return es ? "Capas de clima" : "Weather layers";
    case "narrate":
      return es ? "Narración" : "Narration";
    default:
      return a.tool;
  }
}

export async function executeAction(engine: Engine, a: AssistantAction): Promise<void> {
  const i = a.input;
  switch (a.tool) {
    case "fly_to": {
      const p = i as P & { height_m?: number; heading?: number; pitch?: number; cinematic?: boolean };
      const height = p.height_m ?? 1500;
      if (p.cinematic) return engine.cinematicFlyTo(p, height, p.pitch ?? -35);
      return engine.flyTo({ lon: p.lon, lat: p.lat, height, heading: p.heading, pitch: p.pitch ?? (height > 200_000 ? -90 : -40) });
    }
    case "view_from_space": {
      const p = i as Partial<P>;
      return engine.viewFromSpace(p.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : undefined);
    }
    case "set_scene_time": {
      const s = i as { iso_datetime?: string; preset?: string; animate_day?: boolean; speed_multiplier?: number };
      const c = cameraState.value;
      if (s.iso_datetime) {
        const d = new Date(s.iso_datetime);
        if (!Number.isNaN(d.getTime())) engine.time.setTime(d);
      } else if (s.preset === "now") engine.time.now();
      else if (s.preset) {
        const st = sunTimes(engine.time.current, c.lat, c.lon);
        const target = s.preset === "sunrise" ? st.sunrise : s.preset === "sunset" ? st.sunset : s.preset === "noon" ? st.solarNoon : new Date(st.solarNoon.getTime() + 12 * 3600_000);
        if (target) engine.time.setTime(target);
      }
      if (s.animate_day) engine.time.animateDay(40);
      else if (s.speed_multiplier !== undefined) {
        engine.time.setMultiplier(s.speed_multiplier);
        engine.time.play();
      }
      return;
    }
    case "set_layers": {
      const l = i as { base?: string; enable?: string[]; disable?: string[] };
      if (l.base) engine.imagery.setBase(l.base);
      l.enable?.forEach((id) => engine.imagery.toggleOverlay(id, true));
      l.disable?.forEach((id) => engine.imagery.toggleOverlay(id, false));
      return;
    }
    case "compare_imagery": {
      const c = i as { source: string; date: string };
      const date = new Date((c.date.length === 4 ? `${c.date}-06-15` : c.date) + "T12:00:00Z");
      if (c.source === "wayback") {
        const releases = await waybackReleases();
        const target = c.date.length === 4 ? `${c.date}-12-31` : c.date;
        const best = [...releases].reverse().find((r) => r.date <= target) ?? releases[0];
        if (!best) return;
        const def = waybackLayerDef(best);
        engine.imagery.register(def);
        engine.imagery.setCompare(def.id);
      } else engine.imagery.setCompare(c.source, date);
      activePanel.value = "history";
      return;
    }
    case "show_markers": {
      const m = i as { markers: (P & { label: string; description?: string })[]; fit_view?: boolean };
      for (const mk of m.markers) engine.userData.addMarker(mk, mk.label, "#f472b6", mk.description, "Asistente");
      if (m.fit_view !== false && m.markers.length) {
        if (m.markers.length === 1) return engine.flyTo({ lon: m.markers[0]!.lon, lat: m.markers[0]!.lat, height: 3000, pitch: -45 });
        const w = Math.min(...m.markers.map((x) => x.lon));
        const e = Math.max(...m.markers.map((x) => x.lon));
        const s = Math.min(...m.markers.map((x) => x.lat));
        const n = Math.max(...m.markers.map((x) => x.lat));
        const mx = Math.max(0.01, (e - w) * 0.25);
        const my = Math.max(0.01, (n - s) * 0.25);
        return engine.flyToBBox([w - mx, s - my, e + mx, n + my]);
      }
      return;
    }
    case "draw_path": {
      const d = i as { points: P[]; label: string; closed?: boolean };
      const coords = d.points.map((p) => [p.lon, p.lat] as [number, number]);
      if (d.closed) engine.userData.add({ geometry: { type: "Polygon", coordinates: [[...coords, coords[0]!]] }, properties: { name: d.label, color: "#f472b6", kind: "polygon", createdAt: new Date().toISOString() } });
      else engine.userData.add({ geometry: { type: "LineString", coordinates: coords }, properties: { name: d.label, color: "#f472b6", kind: "line", createdAt: new Date().toISOString() } });
      return;
    }
    case "play_tour": {
      const t = i as { stops: (P & { height_m?: number; label: string; narration?: string; hold_s?: number })[] };
      let pose = engine.getPose();
      const kfs: Keyframe[] = [];
      for (const s of t.stops) {
        const leg = flightBetween(pose, s, { arrivalHeight: s.height_m ?? 2500, samples: 5 });
        const legKfs = kfs.length ? leg.slice(1) : leg;
        const last = legKfs[legKfs.length - 1]!;
        last.hold = s.hold_s ?? 3;
        last.label = s.label;
        last.narration = s.narration ?? s.label;
        kfs.push(...legKfs);
        pose = last;
      }
      kfs.forEach((k) => (k.id = newId()));
      return engine.tours.play(kfs);
    }
    case "set_navigation_mode":
      engine.nav.setMode(i["mode"] as NavMode);
      return;
    case "open_street_level":
      return openStreetLevel(engine, i as P);
    case "weather_layers": {
      const w = i as { radar?: boolean; stations?: boolean; wind?: boolean; storms?: boolean };
      const bbox = engine.viewBBox();
      const jobs: Promise<void>[] = [];
      if (w.radar !== undefined) jobs.push(engine.weather.setRadar(w.radar));
      if (w.stations !== undefined) jobs.push(engine.weather.setMetar(w.stations, bbox));
      if (w.wind !== undefined) jobs.push(engine.weather.setWind(w.wind, bbox));
      if (w.storms !== undefined) jobs.push(engine.weather.setStorms(w.storms));
      await Promise.all(jobs);
      return;
    }
    case "narrate":
      speak(String(i["text"] ?? ""));
      return;
  }
}

/** Cola secuencial: las acciones de una respuesta se ejecutan en orden. */
export class ActionQueue {
  private chain: Promise<void> = Promise.resolve();
  constructor(private engine: Engine) {}
  push(a: AssistantAction): Promise<void> {
    this.chain = this.chain.then(() => executeAction(this.engine, a).catch((err) => console.warn("[acción]", a.tool, err)));
    return this.chain;
  }
}
