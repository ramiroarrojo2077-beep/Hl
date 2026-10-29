import { FOLDERS } from "../scene/doc";
import { defaultBuilding, spawn } from "../scene/factory";
import type { BuildingKind, BuildingProps, BuildingStyle } from "../types";
import type { GenContext } from "./context";
import { footprintBaseY, isBuildable } from "./context";
import type { LotDef, SpecialSite } from "./layout";
import { flattenObb } from "./terrain";

/** Architecture Generator: un edificio paramétrico por lote y los hitos especiales. */
export function generateArchitecture(ctx: GenContext): number {
  const { plan, layout, rng, doc } = ctx;
  const style = plan.style;
  const special = new Set<BuildingKind>(["hospital", "school", "factory", "station", "mall"]);
  const pending = plan.buildings.kinds.filter((k) => special.has(k));
  let count = 0;

  // Lotes ordenados de mayor a menor para ubicar primero los edificios especiales.
  const lots = [...layout.lots].sort((a, b) => b.width * b.depth - a.width * a.depth);
  const organic = layout.type !== "grid";
  for (const lot of lots) {
    if (!isBuildable(doc.terrain, lot.center[0], lot.center[1], organic ? 22 : 40)) continue;
    let props: BuildingProps;
    const specialKind = lot.zone !== "core" && pending.length > 0 && lot.width >= 16 ? pending.shift()! : null;
    if (specialKind) props = defaultBuilding(specialKind, style, rng);
    else props = buildingForLot(lot, ctx);
    fitToLot(props, lot);
    if (organic) {
      // Aplanar el terreno bajo la casa para que no quede colgando en pendientes.
      const target = footprintBaseY(doc.terrain, lot.center, props.width, props.depth, lot.rotation) + 0.3;
      flattenObb(doc.terrain, doc.terrain.heights, lot.center[0], lot.center[1], props.width / 2 + 1, props.depth / 2 + 1, lot.rotation, target, 4);
    }
    const y = footprintBaseY(doc.terrain, lot.center, props.width, props.depth, lot.rotation);
    spawn(doc, {
      id: ctx.id("b"),
      type: "building",
      props,
      transform: { position: [round(lot.center[0]), round(y), round(lot.center[1])], rotation: [0, round(lot.rotation), 0] },
      parentId: FOLDERS.buildings.id,
    });
    ctx.footprints.push({ cx: lot.center[0], cz: lot.center[1], hx: props.width / 2, hz: props.depth / 2, rot: lot.rotation });
    count++;
  }

  for (const s of layout.specials) count += placeSpecial(ctx, s);
  ctx.log(`${count} edificios generados`);
  return count;
}

function placeSpecial(ctx: GenContext, s: SpecialSite): number {
  const { doc, rng, plan } = ctx;
  const style: BuildingStyle = plan.style;
  let kind: BuildingKind | null = null;
  let name: string | undefined;
  switch (s.kind) {
    case "castle":
      kind = "castle";
      name = "Castle";
      break;
    case "grandstand":
      kind = "grandstand";
      break;
    case "pit":
      kind = "pit";
      name = "PitBuilding";
      break;
    case "temple":
      kind = "temple";
      name = "Temple";
      break;
    case "stadium":
      kind = "stadium";
      name = "Stadium";
      break;
    case "tower":
      kind = "tower";
      name = "ControlTower";
      break;
    default:
      return 0;
  }
  const props = defaultBuilding(kind, style, rng);
  props.width = s.size[0];
  props.depth = s.size[1];
  if (kind === "tower" && style === "scifi") props.floors = 7;
  const y = footprintBaseY(doc.terrain, s.center, props.width, props.depth, s.rotation);
  spawn(doc, {
    id: ctx.id("b"),
    type: "building",
    name,
    props,
    transform: { position: [round(s.center[0]), round(y), round(s.center[1])], rotation: [0, round(s.rotation), 0] },
    parentId: FOLDERS.buildings.id,
  });
  ctx.footprints.push({ cx: s.center[0], cz: s.center[1], hx: props.width / 2, hz: props.depth / 2, rot: s.rotation });
  return 1;
}

