import { obbOverlap, pointInObb, type Obb2 } from "../math";
import { removeEntity } from "../scene/doc";
import type { Entity, WorldDoc } from "../types";
import { LIMITS } from "../types";
import type { Feature } from "./plan";
import { heightAt } from "./terrain";

export interface ValidationIssue {
  severity: "info" | "warning" | "error";
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  repairs: number;
}

function buildingObb(e: Extract<Entity, { type: "building" }>): Obb2 {
  return {
    cx: e.transform.position[0],
    cz: e.transform.position[2],
    hx: (e.props.width * e.transform.scale[0]) / 2,
    hz: (e.props.depth * e.transform.scale[2]) / 2,
    rot: e.transform.rotation[1],
  };
}

/**
 * Scene Validator: comprueba la coherencia del documento y repara lo que
 * puede (muta el documento). Se usa al final de la generación y al importar.
 */
export function validateAndRepair(doc: WorldDoc, opts: { repair: boolean } = { repair: true }): ValidationReport {
  const issues: ValidationIssue[] = [];
  let repairs = 0;
  const entities = doc.entities;

  // 1. Integridad de la jerarquía.
  if (!entities[doc.rootId]) issues.push({ severity: "error", message: "Falta la entidad raíz del mundo" });
  for (const e of Object.values(entities)) {
    if (e.parentId && !entities[e.parentId]) {
      issues.push({ severity: "error", message: `${e.name}: padre inexistente` });
      if (opts.repair && entities[doc.rootId]) {
        e.parentId = doc.rootId;
        entities[doc.rootId]!.children.push(e.id);
        repairs++;
      }
    }
    const missing = e.children.filter((c) => !entities[c]);
    if (missing.length) {
      issues.push({ severity: "warning", message: `${e.name}: ${missing.length} hijos inexistentes` });
      if (opts.repair) {
        e.children = e.children.filter((c) => entities[c]);
        repairs++;
      }
    }
  }

  // 2. Edificios superpuestos (se elimina el más chico).
  const buildings = Object.values(entities).filter((e): e is Extract<Entity, { type: "building" }> => e.type === "building" && e.parentId !== null);
  const obbs = buildings.map(buildingObb);
  const removed = new Set<string>();
  for (let i = 0; i < buildings.length; i++) {
    if (removed.has(buildings[i]!.id)) continue;
    for (let j = i + 1; j < buildings.length; j++) {
      if (removed.has(buildings[j]!.id)) continue;
      const a = obbs[i]!, b = obbs[j]!;
      if (Math.abs(a.cx - b.cx) > a.hx + a.hz + b.hx + b.hz || Math.abs(a.cz - b.cz) > a.hx + a.hz + b.hx + b.hz) continue;
      if (obbOverlap(a, b, -0.3)) {
        const small = a.hx * a.hz < b.hx * b.hz ? buildings[i]! : buildings[j]!;
        issues.push({ severity: "warning", message: `${buildings[i]!.name} y ${buildings[j]!.name} se superponen` });
        if (opts.repair) {
          removed.add(small.id);
          removeEntity(doc, small.id);
          repairs++;
        }
        if (small === buildings[i]) break;
      }
    }
  }

  // 3. Vegetación dentro de edificios.
  const remainingObbs = buildings.filter((b) => !removed.has(b.id)).map(buildingObb);
  const grid = new Map<string, Obb2[]>();
  const key = (x: number, z: number) => `${Math.floor(x / 40)},${Math.floor(z / 40)}`;
  for (const o of remainingObbs) {
    const r = Math.hypot(o.hx, o.hz);
    for (let x = o.cx - r; x <= o.cx + r + 40; x += 40)
      for (let z = o.cz - r; z <= o.cz + r + 40; z += 40) {
        const k = key(x, z);
        if (!grid.has(k)) grid.set(k, []);
        if (!grid.get(k)!.includes(o)) grid.get(k)!.push(o);
      }
  }
  let vegRemoved = 0;
  for (const e of Object.values(entities)) {
    if (e.type !== "tree" && e.type !== "plant" && e.type !== "rock") continue;
    const [x, , z] = e.transform.position;
    const near = grid.get(key(x, z));
    if (near?.some((o) => pointInObb(x, z, o, 0.5))) {
      vegRemoved++;
      if (opts.repair) removeEntity(doc, e.id);
    }
  }
  if (vegRemoved) {
    issues.push({ severity: "info", message: `${vegRemoved} plantas o rocas estaban dentro de edificios` });
    if (opts.repair) repairs += vegRemoved;
  }

  // 4. Edificios bajo el agua.
  if (doc.terrain.waterEnabled) {
    for (const b of buildings) {
      if (removed.has(b.id) || !entities[b.id]) continue;
      const h = heightAt(doc.terrain, b.transform.position[0], b.transform.position[2]);
      if (h < doc.terrain.waterLevel - 0.5) {
        issues.push({ severity: "warning", message: `${b.name} quedó bajo el agua` });
        if (opts.repair) {
          removeEntity(doc, b.id);
          repairs++;
        }
      }
    }
  }

  // 5. Vehículos con rutas inexistentes.
  const routeIds = new Set(doc.routes.map((r) => r.id));
  for (const e of Object.values(entities)) {
    if (e.type === "vehicle" && e.props.routeId && !routeIds.has(e.props.routeId)) {
      issues.push({ severity: "warning", message: `${e.name}: ruta ${e.props.routeId} inexistente` });
      if (opts.repair) {
        e.props.routeId = null;
        e.props.parked = true;
        repairs++;
      }
    }
  }

  // 6. Grafo de navegación con índices válidos.
  const nn = doc.navigation.nodes.length;
  const badEdges = doc.navigation.edges.filter((ed) => ed.a >= nn || ed.b >= nn);
  if (badEdges.length) {
    issues.push({ severity: "error", message: `${badEdges.length} tramos de navegación inválidos` });
    if (opts.repair) {
      doc.navigation.edges = doc.navigation.edges.filter((ed) => ed.a < nn && ed.b < nn);
      repairs++;
    }
  }

  // 7. Límites.
  const count = Object.keys(entities).length;
  if (count > LIMITS.maxEntities) issues.push({ severity: "error", message: `Demasiadas entidades (${count} > ${LIMITS.maxEntities})` });

  // 8. Punto de aparición.
  if (!Object.values(entities).some((e) => e.type === "spawn")) issues.push({ severity: "info", message: "No hay punto de aparición: se usará el centro del mapa" });

  return { issues, repairs };
}

