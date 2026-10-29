import { polylineLengths, samplePolyline } from "../math";
import { FOLDERS } from "../scene/doc";
import { defaultNpcAppearance, spawn, vehicleColor, VEHICLE_SPEED } from "../scene/factory";
import type { NpcBehavior, Route, Vec2, VehicleModel } from "../types";
import type { GenContext } from "./context";
import { groundY } from "./context";
import { isInsideTerrain } from "./terrain";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Simulation Manager: personajes con comportamientos y vehículos con rutas. */
export function generatePopulation(ctx: GenContext): { npcs: number; vehicles: number } {
  const { doc, layout } = ctx;
  doc.routes = layout.routes;
  doc.intersections = layout.intersections;
  doc.navigation = layout.navigation;
  const npcs = placeNpcs(ctx, ctx.plan.npcs.count);
  const vehicles = placeVehicles(ctx);

  // Punto de aparición del jugador en el modo exploración.
  const [sx, sz] = layout.spawn;
  const spawnPos: Vec2 = isInsideTerrain(doc.terrain, sx, sz, 4) ? [sx, sz] : [ctx.site.center[0], ctx.site.center[1]];
  spawn(doc, {
    id: ctx.id("s"),
    type: "spawn",
    props: {},
    transform: { position: [r2(spawnPos[0]), r2(groundY(doc.terrain, spawnPos[0], spawnPos[1])), r2(spawnPos[1])], rotation: [0, Math.PI, 0] },
    parentId: FOLDERS.cameras.id,
  });
  ctx.log(`${npcs} personajes y ${vehicles} vehículos`);
  return { npcs, vehicles };
}

export function placeNpcs(ctx: GenContext, count: number): number {
  const { doc, rng, layout, plan, site } = ctx;
  const nav = doc.navigation;
  const outfits = plan.npcs.outfits;
  let placed = 0;
  const viewpoints = nav.pois.filter((p) => p.kind === "viewpoint");
  const walkEdges = nav.edges.filter((e) => !e.crossing);
  for (let k = 0; k < count; k++) {
    let pos: Vec2;
    let behavior: NpcBehavior;
    let rotation = rng.range(0, Math.PI * 2);
    let wanderRadius = 20;
    if (layout.type === "circuit" && viewpoints.length && k < count * 0.7) {
      const vp = viewpoints[k % viewpoints.length]!;
      pos = [vp.position[0] + rng.range(-3, 3), vp.position[1] + rng.range(-1.5, 1.5)];
      behavior = "idle";
      rotation = vp.facing;
    } else if (walkEdges.length && layout.type !== "scatter") {
      const e = rng.pick(walkEdges);
      const a = nav.nodes[e.a]!, b = nav.nodes[e.b]!;
      const t = rng.next();
      pos = [a[0] + (b[0] - a[0]) * t + rng.range(-0.6, 0.6), a[1] + (b[1] - a[1]) * t + rng.range(-0.6, 0.6)];
      behavior = nav.pois.length && rng.chance(0.25) ? "poi" : "sidewalk";
      if (layout.type === "cluster" && rng.chance(0.4)) behavior = "wander";
    } else {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(2, Math.max(8, site.radius * 0.9));
      pos = [site.center[0] + Math.cos(a) * r, site.center[1] + Math.sin(a) * r];
      behavior = "wander";
      wanderRadius = Math.max(12, site.radius);
    }
    if (!isInsideTerrain(doc.terrain, pos[0], pos[1], 3)) continue;
    const outfit = layout.type === "circuit" && behavior !== "idle" ? rng.pick(["racer", "worker"] as const) : rng.pick(outfits);
    spawn(doc, {
      id: ctx.id("n"),
      type: "npc",
      props: {
        appearance: defaultNpcAppearance(outfit, rng),
        behavior,
        speed: r2(rng.range(1.05, 1.55)),
        wanderRadius,
        patrol: [],
        greets: true,
        modelAssetId: null,
      },
      transform: { position: [r2(pos[0]), r2(groundY(doc.terrain, pos[0], pos[1])), r2(pos[1])], rotation: [0, r2(rotation), 0] },
      parentId: FOLDERS.characters.id,
    });
    placed++;
  }
  return placed;
}

