import { catmullRom, filletPolyline, obbOverlap, type Obb2 } from "../math";
import { Rng } from "../rng";
import type { Intersection, Navigation, Poi, PropKind, RoadKind, Route, Vec2 } from "../types";
import type { WorldPlan } from "./plan";
import { gridExtent, type Site } from "./terrain";

/**
 * Planificación urbana: calles, manzanas, lotes, intersecciones, rutas de
 * tránsito y grafo de navegación peatonal.
 */

export interface RoadDef {
  kind: RoadKind;
  points: Vec2[];
  closed: boolean;
  width: number;
  markings: boolean;
  name: string;
}

export interface BlockDef {
  center: Vec2;
  size: Vec2;
  sidewalk: number;
  use: "buildings" | "park" | "plaza" | "parking";
  /** Distancia normalizada al centro (0 = centro, 1 = borde). */
  centrality: number;
}

export interface LotDef {
  center: Vec2;
  width: number; // frente
  depth: number;
  rotation: number; // rotación Y: el frente (+Z local) mira a la calle
  centrality: number;
  zone: "core" | "mid" | "outer" | "plaza" | "special";
}

export interface SpecialSite {
  kind: "castle" | "grandstand" | "pit" | "landing_pad" | "plaza" | "temple" | "stadium" | "tower";
  center: Vec2;
  rotation: number;
  size: Vec2;
}

export interface PropSpot {
  kind: PropKind;
  position: Vec2;
  rotation: number;
  intersectionId?: string;
  axis?: "x" | "z";
}

export interface Layout {
  type: "grid" | "organic" | "circuit" | "cluster" | "scatter";
  roads: RoadDef[];
  blocks: BlockDef[];
  lots: LotDef[];
  specials: SpecialSite[];
  intersections: Intersection[];
  routes: Route[];
  navigation: Navigation;
  props: PropSpot[];
  /** Zonas donde no debe crecer vegetación silvestre (calles, lotes, especiales). */
  reserved: Obb2[];
  /** Puntos para árboles urbanos (veredas, parques). */
  treeSpots: { position: Vec2; species?: "park" | "street" }[];
  /** Lugares de estacionamiento junto al cordón. */
  parking: { position: Vec2; rotation: number }[];
  spawn: Vec2;
}

function emptyLayout(type: Layout["type"], spawn: Vec2): Layout {
  return {
    type,
    roads: [],
    blocks: [],
    lots: [],
    specials: [],
    intersections: [],
    routes: [],
    navigation: { nodes: [], edges: [], pois: [] },
    props: [],
    reserved: [],
    treeSpots: [],
    parking: [],
    spawn,
  };
}

export function generateLayout(plan: WorldPlan, site: Site, rng: Rng): Layout {
  if (site.grid) return gridLayout(plan, site, rng);
  switch (plan.archetype) {
    case "racetrack":
      return circuitLayout(plan, site, rng);
    case "desert_base":
      return clusterLayout(plan, site, rng);
    case "forest":
    case "wilderness":
      return scatterLayout(plan, site, rng);
    default:
      return organicLayout(plan, site, rng);
  }
}

// ---------------------------------------------------------------------------
// Grilla urbana
// ---------------------------------------------------------------------------