function buildingForLot(lot: LotDef, ctx: GenContext): BuildingProps {
  const { plan, rng } = ctx;
  const style = plan.style;
  const kinds = plan.buildings.kinds;
  const pickKind = (options: [BuildingKind, number][]): BuildingKind => {
    const allowed = options.filter(([k]) => kinds.includes(k));
    return rng.weighted(allowed.length ? allowed : options);
  };
  let kind: BuildingKind;
  switch (plan.archetype) {
    case "city":
      kind =
        lot.zone === "core"
          ? pickKind([["skyscraper", 3], ["office", 2], ["apartment", 1]])
          : lot.zone === "mid"
            ? pickKind([["apartment", 3], ["office", 2], ["shop", 2]])
            : pickKind([["house", 3], ["apartment", 2], ["shop", 1]]);
      break;
    case "futuristic":
      kind =
        lot.zone === "core"
          ? pickKind([["futuristic", 3], ["skyscraper", 2]])
          : lot.zone === "mid"
            ? pickKind([["futuristic", 2], ["office", 2], ["skyscraper", 1]])
            : pickKind([["apartment", 2], ["shop", 2], ["office", 1]]);
      break;
    case "town":
      kind =
        lot.zone === "core"
          ? pickKind([["shop", 3], ["apartment", 2]])
          : lot.zone === "mid"
            ? pickKind([["apartment", 2], ["house", 2], ["shop", 1]])
            : pickKind([["house", 5], ["apartment", 1]]);
      break;
    case "medieval":
    case "village":
      kind = lot.zone === "core" ? pickKind([["shop", 2], ["house", 3]]) : rng.chance(0.06) && kinds.includes("tower") ? "tower" : "house";
      break;
    case "island":
      kind = pickKind([["hut", 4], ["house", 1]]);
      break;
    case "desert_base":
      kind = pickKind([["dome", 3], ["lab", 3], ["factory", 1]]);
      break;
    default:
      kind = kinds.includes("hut") ? "hut" : "house";
  }
  const props = defaultBuilding(kind, style, rng);
  // Altura según la centralidad: más alto cerca del centro.
  const centralBoost = Math.pow(1 - Math.min(1, lot.centrality), 1.6);
  if (kind === "skyscraper" || kind === "futuristic") {
    const max = Math.max(12, plan.buildings.maxFloors);
    props.floors = clampInt(Math.round(max * (0.45 + 0.55 * centralBoost) * rng.range(0.7, 1.05)), 10, 150);
  } else if (kind === "office" || kind === "apartment") {
    const cap = Math.max(3, Math.min(plan.buildings.maxFloors, kind === "office" ? 18 : 12));
    props.floors = clampInt(Math.round(cap * (0.35 + 0.65 * centralBoost) * rng.range(0.7, 1.1)), 2, cap);
  } else if (kind === "house" || kind === "shop") {
    props.floors = Math.min(props.floors + (style === "medieval" && lot.zone === "core" ? 1 : 0), Math.max(1, plan.buildings.maxFloors));
  }
  if (style === "japanese" && (kind === "apartment" || kind === "shop")) props.neon = rng.chance(0.6);
  if (style === "medieval" && kind === "house") {
    props.roof = "gable";
    props.roofColor = rng.pick(["#8b3e2f", "#7a4a2c", "#4b4f58", "#a0522d", "#b49a5a"]);
    if (props.roofColor === "#b49a5a") props.roof = "thatch";
  }
  return props;
}

function fitToLot(props: BuildingProps, lot: LotDef) {
  const margin = props.kind === "skyscraper" || props.kind === "futuristic" ? 4 : 1.5;
  const maxW = Math.max(4, lot.width - margin);
  const maxD = Math.max(4, lot.depth - margin);
  props.width = round(Math.min(maxW, Math.max(4, props.width > maxW ? maxW : Math.max(props.width, maxW * 0.75))));
  props.depth = round(Math.min(maxD, Math.max(4, props.depth > maxD ? maxD : Math.max(props.depth, maxD * 0.7))));
  if (props.kind === "house" || props.kind === "hut") {
    props.width = round(Math.min(props.width, 12));
    props.depth = round(Math.min(props.depth, 11));
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
const clampInt = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)));