function routePose(route: Route, t: number): { x: number; z: number; yaw: number } {
  const lengths = polylineLengths(route.points, route.closed);
  const s = samplePolyline(route.points, route.closed, lengths, t * lengths.total);
  const rx = -s.dz, rz = s.dx; // derecha del sentido de marcha
  return { x: s.x + rx * route.lane, z: s.z + rz * route.lane, yaw: Math.atan2(s.dx, s.dz) };
}

export function placeVehicles(ctx: GenContext): number {
  const { doc, rng, plan, layout } = ctx;
  const total = plan.vehicles.count;
  if (total <= 0 || plan.vehicles.models.length === 0) return 0;
  const groundModels = plan.vehicles.models.filter((m) => m !== "ship");
  const airModels: VehicleModel[] = plan.vehicles.models.filter((m) => m === "ship" || m === "hover");
  const roadRoutes = doc.routes.filter((r) => r.kind !== "air");
  const airRoutes = doc.routes.filter((r) => r.kind === "air");
  let parked = Math.round(total * plan.vehicles.parkedRatio);
  if (roadRoutes.length === 0 && airRoutes.length === 0) parked = total;
  parked = Math.min(parked, layout.parking.length);
  const moving = total - parked;
  const flying = airRoutes.length && airModels.length ? Math.round(moving * 0.35) : 0;
  const driving = roadRoutes.length ? moving - flying : 0;
  let count = 0;

  const perRoute = new Map<string, number>();
  const assign = (routes: Route[], n: number) => {
    const out: { route: Route; index: number }[] = [];
    for (let k = 0; k < n; k++) {
      const route = routes[k % routes.length]!;
      const i = perRoute.get(route.id) ?? 0;
      perRoute.set(route.id, i + 1);
      out.push({ route, index: i });
    }
    return out;
  };
  const drivingAssign = assign(roadRoutes, driving);
  const flyingAssign = assign(airRoutes, flying);
  const routeTotals = perRoute;

  for (const { route, index } of [...drivingAssign, ...flyingAssign]) {
    const n = routeTotals.get(route.id) ?? 1;
    const t = (index + rng.range(0, 0.4)) / n;
    const model: VehicleModel = route.kind === "air" ? rng.pick(airModels) : route.kind === "race" ? "race" : rng.pick(groundModels.length ? groundModels : (["sedan"] as VehicleModel[]));
    const pose = routePose(route, t);
    const y = route.kind === "air" ? route.altitude + groundY(doc.terrain, pose.x, pose.z) : groundY(doc.terrain, pose.x, pose.z);
    spawn(doc, {
      id: ctx.id("v"),
      type: "vehicle",
      props: {
        model,
        color: vehicleColor(model, rng),
        routeId: route.id,
        routeT: Math.round(t * 1000) / 1000,
        speed: r2(Math.min(route.speedLimit, VEHICLE_SPEED[model]) * rng.range(0.85, 1.05)),
        parked: false,
      },
      transform: { position: [r2(pose.x), r2(y), r2(pose.z)], rotation: [0, r2(pose.yaw), 0] },
      parentId: FOLDERS.vehicles.id,
    });
    count++;
  }

  const spots = rng.shuffle([...layout.parking]);
  for (let k = 0; k < parked; k++) {
    const spot = spots[k]!;
    const model: VehicleModel = rng.pick(groundModels.length ? groundModels : (["sedan"] as VehicleModel[]));
    spawn(doc, {
      id: ctx.id("v"),
      type: "vehicle",
      props: { model, color: vehicleColor(model, rng), routeId: null, routeT: 0, speed: VEHICLE_SPEED[model], parked: true },
      transform: {
        position: [r2(spot.position[0]), r2(groundY(doc.terrain, spot.position[0], spot.position[1])), r2(spot.position[1])],
        rotation: [0, r2(spot.rotation + (rng.chance(0.5) ? Math.PI : 0)), 0],
      },
      parentId: FOLDERS.vehicles.id,
    });
    count++;
  }
  return count;
}

export { routePose };
