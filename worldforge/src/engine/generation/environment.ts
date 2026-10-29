import { createNoise } from "../noise";
import { FOLDERS } from "../scene/doc";
import { PROP_COLORS, spawn } from "../scene/factory";
import type { PlantSpecies, TreeSpecies } from "../types";
import type { GenContext } from "./context";
import { groundY } from "./context";
import { heightAt, isInsideTerrain, riverCenterX, slopeAt } from "./terrain";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Calles y manzanas como entidades editables. */
export function generateStreets(ctx: GenContext): number {
  const { doc, layout } = ctx;
  for (const road of layout.roads) {
    spawn(doc, {
      id: ctx.id("r"),
      type: "road",
      name: road.name.replace(/\s+/g, "_"),
      props: {
        kind: road.kind,
        points: road.points.map(([x, z]) => [r2(x), r2(z)] as [number, number]),
        closed: road.closed,
        width: road.width,
        markings: road.markings,
      },
      parentId: FOLDERS.streets.id,
    });
  }
  for (const b of layout.blocks) {
    const y = groundY(doc.terrain, b.center[0], b.center[1]);
    spawn(doc, {
      id: ctx.id("k"),
      type: "block",
      props: { size: [b.size[0], b.size[1]], sidewalk: b.sidewalk, use: b.use },
      transform: { position: [r2(b.center[0]), r2(y), r2(b.center[1])] },
      parentId: FOLDERS.streets.id,
    });
  }
  for (const o of layout.reserved) ctx.occupancy.markObb(o);
  for (const f of ctx.footprints) ctx.occupancy.markObb({ ...f, hx: f.hx + 1, hz: f.hz + 1 });
  ctx.log(`${layout.roads.length} calles y ${layout.blocks.length} manzanas`);
  return layout.roads.length + layout.blocks.length;
}

/** Environment Designer: vegetación urbana y silvestre, rocas y plantas. */
export function generateVegetation(ctx: GenContext): number {
  const { doc, plan, rng, layout, site } = ctx;
  const terrain = doc.terrain;
  const noise = createNoise(plan.seed ^ 0x5eed);
  const species = plan.vegetation.species;
  const density = plan.vegetation.density;
  let trees = 0;
  let plants = 0;
  let rocks = 0;

  const addTree = (x: number, z: number, sp: TreeSpecies, scale: number) => {
    const y = heightAt(terrain, x, z);
    spawn(doc, {
      id: ctx.id("t"),
      type: "tree",
      props: { species: sp, seed: rng.seedInt() },
      transform: { position: [r2(x), r2(y), r2(z)], rotation: [0, r2(rng.range(0, Math.PI * 2)), 0], scale: [r2(scale), r2(scale * rng.range(0.9, 1.15)), r2(scale)] },
      parentId: FOLDERS.vegetation.id,
    });
    ctx.occupancy.markRadius(x, z, sp === "giant" ? 4 : 1.5);
    trees++;
  };
  const addPlant = (x: number, z: number, sp: PlantSpecies, scale: number) => {
    spawn(doc, {
      id: ctx.id("p"),
      type: "plant",
      props: { species: sp, seed: rng.seedInt() },
      transform: { position: [r2(x), r2(heightAt(terrain, x, z)), r2(z)], rotation: [0, r2(rng.range(0, Math.PI * 2)), 0], scale: [r2(scale), r2(scale), r2(scale)] },
      parentId: FOLDERS.vegetation.id,
    });
    plants++;
  };

  // Árboles urbanos (veredas y parques).
  const urbanSpecies: TreeSpecies[] = species.filter((s) => s !== "giant" && s !== "dead" && s !== "cactus");
  for (const spot of layout.treeSpots) {
    if (density <= 0) break;
    const [x, z] = spot.position;
    if (spot.species === "street" && rng.chance(0.25)) continue;
    const sp = plan.style === "japanese" ? rng.pick(["sakura", "pine"] as const) : rng.pick(urbanSpecies.length ? urbanSpecies : species);
    addTree(x, z, sp, spot.species === "street" ? rng.range(0.7, 0.9) : rng.range(0.8, 1.2));
  }

  // Bosques silvestres con densidad modulada por ruido.
  const half = terrain.size / 2;
  const maxTrees = Math.round((species.includes("giant") ? 900 : 1500) * density * (plan.size === "large" ? 1.3 : 1));
  const attempts = maxTrees * 4;
  const wildBase = species.filter((s) => s !== "sakura" || plan.style === "japanese");
  for (let k = 0; k < attempts && trees < maxTrees + layout.treeSpots.length; k++) {
    const x = rng.range(-half + 6, half - 6);
    const z = rng.range(-half + 6, half - 6);
    const dCenter = Math.hypot(x - site.center[0], z - site.center[1]);
    if (layout.type !== "scatter" && dCenter < site.radius * 1.02) continue;
    if (!ctx.occupancy.isFree(x, z)) continue;
    const h = heightAt(terrain, x, z);
    if (terrain.waterEnabled && h < terrain.waterLevel + 0.8) continue;
    const slope = slopeAt(terrain, x, z);
    if (slope > 32) continue;
    const forest = noise.fbm(x / 90, z / 90, 3) * 0.5 + 0.5;
    if (rng.next() > forest * 1.4 * density) continue;
    let sp = rng.pick(wildBase);
    // Pinos en altura, palmeras cerca de la costa.
    if (h > 40 && species.includes("pine")) sp = "pine";
    if (terrain.biome === "tropical") sp = h < terrain.waterLevel + 4 ? "palm" : rng.chance(0.6) ? "palm" : rng.pick(wildBase);
    if (h > terrain.snowLine + 6) continue;
    addTree(x, z, sp, rng.range(0.75, 1.3));
  }

  // Árboles en la orilla del río y del lago.
  if (site.river && density > 0) {
    for (let z = -half + 10; z < half - 10; z += 7) {
      for (const side of [-1, 1]) {
        const x = riverCenterX(site, z) + side * (site.river.width * 1.2 + rng.range(0, 6));
        if (!isInsideTerrain(terrain, x, z, 6) || !ctx.occupancy.isFree(x, z) || rng.chance(0.4)) continue;
        if (heightAt(terrain, x, z) < terrain.waterLevel + 0.8) continue;
        addTree(x, z, rng.pick(wildBase), rng.range(0.8, 1.2));
      }
    }
  }

  // Plantas: arbustos, pasto, flores y hongos.
  const plantKinds = plan.vegetation.plants;
  if (plantKinds.length && density > 0) {
    const maxPlants = Math.round(1100 * density);
    for (let k = 0; k < maxPlants * 3 && plants < maxPlants; k++) {
      const x = rng.range(-half + 4, half - 4);
      const z = rng.range(-half + 4, half - 4);
      if (!ctx.occupancy.isFree(x, z)) continue;
      const h = heightAt(terrain, x, z);
      if (terrain.waterEnabled && h < terrain.waterLevel + 0.4) continue;
      if (slopeAt(terrain, x, z) > 30 || h > terrain.snowLine) continue;
      const inTown = layout.type !== "scatter" && Math.hypot(x - site.center[0], z - site.center[1]) < site.radius;
      if (inTown && rng.chance(0.85)) continue;
      addPlant(x, z, rng.pick(plantKinds), rng.range(0.7, 1.4));
    }
  }

  // Rocas en laderas y montañas.
  const rockCount = Math.round(plan.terrain.relief * 160 + (terrain.biome === "desert" || terrain.biome === "alien" ? 80 : 0));
  for (let k = 0; k < rockCount * 4 && rocks < rockCount; k++) {
    const x = rng.range(-half + 4, half - 4);
    const z = rng.range(-half + 4, half - 4);
    if (!ctx.occupancy.isFree(x, z)) continue;
    if (Math.hypot(x - site.center[0], z - site.center[1]) < site.radius) continue;
    const slope = slopeAt(terrain, x, z);
    if (slope < 8 && rng.chance(0.7)) continue;
    const s = rng.range(0.6, 2.6);
    spawn(doc, {
      id: ctx.id("o"),
      type: "rock",
      props: { variant: rng.int(0, 7) },
      transform: {
        position: [r2(x), r2(heightAt(terrain, x, z) - s * 0.25), r2(z)],
        rotation: [r2(rng.range(-0.3, 0.3)), r2(rng.range(0, Math.PI * 2)), r2(rng.range(-0.3, 0.3))],
        scale: [r2(s), r2(s * rng.range(0.6, 1)), r2(s * rng.range(0.8, 1.2))],
      },
      parentId: FOLDERS.vegetation.id,
    });
    rocks++;
  }

  ctx.log(`${trees} árboles, ${plants} plantas y ${rocks} rocas`);
  return trees + plants + rocks;
}

