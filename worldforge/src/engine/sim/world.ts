import { polylineLengths, samplePolyline, type Obb2, pointInObb } from "../math";
import { Rng, hashString } from "../rng";
import { heightAt } from "../generation/terrain";
import type { Entity, EntityOf, Intersection, Navigation, NpcBehavior, Poi, Route, Terrain, WorldDoc } from "../types";
import { getVehicleModel } from "../models/vehicles";

/**
 * Simulación en tiempo de ejecución de tránsito y personajes. No modifica el
 * documento: parte de las posiciones iniciales de las entidades y puede
 * reiniciarse en cualquier momento.
 */

export const LIGHT_CYCLE = 24;

export type LightColor = "green" | "yellow" | "red";

export function lightState(inter: Intersection, axis: "x" | "z", time: number): LightColor {
  if (!inter.hasLights) return "green";
  const t = (((time + inter.phaseOffset) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  const xPhase: LightColor = t < 10 ? "green" : t < 12 ? "yellow" : "red";
  const zPhase: LightColor = t >= 12 && t < 22 ? "green" : t >= 22 ? "yellow" : "red";
  return axis === "x" ? xPhase : zPhase;
}

/** Segundos que quedan hasta que cambie la luz del eje dado. */
function lightRemaining(inter: Intersection, axis: "x" | "z", time: number): number {
  const t = (((time + inter.phaseOffset) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  if (axis === "x") return t < 10 ? 10 - t : t < 12 ? 12 - t : LIGHT_CYCLE - t;
  return t >= 12 && t < 22 ? 22 - t : t >= 22 ? LIGHT_CYCLE - t : 12 - t;
}

interface RouteRuntime {
  route: Route;
  lengths: { total: number; cumulative: number[] };
  stops: { s: number; inter: Intersection; axis: "x" | "z" }[];
}

export interface VehicleAgent {
  id: string;
  route: RouteRuntime | null;
  s: number;
  speed: number;
  cruise: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  wheelSpin: number;
  steer: number;
  length: number;
  wheelRadius: number;
  hover: number;
  parked: boolean;
  key: string;
}

export type NpcState = "walk" | "run" | "idle" | "wait" | "sit" | "interact" | "wave" | "cheer";

export interface NpcAgent {
  id: string;
  behavior: NpcBehavior;
  speed: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  homeX: number;
  homeZ: number;
  wanderRadius: number;
  state: NpcState;
  timer: number;
  // Navegación por grafo
  from: number;
  to: number;
  edge: number;
  offset: number;
  // Destino directo (deambular, puntos de interés)
  tx: number;
  tz: number;
  hasTarget: boolean;
  poi: Poi | null;
  returnNode: number;
  patrol: [number, number][];
  patrolIdx: number;
  greets: boolean;
  greetCooldown: number;
  resumeState: NpcState;
  key: string;
  rng: Rng;
}

export interface PlayerProbe {
  active: boolean;
  x: number;
  z: number;
}

export class SimWorld {
  time = 0;
  vehicles = new Map<string, VehicleAgent>();
  npcs = new Map<string, NpcAgent>();
  routes = new Map<string, RouteRuntime>();
  intersections = new Map<string, Intersection>();
  nav: Navigation = { nodes: [], edges: [], pois: [] };
  adjacency: number[][] = [];
  poisByNode = new Map<number, Poi[]>();
  poiBusy = new Set<string>();
  obstacles: Obb2[] = [];
  blocks: { x0: number; x1: number; z0: number; z1: number; top: number }[] = [];
  terrain: Terrain | null = null;
  player: PlayerProbe = { active: false, x: 0, z: 0 };
  private navRef: Navigation | null = null;
  private routesRef: Route[] | null = null;

  /** Sincroniza con el documento conservando el estado de los agentes que no cambiaron. */
  sync(doc: WorldDoc) {
    this.terrain = doc.terrain;
    if (this.routesRef !== doc.routes || this.intersections.size !== doc.intersections.length) {
      this.routesRef = doc.routes;
      this.intersections = new Map(doc.intersections.map((i) => [i.id, i]));
      this.routes = new Map(doc.routes.map((r) => [r.id, this.buildRoute(r)]));
      for (const v of this.vehicles.values()) v.key = ""; // fuerza re-sincronización
    }
    if (this.navRef !== doc.navigation) {
      this.navRef = doc.navigation;
      this.nav = doc.navigation;
      this.adjacency = this.nav.nodes.map(() => []);
      this.nav.edges.forEach((e, i) => {
        this.adjacency[e.a]?.push(i);
        this.adjacency[e.b]?.push(i);
      });
      this.poisByNode = new Map();
      for (const p of this.nav.pois) {
        if (p.node < 0) continue;
        if (!this.poisByNode.has(p.node)) this.poisByNode.set(p.node, []);
        this.poisByNode.get(p.node)!.push(p);
      }
    }
    this.obstacles = [];
    this.blocks = [];
    const seenV = new Set<string>();
    const seenN = new Set<string>();
    for (const e of Object.values(doc.entities)) {
      if (e.type === "building") this.obstacles.push({ cx: e.transform.position[0], cz: e.transform.position[2], hx: (e.props.width * e.transform.scale[0]) / 2 + 0.4, hz: (e.props.depth * e.transform.scale[2]) / 2 + 0.4, rot: e.transform.rotation[1] });
      else if (e.type === "block") {
        const [x, y, z] = e.transform.position;
        this.blocks.push({ x0: x - e.props.size[0] / 2, x1: x + e.props.size[0] / 2, z0: z - e.props.size[1] / 2, z1: z + e.props.size[1] / 2, top: y + 0.18 });
      } else if (e.type === "vehicle" && e.parentId) {
        seenV.add(e.id);
        this.syncVehicle(e);
      } else if (e.type === "npc" && e.parentId) {
        seenN.add(e.id);
        this.syncNpc(e);
      }
    }
    for (const id of this.vehicles.keys()) if (!seenV.has(id)) this.vehicles.delete(id);
    for (const id of this.npcs.keys()) if (!seenN.has(id)) this.npcs.delete(id);
  }

  reset() {
    this.vehicles.clear();
    this.npcs.clear();
    this.poiBusy.clear();
    this.time = 0;
  }

  private buildRoute(route: Route): RouteRuntime {
    const lengths = polylineLengths(route.points, route.closed);
    const stops: RouteRuntime["stops"] = [];
    if (route.kind === "road") {
      const lit = [...this.intersections.values()].filter((i) => i.hasLights);
      let inside: Intersection | null = null;
      for (let s = 0; s < lengths.total; s += 1) {
        const p = samplePolyline(route.points, route.closed, lengths, s);
        const hit = lit.find((i) => Math.hypot(i.position[0] - p.x, i.position[1] - p.z) < i.radius + 0.5) ?? null;
        if (hit && hit !== inside) stops.push({ s, inter: hit, axis: Math.abs(p.dx) > Math.abs(p.dz) ? "x" : "z" });
        inside = hit;
      }
    }
    return { route, lengths, stops };
  }

  groundY(x: number, z: number): number {
    if (!this.terrain) return 0;
    for (const b of this.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b.top;
    return heightAt(this.terrain, x, z);
  }

  private syncVehicle(e: EntityOf<"vehicle">) {
    const key = `${e.props.routeId}|${e.props.routeT}|${e.props.parked}|${e.props.model}|${e.transform.position.join(",")}|${e.transform.rotation[1]}`;
    const existing = this.vehicles.get(e.id);
    const model = getVehicleModel(e.props.model);
    if (existing && existing.key === key) {
      existing.cruise = e.props.speed;
      return;
    }
    const route = !e.props.parked && e.props.routeId ? (this.routes.get(e.props.routeId) ?? null) : null;
    const agent: VehicleAgent = {
      id: e.id,
      route,
      s: route ? e.props.routeT * route.lengths.total : 0,
      speed: route ? e.props.speed * 0.5 : 0,
      cruise: e.props.speed,
      x: e.transform.position[0],
      y: e.transform.position[1],
      z: e.transform.position[2],
      yaw: e.transform.rotation[1],
      wheelSpin: 0,
      steer: 0,
      length: model.length,
      wheelRadius: model.wheels?.radius ?? 0.4,
      hover: model.hover,
      parked: !route,
      key,
    };
    if (route) this.poseVehicle(agent, 0);
    this.vehicles.set(e.id, agent);
  }

  private syncNpc(e: EntityOf<"npc">) {
    const key = `${e.props.behavior}|${e.transform.position.join(",")}|${e.props.wanderRadius}|${e.props.patrol.length}`;
    const existing = this.npcs.get(e.id);
    if (existing && existing.key === key) {
      existing.speed = e.props.speed;
      existing.greets = e.props.greets;
      return;
    }
    const [x, y, z] = e.transform.position;
    const rng = new Rng(hashString(e.id));
    const a: NpcAgent = {
      id: e.id,
      behavior: e.props.behavior,
      speed: e.props.speed,
      x,
      y,
      z,
      yaw: e.transform.rotation[1],
      homeX: x,
      homeZ: z,
      wanderRadius: e.props.wanderRadius,
      state: "idle",
      timer: rng.range(0, 2),
      from: -1,
      to: -1,
      edge: -1,
      offset: rng.range(-0.7, 0.7),
      tx: x,
      tz: z,
      hasTarget: false,
      poi: null,
      returnNode: -1,
      patrol: e.props.patrol,
      patrolIdx: 0,
      greets: e.props.greets,
      greetCooldown: rng.range(0, 5),
      resumeState: "idle",
      key,
      rng,
    };
    if ((a.behavior === "sidewalk" || a.behavior === "poi") && this.nav.edges.length) this.attachToGraph(a);
    this.npcs.set(e.id, a);
  }

  private attachToGraph(a: NpcAgent) {
    let best = -1;
    let bd = Infinity;
    this.nav.edges.forEach((e, i) => {
      if (e.crossing) return;
      const pa = this.nav.nodes[e.a]!, pb = this.nav.nodes[e.b]!;
      const d = distToSegment(a.x, a.z, pa[0], pa[1], pb[0], pb[1]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) return;
    const e = this.nav.edges[best]!;
    const forward = a.rng.chance(0.5);
    a.edge = best;
    a.from = forward ? e.a : e.b;
    a.to = forward ? e.b : e.a;
    a.state = "walk";
  }

  step(dt: number, opts: { traffic: boolean; npcs: boolean }) {
    this.time += dt;
    if (opts.traffic) for (const v of this.vehicles.values()) if (!v.parked) this.stepVehicle(v, dt);
    if (opts.npcs) for (const n of this.npcs.values()) this.stepNpc(n, dt);
  }

  // ---------- Vehículos ----------

  private poseVehicle(v: VehicleAgent, dt: number) {
    const r = v.route!;
    const p = samplePolyline(r.route.points, r.route.closed, r.lengths, v.s);
    const rx = -p.dz, rz = p.dx;
    const x = p.x + rx * r.route.lane;
    const z = p.z + rz * r.route.lane;
    const targetYaw = Math.atan2(p.dx, p.dz);
    let dy = targetYaw - v.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    v.yaw = dt > 0 ? v.yaw + dy * Math.min(1, dt * 8) : targetYaw;
    v.steer = Math.max(-0.5, Math.min(0.5, dy * 2.5));
    v.x = x;
    v.z = z;
    const ground = this.terrain ? heightAt(this.terrain, x, z) : 0;
    if (r.route.kind === "air") v.y = ground + r.route.altitude + Math.sin(this.time * 0.8 + v.s * 0.05) * 0.8;
    else v.y = ground + 0.07 + (v.hover > 0 ? v.hover + Math.sin(this.time * 2 + v.s) * 0.05 : 0);
  }

  private stepVehicle(v: VehicleAgent, dt: number) {
    const r = v.route!;
    let target = v.cruise;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    // Vehículos y personas adelante.
    for (const o of this.vehicles.values()) {
      if (o === v || (o.route?.route.kind === "air") !== (r.route.kind === "air")) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > 30) continue;
      const lateral = Math.abs(dx * fz - dz * fx);
      if (lateral > 2.1) continue;
      const gap = ahead - (v.length + o.length) / 2;
      const safe = 2.5 + v.speed * 0.9;
      if (gap < safe) target = Math.min(target, Math.max(0, o.speed * (gap / safe) - (gap < 1.5 ? 2 : 0)));
    }
    if (r.route.kind !== "air") {
      const people = [...this.npcs.values()].map((n) => [n.x, n.z] as const);
      if (this.player.active) people.push([this.player.x, this.player.z]);
      for (const [px, pz] of people) {
        const dx = px - v.x, dz = pz - v.z;
        const ahead = dx * fx + dz * fz;
        if (ahead <= 0 || ahead > 9) continue;
        if (Math.abs(dx * fz - dz * fx) > 1.6) continue;
        target = Math.min(target, Math.max(0, (ahead - v.length / 2 - 1.5) * 0.8));
      }
      // Semáforos.
      const total = r.lengths.total;
      for (const stop of r.stops) {
        let ds = stop.s - v.s;
        if (r.route.closed) ds = ((ds % total) + total) % total;
        const stopLine = ds - stop.inter.radius - 1.5 - v.length / 2;
        if (stopLine < -0.5 || stopLine > 35) continue;
        const color = lightState(stop.inter, stop.axis, this.time);
        if (color === "red" || (color === "yellow" && stopLine > v.speed * 0.8)) target = Math.min(target, Math.max(0, stopLine * 0.7));
        break;
      }
    }
    const accel = target > v.speed ? 3.2 : 9;
    v.speed += Math.max(-accel * dt, Math.min(accel * dt, target - v.speed));
    if (v.speed < 0.02 && target <= 0) v.speed = 0;
    v.s += v.speed * dt;
    if (!r.route.closed && v.s > r.lengths.total) v.s = 0;
    this.poseVehicle(v, dt);
    v.wheelSpin += (v.speed * dt) / v.wheelRadius;
  }

  // ---------- Personajes ----------

  private stepNpc(a: NpcAgent, dt: number) {
    a.greetCooldown -= dt;
    // Reacción al jugador: se detiene, lo mira y saluda.
    if (this.player.active && a.greets && a.state !== "sit" && a.greetCooldown <= 0) {
      const d = Math.hypot(this.player.x - a.x, this.player.z - a.z);
      if (d < 3.5) {
        a.resumeState = a.state === "wave" ? a.resumeState : a.state;
        a.state = "wave";
        a.timer = 2.6;
        a.greetCooldown = 20;
        a.yaw = Math.atan2(this.player.x - a.x, this.player.z - a.z);
      }
    }
    if (a.state === "wave") {
      a.timer -= dt;
      if (a.timer <= 0) a.state = a.resumeState === "wave" ? "idle" : a.resumeState;
      return;
    }
    switch (a.behavior) {
      case "idle":
        a.timer -= dt;
        if (a.state === "cheer" && a.timer <= 0) {
          a.state = "idle";
          a.timer = a.rng.range(5, 14);
        } else if (a.state === "idle" && a.timer <= 0 && a.greets) {
          a.state = "cheer";
          a.timer = a.rng.range(2, 4);
        }
        break;
      case "sidewalk":
      case "poi":
        if (a.edge >= 0 || a.poi) this.stepGraph(a, dt);
        else this.stepWander(a, dt);
        break;
      case "patrol":
        if (a.patrol.length >= 2) this.stepPatrol(a, dt);
        else this.stepWander(a, dt);
        break;
      default:
        this.stepWander(a, dt);
    }
    a.y = this.groundY(a.x, a.z);
  }

  private moveToward(a: NpcAgent, tx: number, tz: number, dt: number, speed = a.speed): boolean {
    const dx = tx - a.x, dz = tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    const stepLen = Math.min(d, speed * dt);
    const nx = a.x + (dx / d) * stepLen, nz = a.z + (dz / d) * stepLen;
    // Separación simple con otros personajes cercanos.
    a.x = nx;
    a.z = nz;
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    a.yaw += dy * Math.min(1, dt * 7);
    return d <= stepLen + 0.05;
  }

  private stepGraph(a: NpcAgent, dt: number) {
    const nodes = this.nav.nodes;
    if (a.state === "sit" || a.state === "interact" || (a.state === "idle" && a.poi)) {
      a.timer -= dt;
      if (a.timer <= 0) {
        if (a.poi) this.poiBusy.delete(a.poi.id);
        a.state = "walk";
        a.hasTarget = true;
        a.poi = null;
        const back = nodes[a.returnNode]!;
        a.tx = back[0];
        a.tz = back[1];
      }
      return;
    }
    if (a.hasTarget) {
      // Yendo a un punto de interés o volviendo al grafo.
      a.state = "walk";
      if (this.moveToward(a, a.tx, a.tz, dt)) {
        a.hasTarget = false;
        if (a.poi) {
          a.yaw = a.poi.facing;
          a.state = a.poi.kind === "bench" ? "sit" : a.poi.kind === "stall" ? "interact" : "idle";
          a.timer = a.rng.range(8, 20);
          if (a.poi.kind === "bench") {
            a.x = a.poi.position[0];
            a.z = a.poi.position[1];
          }
        }
      }
      return;
    }
    if (a.state === "wait") {
      const edge = this.nav.edges[a.edge]!;
      const inter = edge.crossing ? this.intersections.get(edge.crossing.intersectionId) : undefined;
      if (!inter || this.canCross(inter, edge.crossing!.streetAxis)) a.state = "walk";
      else return;
    }
    a.state = "walk";
    const target = nodes[a.to]!;
    const from = nodes[a.from]!;
    // Desplazamiento lateral para que no caminen todos sobre la misma línea.
    const dx = target[0] - from[0], dz = target[1] - from[1];
    const l = Math.hypot(dx, dz) || 1;
    const ox = (-dz / l) * a.offset, oz = (dx / l) * a.offset;
    if (this.moveToward(a, target[0] + ox, target[1] + oz, dt)) this.chooseNextEdge(a);
  }

  private canCross(inter: Intersection, streetAxis: "x" | "z"): boolean {
    if (!inter.hasLights) return true;
    // Se cruza cuando los autos de esa calle tienen rojo y queda tiempo.
    return lightState(inter, streetAxis, this.time) === "red" && lightRemaining(inter, streetAxis, this.time) > 5;
  }

  private chooseNextEdge(a: NpcAgent) {
    const node = a.to;
    // Punto de interés en este nodo.
    const pois = this.poisByNode.get(node);
    const poiChance = a.behavior === "poi" ? 0.6 : 0.12;
    if (pois && a.rng.chance(poiChance)) {
      const free = pois.filter((p) => !this.poiBusy.has(p.id));
      if (free.length) {
        const p = a.rng.pick(free);
        this.poiBusy.add(p.id);
        a.poi = p;
        a.returnNode = node;
        a.hasTarget = true;
        a.tx = p.position[0];
        a.tz = p.position[1];
        return;
      }
    }
    const options = (this.adjacency[node] ?? []).filter((i) => i !== a.edge);
    const choices = options.length ? options : this.adjacency[node] ?? [];
    if (!choices.length) {
      a.edge = -1;
      return;
    }
    const next = a.rng.pick(choices);
    const e = this.nav.edges[next]!;
    a.edge = next;
    a.from = node;
    a.to = e.a === node ? e.b : e.a;
    if (e.crossing) {
      const inter = this.intersections.get(e.crossing.intersectionId);
      if (inter && !this.canCross(inter, e.crossing.streetAxis)) a.state = "wait";
    }
  }

  private stepWander(a: NpcAgent, dt: number) {
    if (a.state === "idle" || a.state === "cheer") {
      a.timer -= dt;
      if (a.timer > 0) return;
      // Nuevo destino libre de obstáculos.
      for (let k = 0; k < 8; k++) {
        const ang = a.rng.range(0, Math.PI * 2);
        const r = a.rng.range(3, a.wanderRadius);
        const tx = a.homeX + Math.cos(ang) * r, tz = a.homeZ + Math.sin(ang) * r;
        if (this.blocked(tx, tz) || !this.walkable(tx, tz)) continue;
        a.tx = tx;
        a.tz = tz;
        a.state = "walk";
        return;
      }
      a.timer = 1;
      return;
    }
    const prevX = a.x, prevZ = a.z;
    const arrived = this.moveToward(a, a.tx, a.tz, dt);
    if (this.blocked(a.x, a.z)) {
      a.x = prevX;
      a.z = prevZ;
      a.state = "idle";
      a.timer = 0.3;
      return;
    }
    if (arrived) {
      a.state = "idle";
      a.timer = a.rng.range(2, 7);
    }
  }

  private stepPatrol(a: NpcAgent, dt: number) {
    a.state = "walk";
    const p = a.patrol[a.patrolIdx % a.patrol.length]!;
    if (this.moveToward(a, p[0], p[1], dt)) a.patrolIdx = (a.patrolIdx + 1) % a.patrol.length;
  }

  private blocked(x: number, z: number): boolean {
    for (const o of this.obstacles) if (Math.abs(o.cx - x) < o.hx + o.hz && Math.abs(o.cz - z) < o.hx + o.hz && pointInObb(x, z, o)) return true;
    return false;
  }

  private walkable(x: number, z: number): boolean {
    const t = this.terrain;
    if (!t) return true;
    if (Math.abs(x) > t.size / 2 - 2 || Math.abs(z) > t.size / 2 - 2) return false;
    if (t.waterEnabled && heightAt(t, x, z) < t.waterLevel + 0.3) return false;
    return true;
  }
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

export type { Entity };