function gridLayout(plan: WorldPlan, site: Site, rng: Rng): Layout {
  const g = site.grid!;
  const P = g.blockSize + g.street;
  const nb = g.blocks;
  const E = gridExtent(g);
  const [ox, oz] = site.center;
  const lines: number[] = [];
  for (let i = 0; i <= nb; i++) lines.push(-((nb * P) / 2) + i * P);
  const layout = emptyLayout("grid", [ox, oz + lines[0]! - g.street / 2 - 6]);
  const futuristic = plan.style === "futuristic" || plan.archetype === "futuristic";
  const japanese = plan.style === "japanese";

  // Calles: una por línea de la grilla en cada eje.
  const roadExt = E + 4;
  for (let i = 0; i <= nb; i++) {
    const c = lines[i]!;
    const isMain = i === Math.floor(nb / 2);
    layout.roads.push({
      kind: isMain ? "avenue" : "street",
      points: [
        [ox + c, oz - roadExt],
        [ox + c, oz + roadExt],
      ],
      closed: false,
      width: g.street,
      markings: true,
      name: `Calle ${i + 1}`,
    });
    layout.roads.push({
      kind: isMain ? "avenue" : "street",
      points: [
        [ox - roadExt, oz + c],
        [ox + roadExt, oz + c],
      ],
      closed: false,
      width: g.street,
      markings: true,
      name: `Avenida ${String.fromCharCode(65 + i)}`,
    });
    layout.reserved.push({ cx: ox + c, cz: oz, hx: g.street / 2 + 0.5, hz: roadExt, rot: 0 });
    layout.reserved.push({ cx: ox, cz: oz + c, hx: roadExt, hz: g.street / 2 + 0.5, rot: 0 });
  }

  // Intersecciones (con semáforos en los cruces de cuatro vías).
  const interId = (i: number, j: number) => `x${i}_${j}`;
  for (let i = 0; i <= nb; i++) {
    for (let j = 0; j <= nb; j++) {
      const interior = i > 0 && i < nb && j > 0 && j < nb;
      layout.intersections.push({
        id: interId(i, j),
        position: [ox + lines[i]!, oz + lines[j]!],
        radius: g.street / 2,
        hasLights: plan.props.trafficLights && interior,
        phaseOffset: rng.range(0, 20),
      });
    }
  }

  // Manzanas.
  const inner = g.blockSize;
  const centerIdx = (nb - 1) / 2;
  const parkChance = futuristic ? 0.06 : plan.archetype === "town" ? 0.14 : 0.12;
  const blockIndex = (i: number, j: number) => j * nb + i;
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < nb; i++) {
      const cx = ox + lines[i]! + P / 2;
      const cz = oz + lines[j]! + P / 2;
      const centrality = Math.min(1, Math.hypot(i - centerIdx, j - centerIdx) / Math.max(1, centerIdx * Math.SQRT2));
      let use: BlockDef["use"] = "buildings";
      const isCenter = Math.abs(i - centerIdx) < 0.6 && Math.abs(j - centerIdx) < 0.6;
      if (isCenter && (plan.archetype === "town" || plan.props.market || plan.features.includes("park"))) use = plan.props.market ? "plaza" : "park";
      else if (rng.chance(parkChance) || (plan.features.includes("park") && rng.chance(0.12))) use = "park";
      else if (!futuristic && centrality > 0.75 && rng.chance(0.05)) use = "parking";
      layout.blocks.push({ center: [cx, cz], size: [inner, inner], sidewalk: g.sidewalk, use, centrality });
      layout.reserved.push({ cx, cz, hx: inner / 2, hz: inner / 2, rot: 0 });
    }
  }
  // Garantiza al menos un parque si se pidió.
  if (plan.features.includes("park") && !layout.blocks.some((b) => b.use === "park" || b.use === "plaza")) {
    const b = layout.blocks[Math.floor(layout.blocks.length / 2)]!;
    b.use = "park";
  }

  // Lotes dentro de cada manzana.
  for (const b of layout.blocks) {
    const lotArea = b.size[0] - 2 * b.sidewalk;
    const [cx, cz] = b.center;
    if (b.use === "park" || b.use === "plaza") {
      addParkContents(layout, b, rng, plan);
      continue;
    }
    if (b.use === "parking") {
      for (let k = 0; k < 6; k++) {
        const px = cx - lotArea / 2 + 4 + (k % 3) * ((lotArea - 8) / 2);
        const pz = cz + (k < 3 ? -lotArea / 4 : lotArea / 4);
        layout.parking.push({ position: [px, pz], rotation: Math.PI / 2 });
      }
      continue;
    }
    const zone: LotDef["zone"] = b.centrality < 0.34 ? "core" : b.centrality < 0.7 ? "mid" : "outer";
    // Torres en el centro: un lote grande por manzana.
    const tower = (zone === "core" && (plan.buildings.maxFloors >= 25 || futuristic) && rng.chance(futuristic ? 0.8 : 0.55));
    let cols: number;
    if (tower) cols = 1;
    else if (zone === "outer" && plan.buildings.kinds.includes("house")) cols = lotArea > 30 ? 3 : 2;
    else cols = 2;
    const cell = lotArea / cols;
    for (let r = 0; r < cols; r++) {
      for (let c = 0; c < cols; c++) {
        const onEdge = r === 0 || c === 0 || r === cols - 1 || c === cols - 1;
        if (!onEdge) continue;
        const lx = cx - lotArea / 2 + cell * (c + 0.5);
        const lz = cz - lotArea / 2 + cell * (r + 0.5);
        // El frente mira hacia el borde de manzana más cercano.
        const options: number[] = [];
        if (r === cols - 1) options.push(0); // +Z
        if (r === 0) options.push(Math.PI); // -Z
        if (c === cols - 1) options.push(Math.PI / 2); // +X
        if (c === 0) options.push(-Math.PI / 2); // -X
        const rotation = cols === 1 ? rng.pick([0, Math.PI, Math.PI / 2, -Math.PI / 2]) : rng.pick(options);
        if (zone !== "core" && plan.buildings.density < 1 && rng.chance((1 - plan.buildings.density) * 0.5)) {
          layout.treeSpots.push({ position: [lx, lz], species: "park" });
          continue;
        }
        layout.lots.push({ center: [lx, lz], width: cell - 1.2, depth: cell - 1.2, rotation, centrality: b.centrality, zone });
      }
    }
  }

  // Grafo peatonal: esquinas de vereda + cruces peatonales.
  const nav = layout.navigation;
  const cornerNode = new Map<string, number>();
  const sw = g.sidewalk;
  const addNode = (p: Vec2) => nav.nodes.push(p) - 1;
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < nb; i++) {
      const b = layout.blocks[blockIndex(i, j)]!;
      const h = b.size[0] / 2 - sw / 2;
      const ids: number[] = [];
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const id = addNode([b.center[0] + sx * h, b.center[1] + sz * h]);
        cornerNode.set(`${i},${j},${sx},${sz}`, id);
        ids.push(id);
      }
      for (let k = 0; k < 4; k++) nav.edges.push({ a: ids[k]!, b: ids[(k + 1) % 4]!, crossing: null });
    }
  }
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < nb; i++) {
      // Cruce hacia la manzana de la derecha (+X): cruza una calle que corre en Z.
      if (i < nb - 1) {
        for (const sz of [-1, 1] as const) {
          const a = cornerNode.get(`${i},${j},1,${sz}`)!;
          const bb = cornerNode.get(`${i + 1},${j},-1,${sz}`)!;
          nav.edges.push({ a, b: bb, crossing: { intersectionId: interId(i + 1, sz < 0 ? j : j + 1), streetAxis: "z" } });
        }
      }
      if (j < nb - 1) {
        for (const sx of [-1, 1] as const) {
          const a = cornerNode.get(`${i},${j},${sx},1`)!;
          const bb = cornerNode.get(`${i},${j + 1},${sx},-1`)!;
          nav.edges.push({ a, b: bb, crossing: { intersectionId: interId(sx < 0 ? i : i + 1, j + 1), streetAxis: "x" } });
        }
      }
    }
  }
  // Puntos de interés de parques y plazas conectados al nodo más cercano.
  for (const poi of nav.pois) poi.node = nearestNode(nav.nodes, poi.position);

  // Mobiliario urbano sobre veredas.
  for (const b of layout.blocks) {
    const [cx, cz] = b.center;
    const h = b.size[0] / 2;
    const edgeOff = h - 0.6; // junto al cordón
    for (const side of [0, 1, 2, 3]) {
      const n = Math.max(1, Math.floor(b.size[0] / 22));
      for (let k = 0; k < n; k++) {
        const t = -h + 6 + ((b.size[0] - 12) * (k + 0.5)) / n;
        const [px, pz, rot] =
          side === 0 ? [cx + t, cz - edgeOff, Math.PI] : side === 1 ? [cx + edgeOff, cz + t, Math.PI / 2] : side === 2 ? [cx - t, cz + edgeOff, 0] : [cx - edgeOff, cz - t, -Math.PI / 2];
        if (plan.props.streetlights && (k + side) % 2 === 0) layout.props.push({ kind: japanese ? "lantern" : "streetlight", position: [px, pz], rotation: rot });
        else if (!futuristic && plan.vegetation.density > 0.1) layout.treeSpots.push({ position: [px - Math.sin(rot) * 0.6, pz - Math.cos(rot) * 0.6], species: "street" });
        if (rng.chance(0.18)) layout.props.push({ kind: rng.pick(["trash_bin", "hydrant", "bench"] as const), position: [px + Math.cos(rot) * 3, pz - Math.sin(rot) * 3], rotation: rot });
        if (plan.props.signs && rng.chance(futuristic || japanese ? 0.35 : 0.1))
          layout.props.push({ kind: "billboard", position: [px + Math.cos(rot) * 6, pz - Math.sin(rot) * 6], rotation: rot });
      }
    }
  }

  // Semáforos: uno por cada acceso a los cruces con luces.
  for (const inter of layout.intersections) {
    if (!inter.hasLights) continue;
    const [ix, iz] = inter.position;
    const o = g.street / 2 + 0.8;
    // Los postes que controlan tránsito en X están a los costados del eje X.
    layout.props.push({ kind: "traffic_light", position: [ix - o, iz + o], rotation: -Math.PI / 2, intersectionId: inter.id, axis: "x" });
    layout.props.push({ kind: "traffic_light", position: [ix + o, iz - o], rotation: Math.PI / 2, intersectionId: inter.id, axis: "x" });
    layout.props.push({ kind: "traffic_light", position: [ix + o, iz + o], rotation: 0, intersectionId: inter.id, axis: "z" });
    layout.props.push({ kind: "traffic_light", position: [ix - o, iz - o], rotation: Math.PI, intersectionId: inter.id, axis: "z" });
  }

  // Rutas de tránsito: rectángulos sobre la grilla con esquinas redondeadas.
  const routeCount = Math.min(10, Math.max(2, Math.ceil(plan.vehicles.count / 3)));
  for (let r = 0; r < routeCount; r++) {
    let i0 = rng.int(0, nb - 1);
    let i1 = rng.int(i0 + 1, nb);
    let j0 = rng.int(0, nb - 1);
    let j1 = rng.int(j0 + 1, nb);
    if (r === 0) {
      i0 = 0;
      i1 = nb;
      j0 = 0;
      j1 = nb;
    }
    let pts: Vec2[] = [
      [ox + lines[i0]!, oz + lines[j0]!],
      [ox + lines[i1]!, oz + lines[j0]!],
      [ox + lines[i1]!, oz + lines[j1]!],
      [ox + lines[i0]!, oz + lines[j1]!],
    ];
    if (rng.chance(0.5)) pts = pts.reverse();
    layout.routes.push({
      id: `route_${r}`,
      points: filletPolyline(pts, true, 6, 6),
      closed: true,
      kind: "road",
      altitude: 0,
      lane: g.street / 4 - 0.6,
      speedLimit: futuristic ? 16 : 12,
    });
  }
  if (plan.vehicles.flying) {
    const air = Math.max(2, Math.ceil(plan.vehicles.count / 6));
    for (let r = 0; r < air; r++) {
      const i0 = rng.int(0, nb - 1), i1 = rng.int(i0 + 1, nb);
      const j0 = rng.int(0, nb - 1), j1 = rng.int(j0 + 1, nb);
      layout.routes.push({
        id: `air_${r}`,
        points: filletPolyline(
          [
            [ox + lines[i0]!, oz + lines[j0]!],
            [ox + lines[i1]!, oz + lines[j0]!],
            [ox + lines[i1]!, oz + lines[j1]!],
            [ox + lines[i0]!, oz + lines[j1]!],
          ],
          true,
          14,
          8,
        ),
        closed: true,
        kind: "air",
        altitude: rng.range(28, 70),
        lane: rng.range(-3, 3),
        speedLimit: rng.range(18, 28),
      });
    }
  }

  // Estacionamiento junto al cordón, en la banda externa de cada calle.
  const parkOff = g.street / 2 - 1.2;
  for (let i = 0; i <= nb; i++) {
    for (let j = 0; j < nb; j++) {
      const c = lines[i]!;
      const mid = lines[j]! + P / 2;
      for (const k of [-1, 1]) {
        if (rng.chance(0.35)) layout.parking.push({ position: [ox + c + parkOff * k, oz + mid + rng.range(-10, 10)], rotation: 0 });
        if (rng.chance(0.35)) layout.parking.push({ position: [ox + mid + rng.range(-10, 10), oz + c + parkOff * k], rotation: Math.PI / 2 });
      }
    }
  }

  // Hitos.
  if (plan.buildings.landmark === "stadium") layout.specials.push({ kind: "stadium", center: [ox + E + 40, oz], rotation: 0, size: [70, 50] });
  return layout;
}