// ---------------------------------------------------------------------------
// Adherencia al pedido: ¿el mundo contiene lo que se pidió?
// ---------------------------------------------------------------------------

export type FeatureCheck = { feature: Feature; ok: boolean; detail: string };

export function checkFeatures(doc: WorldDoc, features: readonly Feature[]): FeatureCheck[] {
  const list = Object.values(doc.entities);
  const count = (pred: (e: Entity) => boolean) => list.filter(pred).length;
  const heights = doc.terrain.heights;
  let maxH = -Infinity;
  let minH = Infinity;
  let underwater = 0;
  for (const h of heights) {
    if (h > maxH) maxH = h;
    if (h < minH) minH = h;
    if (h < doc.terrain.waterLevel) underwater++;
  }
  const waterRatio = underwater / heights.length;
  const t = doc.environment.timeOfDay;
  const props = (k: string) => count((e) => e.type === "prop" && e.props.kind === k);
  const kinds = (k: string) => count((e) => e.type === "building" && e.props.kind === k);
  const checks: Record<Feature, () => [boolean, string]> = {
    mountains: () => [maxH - minH > 30, `relieve ${Math.round(maxH - minH)} m`],
    hills: () => [maxH - minH > 8, `relieve ${Math.round(maxH - minH)} m`],
    river: () => [doc.terrain.waterEnabled && waterRatio > 0.005, `${(waterRatio * 100).toFixed(1)}% agua`],
    lake: () => [doc.terrain.waterEnabled && waterRatio > 0.005, `${(waterRatio * 100).toFixed(1)}% agua`],
    waterfall: () => [props("waterfall") > 0, `${props("waterfall")} cascadas`],
    beach: () => [doc.terrain.waterEnabled && waterRatio > 0.1, `${(waterRatio * 100).toFixed(0)}% agua`],
    ocean: () => [doc.terrain.waterEnabled && waterRatio > 0.2, `${(waterRatio * 100).toFixed(0)}% agua`],
    buildings: () => [count((e) => e.type === "building") >= 3, `${count((e) => e.type === "building")} edificios`],
    skyscrapers: () => [count((e) => e.type === "building" && e.props.floors >= 20) >= 1, `${count((e) => e.type === "building" && e.props.floors >= 20)} rascacielos`],
    houses: () => [kinds("house") + kinds("hut") >= 1, `${kinds("house") + kinds("hut")} casas`],
    castle: () => [kinds("castle") >= 1, `${kinds("castle")} castillos`],
    market: () => [props("stall") >= 3, `${props("stall")} puestos`],
    park: () => [count((e) => e.type === "block" && (e.props.use === "park" || e.props.use === "plaza")) + props("bench") + props("fountain") + props("well") > 0, "parques/plazas"],
    streets: () => [count((e) => e.type === "road") >= 1, `${count((e) => e.type === "road")} calles`],
    trees: () => [count((e) => e.type === "tree") >= 10, `${count((e) => e.type === "tree")} árboles`],
    forest: () => [count((e) => e.type === "tree") >= 150, `${count((e) => e.type === "tree")} árboles`],
    palms: () => [count((e) => e.type === "tree" && e.props.species === "palm") >= 5, `${count((e) => e.type === "tree" && e.props.species === "palm")} palmeras`],
    people: () => [count((e) => e.type === "npc") >= 3, `${count((e) => e.type === "npc")} personajes`],
    creatures: () => [false, "criaturas no animales todavía: se usan personajes"],
    vehicles: () => [count((e) => e.type === "vehicle") >= 1, `${count((e) => e.type === "vehicle")} vehículos`],
    flying_vehicles: () => {
      const air = new Set(doc.routes.filter((r) => r.kind === "air").map((r) => r.id));
      const n = count((e) => e.type === "vehicle" && !!e.props.routeId && air.has(e.props.routeId));
      return [n >= 1, `${n} vehículos voladores`];
    },
    traffic_lights: () => [props("traffic_light") >= 1, `${props("traffic_light")} semáforos`],
    streetlights: () => [props("streetlight") + props("lantern") + props("torch") >= 1, "alumbrado"],
    grandstands: () => [kinds("grandstand") >= 1, `${kinds("grandstand")} tribunas`],
    pits: () => [kinds("pit") >= 1, `${kinds("pit")} boxes`],
    huts: () => [kinds("hut") >= 1, `${kinds("hut")} cabañas`],
    bases: () => [kinds("dome") + kinds("lab") >= 1, `${kinds("dome") + kinds("lab")} módulos`],
    neon: () => [count((e) => e.type === "building" && e.props.neon) + props("billboard") >= 1, "carteles luminosos"],
    rain: () => [doc.weather.type === "rain" || doc.weather.type === "storm", doc.weather.type],
    snow: () => [doc.weather.type === "snow" || doc.terrain.biome === "snow", doc.weather.type],
    fog: () => [doc.weather.type === "fog" || doc.environment.fogDensity >= 0.01, doc.weather.type],
    storm: () => [doc.weather.type === "storm", doc.weather.type],
    sandstorm: () => [doc.weather.type === "sandstorm", doc.weather.type],
    night: () => [t >= 19.5 || t <= 5, `${t.toFixed(1)} h`],
    sunset: () => [t >= 16.8 && t <= 19, `${t.toFixed(1)} h`],
    dawn: () => [t >= 5.5 && t <= 7.8, `${t.toFixed(1)} h`],
    wet: () => [doc.weather.wetness >= 0.5, `humedad ${doc.weather.wetness}`],
  };
  return features.map((f) => {
    const [ok, detail] = checks[f]();
    return { feature: f, ok, detail };
  });
}

export interface WorldScore {
  adherence: number; // 0..1
  validity: number; // 0..1
  playable: boolean;
  total: number; // 0..100
  checks: FeatureCheck[];
}

/** Puntaje objetivo de un mundo generado (usado por el benchmark). */
export function scoreWorld(doc: WorldDoc, features: readonly Feature[]): WorldScore {
  const checks = checkFeatures(doc, features);
  const adherence = checks.length ? checks.filter((c) => c.ok).length / checks.length : 1;
  const copy = structuredClone(doc);
  const report = validateAndRepair(copy, { repair: false });
  const errors = report.issues.filter((i) => i.severity === "error").length;
  const warnings = report.issues.filter((i) => i.severity === "warning").length;
  const validity = Math.max(0, 1 - errors * 0.25 - warnings * 0.03);
  const playable = Object.values(doc.entities).some((e) => e.type === "spawn");
  const total = Math.round((adherence * 0.6 + validity * 0.3 + (playable ? 0.1 : 0)) * 100);
  return { adherence, validity, playable, total, checks };
}
