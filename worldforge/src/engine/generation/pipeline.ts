import { createIdFactory } from "../ids";
import { Rng } from "../rng";
import { createEmptyDoc, FOLDERS } from "../scene/doc";
import { spawn } from "../scene/factory";
import type { WorldDoc } from "../types";
import { generateArchitecture } from "./architecture";
import { Occupancy, groundY, type GenContext } from "./context";
import { directAnimation, directLighting } from "./director";
import { generateProps, generateStreets, generateVegetation } from "./environment";
import { generateLayout } from "./layout";
import type { WorldPlan } from "./plan";
import { placeNpcs } from "./population";
import { generatePopulation } from "./population";
import { computeSite, generateTerrain, isInsideTerrain } from "./terrain";
import { checkFeatures, validateAndRepair, type FeatureCheck, type ValidationReport } from "./validator";

/**
 * Pipeline de generación por etapas (agentes especializados). Cada etapa hace
 * trabajo real y reporta su avance; entre etapas se cede el hilo para que la
 * interfaz se actualice.
 */

export const STAGES = [
  { id: "planner", label: "World Planner: interpretando la descripción" },
  { id: "terrain", label: "Terrain Generator: modelando el terreno" },
  { id: "layout", label: "Planificando calles y lotes" },
  { id: "architecture", label: "Architecture Generator: construyendo edificios" },
  { id: "streets", label: "Trazando calles y veredas" },
  { id: "environment", label: "Environment Designer: vegetación y decoración" },
  { id: "simulation", label: "Simulation Manager: personajes y tránsito" },
  { id: "lighting", label: "Lighting Director: iluminación y clima" },
  { id: "animation", label: "Animation Director: cámara cinematográfica" },
  { id: "validator", label: "Scene Validator: revisando y reparando" },
  { id: "critic", label: "Crítico: verificando que esté todo lo pedido" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export interface StageEvent {
  stage: StageId;
  index: number;
  total: number;
  status: "running" | "done";
  ms?: number;
  detail?: string;
}

export interface GenerationResult {
  doc: WorldDoc;
  plan: WorldPlan;
  report: ValidationReport;
  features: FeatureCheck[];
  log: string[];
  timings: Record<string, number>;
}

export interface GenerateOptions {
  prompt: string;
  onStage?: (e: StageEvent) => void;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export class GenerationAborted extends Error {
  constructor() {
    super("Generación cancelada");
  }
}

export async function generateWorld(plan: WorldPlan, opts: GenerateOptions): Promise<GenerationResult> {
  const log: string[] = [];
  const timings: Record<string, number> = {};
  const emitLog = (m: string) => {
    log.push(m);
    opts.onLog?.(m);
  };
  const rng = new Rng(plan.seed);
  const doc = createEmptyDoc(plan.name);
  doc.prompt = opts.prompt.slice(0, 2000);
  doc.seed = plan.seed;
  const ctx: GenContext = {
    plan,
    doc,
    rng,
    site: computeSite(plan, rng.fork(1)),
    layout: null as never,
    id: createIdFactory(plan.seed),
    log: emitLog,
    occupancy: null as never,
    footprints: [],
  };

  let index = 0;
  const run = async <T>(stage: StageId, fn: () => T): Promise<T> => {
    if (opts.signal?.aborted) throw new GenerationAborted();
    opts.onStage?.({ stage, index, total: STAGES.length, status: "running" });
    await yieldToUi();
    const t0 = performance.now();
    const out = fn();
    const ms = Math.round(performance.now() - t0);
    timings[stage] = ms;
    opts.onStage?.({ stage, index, total: STAGES.length, status: "done", ms });
    index++;
    return out;
  };

  await run("planner", () => emitLog(`Plan: ${plan.archetype}, estilo ${plan.style}, tamaño ${plan.size}`));
  await run("terrain", () => {
    doc.terrain = generateTerrain(plan, ctx.site, plan.seed);
    ctx.occupancy = new Occupancy(doc.terrain.size);
    emitLog(`Terreno ${doc.terrain.size} m, ${doc.terrain.resolution}² celdas, bioma ${doc.terrain.biome}`);
  });
  await run("layout", () => {
    ctx.layout = generateLayout(plan, ctx.site, rng.fork(2));
    emitLog(`Trazado ${ctx.layout.type}: ${ctx.layout.lots.length} lotes`);
  });
  await run("architecture", () => generateArchitecture({ ...ctx, rng: rng.fork(3) }));
  await run("streets", () => generateStreets(ctx));
  await run("environment", () => {
    generateVegetation({ ...ctx, rng: rng.fork(4) });
    generateProps({ ...ctx, rng: rng.fork(5) });
  });
  await run("simulation", () => generatePopulation({ ...ctx, rng: rng.fork(6) }));
  await run("lighting", () => directLighting(ctx));
  await run("animation", () => directAnimation(ctx));
  const report = await run("validator", () => {
    const r = validateAndRepair(doc);
    emitLog(`Validación: ${r.issues.length} observaciones, ${r.repairs} reparaciones`);
    return r;
  });
  const features = await run("critic", () => critique(ctx));
  return { doc, plan, report, features, log, timings };
}

/** Revisa los elementos pedidos y agrega lo que falte cuando se puede. */
function critique(ctx: GenContext): FeatureCheck[] {
  const { doc, plan } = ctx;
  let checks = checkFeatures(doc, plan.features);
  const missing = checks.filter((c) => !c.ok).map((c) => c.feature);
  if (missing.length === 0) {
    ctx.log("Crítico: el mundo contiene todo lo pedido");
    return checks;
  }
  const rng = ctx.rng.fork(99);
  for (const f of missing) {
    switch (f) {
      case "people":
        placeNpcs({ ...ctx, rng, plan: { ...plan, npcs: { ...plan.npcs, count: 12 } } }, 12);
        break;
      case "trees":
      case "forest": {
        const target = f === "forest" ? 200 : 20;
        const half = doc.terrain.size / 2;
        let added = 0;
        for (let k = 0; k < target * 6 && added < target; k++) {
          const x = rng.range(-half + 8, half - 8);
          const z = rng.range(-half + 8, half - 8);
          if (!ctx.occupancy.isFree(x, z) || !isInsideTerrain(doc.terrain, x, z, 6)) continue;
          if (doc.terrain.waterEnabled && groundY(doc.terrain, x, z) < doc.terrain.waterLevel + 0.8) continue;
          spawn(doc, {
            id: ctx.id("t"),
            type: "tree",
            props: { species: rng.pick(plan.vegetation.species), seed: rng.seedInt() },
            transform: { position: [x, groundY(doc.terrain, x, z), z], rotation: [0, rng.range(0, 6.28), 0] },
            parentId: FOLDERS.vegetation.id,
          });
          ctx.occupancy.markRadius(x, z, 1.5);
          added++;
        }
        break;
      }
      default:
        break;
    }
  }
  checks = checkFeatures(doc, plan.features);
  const still = checks.filter((c) => !c.ok);
  ctx.log(
    still.length
      ? `Crítico: faltan ${still.map((c) => c.feature).join(", ")} (${still.map((c) => c.detail).join("; ")})`
      : "Crítico: se completaron los elementos que faltaban",
  );
  return checks;
}