function addParkContents(layout: Layout, b: BlockDef, rng: Rng, plan: WorldPlan) {
  const [cx, cz] = b.center;
  const inner = b.size[0] / 2 - b.sidewalk - 2;
  if (b.use === "plaza") {
    layout.props.push({ kind: plan.style === "medieval" ? "well" : "fountain", position: [cx, cz], rotation: 0 });
    layout.navigation.pois.push({ id: `poi_f${layout.navigation.pois.length}`, position: [cx + 5, cz], facing: -Math.PI / 2, kind: "fountain", node: -1 });
    const stalls = plan.props.market ? 8 : 0;
    for (let k = 0; k < stalls; k++) {
      const a = (k / stalls) * Math.PI * 2;
      const r = inner * 0.62;
      const pos: Vec2 = [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
      const rot = Math.atan2(cx - pos[0], cz - pos[1]);
      layout.props.push({ kind: "stall", position: pos, rotation: rot });
      layout.navigation.pois.push({
        id: `poi_s${layout.navigation.pois.length}`,
        position: [pos[0] + Math.sin(rot) * 2.2, pos[1] + Math.cos(rot) * 2.2],
        facing: rot + Math.PI,
        kind: "stall",
        node: -1,
      });
    }
    for (let k = 0; k < 4; k++) layout.treeSpots.push({ position: [cx + (k < 2 ? -1 : 1) * inner * 0.85, cz + (k % 2 ? -1 : 1) * inner * 0.85], species: "park" });
    return;
  }
  // Parque: árboles, bancos y una fuente o estatua central.
  layout.props.push({ kind: rng.chance(0.5) ? "fountain" : "statue", position: [cx, cz], rotation: 0 });
  const benches = plan.props.benches ? 6 : 2;
  for (let k = 0; k < benches; k++) {
    const a = (k / benches) * Math.PI * 2 + 0.3;
    const pos: Vec2 = [cx + Math.cos(a) * 7, cz + Math.sin(a) * 7];
    const rot = Math.atan2(cx - pos[0], cz - pos[1]);
    layout.props.push({ kind: "bench", position: pos, rotation: rot });
    layout.navigation.pois.push({
      id: `poi_b${layout.navigation.pois.length}`,
      position: [pos[0] + Math.sin(rot) * 0.45, pos[1] + Math.cos(rot) * 0.45],
      facing: rot,
      kind: "bench",
      node: -1,
    });
  }
  const trees = Math.round(10 + plan.vegetation.density * 14);
  for (let k = 0; k < trees; k++) {
    const x = cx + rng.range(-inner, inner);
    const z = cz + rng.range(-inner, inner);
    if (Math.hypot(x - cx, z - cz) < 10) continue;
    layout.treeSpots.push({ position: [x, z], species: "park" });
  }
}

function nearestNode(nodes: Vec2[], p: Vec2): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i]![0] - p[0]) ** 2 + (nodes[i]![1] - p[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Trazado orgánico (pueblos medievales, aldeas, islas)
// ---------------------------------------------------------------------------

function organicLayout(plan: WorldPlan, site: Site, rng: Rng): Layout {
  const [ox, oz] = site.center;
  const R = site.radius;
  const layout = emptyLayout("organic", [ox, oz + R * 0.55]);
  const dirt = plan.archetype !== "town" && plan.archetype !== "city";
  const roadKind: RoadKind = dirt ? "dirt" : "street";
  const width = dirt ? 5.5 : 8;
  const plazaR = plan.archetype === "island" ? 9 : 15;

  // Calle principal que cruza el asentamiento atravesando la plaza.
  const angle = rng.range(0, Math.PI);
  const ux = Math.cos(angle), uz = Math.sin(angle);
  const ctrl: Vec2[] = [];
  for (let k = -3; k <= 3; k++) {
    const t = (k / 3) * R * 1.05;
    const wob = k === 0 ? 0 : rng.range(-10, 10);
    ctrl.push([ox + ux * t - uz * wob, oz + uz * t + ux * wob]);
  }
  const main = catmullRom(ctrl, false, 4);
  layout.roads.push({ kind: roadKind, points: main, closed: false, width, markings: false, name: "Calle Mayor" });

  // Calles secundarias hacia afuera.
  const branches = plan.size === "small" ? 3 : plan.size === "medium" ? 4 : 6;
  const branchRoads: Vec2[][] = [];
  for (let b = 0; b < branches; b++) {
    const t = rng.range(0.18, 0.82);
    const idx = Math.floor(t * (main.length - 1));
    const start = main[idx]!;
    const next = main[Math.min(main.length - 1, idx + 1)]!;
    const tx = next[0] - start[0], tz = next[1] - start[1];
    const tl = Math.hypot(tx, tz) || 1;
    const side = b % 2 === 0 ? 1 : -1;
    const nx = (-tz / tl) * side, nz = (tx / tl) * side;
    const len = rng.range(R * 0.45, R * 0.85);
    const pts: Vec2[] = [start];
    for (let k = 1; k <= 3; k++) {
      const d = (k / 3) * len;
      const wob = rng.range(-6, 6);
      pts.push([start[0] + nx * d + (tx / tl) * wob, start[1] + nz * d + (tz / tl) * wob]);
    }
    const road = catmullRom(pts, false, 4);
    branchRoads.push(road);
    layout.roads.push({ kind: roadKind, points: road, closed: false, width: width * 0.85, markings: false, name: `Calle ${b + 1}` });
  }

  // Plaza central.
  layout.specials.push({ kind: "plaza", center: [ox, oz], rotation: 0, size: [plazaR * 2, plazaR * 2] });
  layout.reserved.push({ cx: ox, cz: oz, hx: plazaR, hz: plazaR, rot: 0 });
  layout.props.push({ kind: plan.archetype === "island" ? "statue" : "well", position: [ox, oz], rotation: 0 });
  layout.navigation.pois.push({ id: "poi_well", position: [ox + 2, oz], facing: -Math.PI / 2, kind: "fountain", node: -1 });
  if (plan.props.market) {
    const stalls = plan.size === "small" ? 6 : 9;
    for (let k = 0; k < stalls; k++) {
      const a = (k / stalls) * Math.PI * 2 + 0.2;
      const pos: Vec2 = [ox + Math.cos(a) * (plazaR - 3), oz + Math.sin(a) * (plazaR - 3)];
      const rot = Math.atan2(ox - pos[0], oz - pos[1]);
      layout.props.push({ kind: "stall", position: pos, rotation: rot });
      layout.navigation.pois.push({
        id: `poi_s${k}`,
        position: [pos[0] + Math.sin(rot) * 2.2, pos[1] + Math.cos(rot) * 2.2],
        facing: rot + Math.PI,
        kind: "stall",
        node: -1,
      });
    }
  }

  // Reservar calzadas.
  for (const road of layout.roads) reservePolyline(layout, road.points, road.width / 2 + 0.8);

  // Lotes a ambos lados de cada calle.
  const lotObbs: Obb2[] = [];
  const allRoads = [main, ...branchRoads];
  const houseW = plan.archetype === "island" ? 7 : plan.style === "medieval" ? 9 : 10;
  const tryLot = (pos: Vec2, rot: number, w: number, d: number, zone: LotDef["zone"]) => {
    const dc = Math.hypot(pos[0] - ox, pos[1] - oz);
    if (dc > R * 1.02 || dc < plazaR + d * 0.5) return;
    const obb: Obb2 = { cx: pos[0], cz: pos[1], hx: w / 2, hz: d / 2, rot };
    for (const o of lotObbs) if (obbOverlap(o, obb, 1)) return;
    for (const road of layout.roads) if (polylineHitsObb(road.points, road.width / 2 + 0.6, obb)) return;
    if (site.castle && Math.hypot(pos[0] - site.castle.position[0], pos[1] - site.castle.position[1]) < site.castle.size) return;
    lotObbs.push(obb);
    layout.lots.push({ center: pos, width: w, depth: d, rotation: rot, centrality: dc / R, zone });
    layout.reserved.push(obb);
  };
  for (const road of allRoads) {
    const roadW = road === main ? width : width * 0.85;
    let s = 0;
    for (let k = 1; k < road.length; k++) {
      const a = road[k - 1]!, b = road[k]!;
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      s += seg;
      if (s < houseW + rng.range(0, 3)) continue;
      s = 0;
      const tx = (b[0] - a[0]) / seg, tz = (b[1] - a[1]) / seg;
      for (const side of [1, -1]) {
        if (rng.chance(1 - plan.buildings.density * 0.9)) continue;
        const w = houseW * rng.range(0.8, 1.15);
        const d = houseW * rng.range(0.8, 1.2);
        const nx = -tz * side, nz = tx * side;
        const off = roadW / 2 + 1.5 + d / 2;
        const pos: Vec2 = [b[0] + nx * off, b[1] + nz * off];
        // Frente (+Z local) mirando a la calle: rotación tal que (sin r, cos r) = -n.
        const rot = Math.atan2(-nx, -nz);
        const dc = Math.hypot(pos[0] - ox, pos[1] - oz) / R;
        tryLot(pos, rot, w, d, dc < 0.4 ? "core" : dc < 0.75 ? "mid" : "outer");
      }
    }
  }

  // Castillo con camino desde la plaza.
  if (site.castle) {
    const [cx, cz] = site.castle.position;
    const rot = Math.atan2(ox - cx, oz - cz);
    layout.specials.push({ kind: "castle", center: [cx, cz], rotation: rot, size: [site.castle.size, site.castle.size] });
    layout.reserved.push({ cx, cz, hx: site.castle.size / 2 + 4, hz: site.castle.size / 2 + 4, rot });
    const gate: Vec2 = [cx + Math.sin(rot) * (site.castle.size / 2 + 3), cz + Math.cos(rot) * (site.castle.size / 2 + 3)];
    const mid: Vec2 = [(gate[0] + ox) / 2 + rng.range(-8, 8), (gate[1] + oz) / 2 + rng.range(-8, 8)];
    const path = catmullRom([[ox, oz], mid, gate], false, 4);
    layout.roads.push({ kind: "dirt", points: path, closed: false, width: 5, markings: false, name: "Camino al castillo" });
    reservePolyline(layout, path, 3);
    layout.props.push({ kind: "torch", position: [gate[0] + Math.cos(rot) * 4, gate[1] - Math.sin(rot) * 4], rotation: rot });
    layout.props.push({ kind: "torch", position: [gate[0] - Math.cos(rot) * 4, gate[1] + Math.sin(rot) * 4], rotation: rot });
    allRoads.push(path);
  } else if (plan.buildings.landmark === "temple") {
    const a = angle + Math.PI / 2;
    const pos: Vec2 = [ox + Math.cos(a) * (plazaR + 12), oz + Math.sin(a) * (plazaR + 12)];
    layout.specials.push({ kind: "temple", center: pos, rotation: Math.atan2(ox - pos[0], oz - pos[1]), size: [14, 20] });
    layout.reserved.push({ cx: pos[0], cz: pos[1], hx: 9, hz: 12, rot: 0 });
  }

  // Muelle y sombrillas en la isla.
  if (plan.archetype === "island") {
    const dir = Math.atan2(oz, ox); // hacia la costa más cercana (alejándose del centro de la isla)
    const shore: Vec2 = [ox + Math.cos(dir) * (R + 10), oz + Math.sin(dir) * (R + 10)];
    layout.props.push({ kind: "pier", position: shore, rotation: Math.atan2(Math.cos(dir), Math.sin(dir)) });
    for (let k = 0; k < 5; k++) {
      const a = dir + rng.range(-0.6, 0.6);
      const r = R + rng.range(-2, 6);
      layout.props.push({ kind: "parasol", position: [ox + Math.cos(a) * r, oz + Math.sin(a) * r], rotation: rng.range(0, 6) });
    }
  }

  // Faroles a lo largo de la calle principal.
  if (plan.props.streetlights) {
    for (let k = 4; k < main.length - 4; k += 6) {
      const a = main[k]!, b = main[k + 1]!;
      const tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      const side = k % 12 === 4 ? 1 : -1;
      const nx = (-tz / tl) * side, nz = (tx / tl) * side;
      const pos: Vec2 = [a[0] + nx * (width / 2 + 0.8), a[1] + nz * (width / 2 + 0.8)];
      layout.props.push({ kind: plan.style === "medieval" ? "torch" : plan.style === "japanese" ? "lantern" : "streetlight", position: pos, rotation: Math.atan2(-nx, -nz) });
    }
  }

  // Grafo peatonal a lo largo de las calles.
  buildPolylineNav(layout, allRoads, 6);
  for (const poi of layout.navigation.pois) poi.node = nearestNode(layout.navigation.nodes, poi.position);

  // Carros estacionados junto a la plaza.
  for (let k = 0; k < 3; k++) {
    const a = rng.range(0, Math.PI * 2);
    layout.parking.push({ position: [ox + Math.cos(a) * (plazaR + 4), oz + Math.sin(a) * (plazaR + 4)], rotation: a });
  }
  return layout;
}

// ---------------------------------------------------------------------------
// Circuito de carreras
// ---------------------------------------------------------------------------

const CIRCUIT_SHAPE: Vec2[] = [
  [-0.72, 0.62],
  [0.72, 0.62],
  [0.95, 0.38],
  [0.86, 0.02],
  [0.5, -0.08],
  [0.36, -0.5],
  [-0.1, -0.78],
  [-0.62, -0.6],
  [-0.92, -0.12],
  [-0.94, 0.42],
];

function circuitLayout(plan: WorldPlan, site: Site, rng: Rng): Layout {
  const [ox, oz] = site.center;
  const R = site.radius * 0.88;
  const layout = emptyLayout("circuit", [ox, oz + R * 0.62 + 30]);
  const ctrl: Vec2[] = CIRCUIT_SHAPE.map(([x, z], i) => {
    const j = i < 2 ? 0 : 0.07; // la recta principal no se deforma
    return [ox + (x + rng.range(-j, j)) * R, oz + (z + rng.range(-j, j)) * R];
  });
  const track = catmullRom(ctrl, true, 3);
  const width = 14;
  layout.roads.push({ kind: "track", points: track, closed: true, width, markings: true, name: "Circuito" });
  reservePolyline(layout, track, width / 2 + 3, true);

  // Calle de boxes paralela a la recta principal (por dentro).
  const zMain = oz + 0.62 * R;
  const pitZ = zMain - width / 2 - 9;
  const pitLane: Vec2[] = [
    [ox - 0.55 * R, pitZ],
    [ox + 0.55 * R, pitZ],
  ];
  layout.roads.push({ kind: "street", points: pitLane, closed: false, width: 8, markings: false, name: "Calle de boxes" });
  reservePolyline(layout, pitLane, 5);
  layout.specials.push({ kind: "pit", center: [ox, pitZ - 4 - 9], rotation: 0, size: [R * 0.9, 18] });
  layout.reserved.push({ cx: ox, cz: pitZ - 13, hx: R * 0.45 + 2, hz: 11, rot: 0 });

  // Tribunas por fuera de la recta principal, mirando a la pista.
  const stands = plan.size === "small" ? 2 : plan.size === "medium" ? 3 : 4;
  const standW = (R * 1.2) / stands;
  for (let k = 0; k < stands; k++) {
    const cx = ox - R * 0.6 + standW * (k + 0.5);
    const cz = zMain + width / 2 + 4 + 8;
    layout.specials.push({ kind: "grandstand", center: [cx, cz], rotation: Math.PI, size: [standW - 4, 16] });
    layout.reserved.push({ cx, cz, hx: standW / 2, hz: 10, rot: 0 });
    for (let s = 0; s < 4; s++)
      layout.navigation.pois.push({
        id: `poi_v${k}_${s}`,
        position: [cx + (s - 1.5) * (standW / 5), cz - 3 + s * 0.2],
        facing: Math.PI,
        kind: "viewpoint",
        node: -1,
      });
  }

  // Torres de iluminación y neumáticos en curvas.
  for (let k = 0; k < track.length; k += 18) {
    const a = track[k]!, b = track[(k + 1) % track.length]!;
    const tx = b[0] - a[0], tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    const outward = (a[0] - ox) * nx + (a[1] - oz) * nz > 0 ? 1 : -1;
    const pos: Vec2 = [a[0] + nx * outward * (width / 2 + 7), a[1] + nz * outward * (width / 2 + 7)];
    if (Math.abs(pos[1] - zMain) < 22 && Math.abs(pos[0] - ox) < R * 0.7) continue;
    layout.props.push({ kind: "light_tower", position: pos, rotation: Math.atan2(-nx * outward, -nz * outward) });
  }
  const curv = curvaturePoints(track, 0.18);
  for (const idx of curv.filter((_, i) => i % 3 === 0)) {
    const a = track[idx]!, b = track[(idx + 1) % track.length]!;
    const tx = b[0] - a[0], tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    const outward = (a[0] - ox) * nx + (a[1] - oz) * nz > 0 ? 1 : -1;
    layout.props.push({ kind: "tire_stack", position: [a[0] + nx * outward * (width / 2 + 3.5), a[1] + nz * outward * (width / 2 + 3.5)], rotation: 0 });
  }
  layout.props.push({ kind: "billboard", position: [ox, zMain + width / 2 + 1.5], rotation: Math.PI });

  // Rutas de carrera con carriles distintos.
  for (let l = 0; l < 3; l++) {
    layout.routes.push({ id: `race_${l}`, points: track, closed: true, kind: "race", altitude: 0, lane: (l - 1) * 3.2, speedLimit: 34 + l * 3 });
  }

  // Grafo peatonal: zona de tribunas y boxes.
  const nodes: Vec2[] = [];
  for (let k = 0; k <= 8; k++) nodes.push([ox - R * 0.6 + (R * 1.2 * k) / 8, zMain + width / 2 + 2.5]);
  for (let k = 0; k <= 8; k++) nodes.push([ox - R * 0.5 + (R * 1.0 * k) / 8, pitZ - 4.5]);
  layout.navigation.nodes.push(...nodes);
  for (let k = 0; k < 8; k++) {
    layout.navigation.edges.push({ a: k, b: k + 1, crossing: null });
    layout.navigation.edges.push({ a: 9 + k, b: 10 + k, crossing: null });
  }
  for (const poi of layout.navigation.pois) poi.node = nearestNode(layout.navigation.nodes, poi.position);
  return layout;
}

function curvaturePoints(points: Vec2[], threshold: number): number[] {
  const out: number[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[(i - 2 + n) % n]!, b = points[i]!, c = points[(i + 2) % n]!;
    const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > threshold) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Base (desierto / ciencia ficción)
// ---------------------------------------------------------------------------

function clusterLayout(plan: WorldPlan, site: Site, rng: Rng): Layout {
  const [ox, oz] = site.center;
  const R = site.radius;
  const layout = emptyLayout("cluster", [ox, oz + R * 0.75]);
  layout.specials.push({ kind: "landing_pad", center: [ox, oz], rotation: 0, size: [22, 22] });
  layout.reserved.push({ cx: ox, cz: oz, hx: 12, hz: 12, rot: 0 });
  layout.props.push({ kind: "landing_pad", position: [ox, oz], rotation: 0 });

  const ring = R * 0.62;
  const ringPath: Vec2[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ringPath.push([ox + Math.cos(a) * ring, oz + Math.sin(a) * ring]);
  }
  layout.roads.push({ kind: "dirt", points: ringPath, closed: true, width: 7, markings: false, name: "Anillo" });
  reservePolyline(layout, ringPath, 4.5, true);
  const spokes = 4;
  const spokeRoads: Vec2[][] = [];
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2 + Math.PI / 4;
    const path: Vec2[] = [
      [ox + Math.cos(a) * 12, oz + Math.sin(a) * 12],
      [ox + Math.cos(a) * (R * 1.05), oz + Math.sin(a) * (R * 1.05)],
    ];
    spokeRoads.push(path);
    layout.roads.push({ kind: "dirt", points: path, closed: false, width: 6, markings: false, name: `Acceso ${s + 1}` });
    reservePolyline(layout, path, 4);
  }

  // Módulos alrededor del anillo, por dentro y por fuera.
  const count = Math.round((plan.size === "small" ? 8 : plan.size === "medium" ? 12 : 18) * (0.5 + plan.buildings.density));
  const obbs: Obb2[] = [];
  for (let k = 0; k < count * 3 && layout.lots.length < count; k++) {
    const a = rng.range(0, Math.PI * 2);
    const outside = rng.chance(0.5);
    const r = ring + (outside ? 1 : -1) * rng.range(9, 16);
    const size = rng.range(9, 15);
    const pos: Vec2 = [ox + Math.cos(a) * r, oz + Math.sin(a) * r];
    const rot = Math.atan2(ox - pos[0], oz - pos[1]) + (outside ? 0 : Math.PI);
    const obb: Obb2 = { cx: pos[0], cz: pos[1], hx: size / 2, hz: size / 2, rot };
    if (obbs.some((o) => obbOverlap(o, obb, 2))) continue;
    if (layout.roads.some((rd) => polylineHitsObb(rd.points, rd.width / 2 + 0.5, obb))) continue;
    obbs.push(obb);
    layout.lots.push({ center: pos, width: size, depth: size, rotation: outside ? rot + Math.PI : rot, centrality: r / R, zone: "mid" });
    layout.reserved.push(obb);
  }
  layout.specials.push({ kind: "tower", center: [ox + ring * 0.35, oz - ring * 0.35], rotation: 0, size: [8, 8] });
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, Math.PI * 2);
    layout.props.push({ kind: "antenna", position: [ox + Math.cos(a) * (R * 0.95), oz + Math.sin(a) * (R * 0.95)], rotation: 0 });
  }
  // Postes de luz al costado del anillo (no sobre la calzada).
  for (let k = 0; k < 24; k += 3) {
    const a = (k / 24) * Math.PI * 2;
    layout.props.push({ kind: "streetlight", position: [ox + Math.cos(a) * (ring + 5), oz + Math.sin(a) * (ring + 5)], rotation: Math.atan2(-Math.cos(a), -Math.sin(a)) });
  }

  layout.routes.push({ id: "ring", points: ringPath, closed: true, kind: "road", altitude: 0, lane: 1.6, speedLimit: 9 });
  if (plan.vehicles.flying) {
    const air: Vec2[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      air.push([ox + Math.cos(a) * R * 1.3, oz + Math.sin(a) * R * 0.9]);
    }
    layout.routes.push({ id: "air_0", points: air, closed: true, kind: "air", altitude: 35, lane: 0, speedLimit: 22 });
  }
  buildPolylineNav(layout, [ringPath, ...spokeRoads], 7, true);
  return layout;
}