/** Mobiliario urbano y decoración. */
export function generateProps(ctx: GenContext): number {
  const { doc, layout, rng, site } = ctx;
  let count = 0;
  for (const p of layout.props) {
    const [x, z] = p.position;
    if (!isInsideTerrain(doc.terrain, x, z, 2)) continue;
    const y = groundY(doc.terrain, x, z) + (p.kind === "pier" ? 0 : 0);
    spawn(doc, {
      id: ctx.id("q"),
      type: "prop",
      props: {
        kind: p.kind,
        color: p.kind === "billboard" ? rng.pick(["#ff2bd6", "#00e5ff", "#7c4dff", "#00ffa3", "#ffb000"]) : p.kind === "stall" ? rng.pick(["#c0392b", "#2e86c1", "#27ae60", "#f39c12", "#8e44ad"]) : p.kind === "parasol" ? rng.pick(["#e74c3c", "#f1c40f", "#3498db", "#1abc9c"]) : PROP_COLORS[p.kind] ?? "#8a8f98",
        intersectionId: p.intersectionId ?? null,
        axis: p.axis ?? "x",
      },
      transform: { position: [r2(x), r2(p.kind === "pier" ? Math.max(y, doc.terrain.waterLevel + 0.6) : y), r2(z)], rotation: [0, r2(p.rotation), 0] },
      parentId: FOLDERS.props.id,
    });
    count++;
  }
  // Cascada.
  if (site.waterfall) {
    const [x, z] = site.waterfall.position;
    spawn(doc, {
      id: ctx.id("q"),
      type: "prop",
      name: "Waterfall",
      props: { kind: "waterfall", color: "#cfe9f5", intersectionId: null, axis: "x" },
      transform: { position: [r2(x), r2(doc.terrain.waterLevel), r2(z)], rotation: [0, r2(site.waterfall.facing), 0] },
      parentId: FOLDERS.props.id,
    });
    count++;
  }
  ctx.log(`${count} objetos de decoración`);
  return count;
}