// ---------------------------------------------------------------------------
// Naturaleza (bosques, valles): claro con algunas cabañas y senderos
// ---------------------------------------------------------------------------

function scatterLayout(plan: WorldPlan, site: Site, rng: Rng): Layout {
  const [ox, oz] = site.center;
  const R = site.radius;
  const layout = emptyLayout("scatter", [ox, oz + R * 0.4]);
  const huts = plan.buildings.density > 0 ? Math.max(1, Math.round(plan.buildings.density * 10)) : 0;
  const obbs: Obb2[] = [];
  for (let k = 0; k < huts * 4 && layout.lots.length < huts; k++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(R * 0.4, R * 0.95);
    const pos: Vec2 = [ox + Math.cos(a) * r, oz + Math.sin(a) * r];
    const rot = Math.atan2(ox - pos[0], oz - pos[1]);
    const obb: Obb2 = { cx: pos[0], cz: pos[1], hx: 4, hz: 4, rot };
    if (obbs.some((o) => obbOverlap(o, obb, 2))) continue;
    obbs.push(obb);
    layout.lots.push({ center: pos, width: 7, depth: 7, rotation: rot, centrality: r / R, zone: "outer" });
    layout.reserved.push(obb);
  }
  // Sendero circular por el claro.
  const path: Vec2[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const r = R * 0.7 + rng.range(-3, 3);
    path.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]);
  }
  const smooth = catmullRom(path, true, 4);
  layout.roads.push({ kind: "path", points: smooth, closed: true, width: 3, markings: false, name: "Sendero" });
  reservePolyline(layout, smooth, 2, true);
  layout.props.push({ kind: "well", position: [ox, oz], rotation: 0 });
  buildPolylineNav(layout, [smooth], 6, true);
  return layout;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function reservePolyline(layout: Layout, pts: Vec2[], halfWidth: number, closed = false) {
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    const rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
    layout.reserved.push({ cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2, hx: halfWidth, hz: len / 2 + 0.5, rot });
  }
}

export function polylineHitsObb(pts: Vec2[], halfWidth: number, obb: Obb2): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    const seg: Obb2 = { cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2, hx: halfWidth, hz: len / 2, rot: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    if (obbOverlap(seg, obb)) return true;
  }
  return false;
}

function buildPolylineNav(layout: Layout, roads: Vec2[][], spacing: number, closedAll = false) {
  const nav = layout.navigation;
  const nodeIds: number[][] = [];
  for (const road of roads) {
    const ids: number[] = [];
    let acc = spacing;
    for (let k = 0; k < road.length; k++) {
      if (k > 0) acc += Math.hypot(road[k]![0] - road[k - 1]![0], road[k]![1] - road[k - 1]![1]);
      if (acc >= spacing || k === road.length - 1 || k === 0) {
        acc = 0;
        // Reutiliza nodos existentes cercanos para conectar calles entre sí.
        const p = road[k]!;
        let id = -1;
        for (let n = 0; n < nav.nodes.length; n++) {
          if (Math.hypot(nav.nodes[n]![0] - p[0], nav.nodes[n]![1] - p[1]) < spacing * 0.6) {
            id = n;
            break;
          }
        }
        if (id < 0) id = nav.nodes.push([p[0], p[1]]) - 1;
        if (ids[ids.length - 1] !== id) ids.push(id);
      }
    }
    nodeIds.push(ids);
    for (let k = 0; k < ids.length - 1; k++) nav.edges.push({ a: ids[k]!, b: ids[k + 1]!, crossing: null });
    if (closedAll && ids.length > 2) nav.edges.push({ a: ids[ids.length - 1]!, b: ids[0]!, crossing: null });
  }
}

export type { Poi };
