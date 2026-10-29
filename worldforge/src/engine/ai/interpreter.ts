import { OperationListSchema, type Operation, type Target } from "../scene/operations";
import type { MaterialPreset, WorldDoc } from "../types";
import { findColor, firstNumber, has, normalize, quantityBefore } from "./text";

/**
 * Intérprete local de instrucciones de edición (Forge 1). Convierte frases en
 * español o inglés en operaciones estructuradas validadas. No ejecuta nada:
 * el resultado pasa por la vista previa y el sistema de comandos.
 */

export interface InterpretResult {
  operations: Operation[];
  understood: string[];
  notUnderstood: string[];
}

type EditableType = Extract<Target, { kind: "type" }>["type"];

const NOUNS: [RegExp, EditableType, string | undefined][] = [
  [/\b(rascacielos|skyscrapers?)\b/, "building", "skyscraper"],
  [/\b(casas?|casitas?|houses?|homes?)\b/, "building", "house"],
  [/\b(castillos?|castles?)\b/, "building", "castle"],
  [/\b(torres?|towers?)\b/, "building", undefined],
  [/\b(edificio\w*|buildings?|construccion\w*|estructuras?)\b/, "building", undefined],
  [/\b(palmeras?|palms?)\b/, "tree", "palm"],
  [/\b(pinos?|pines?)\b/, "tree", "pine"],
  [/\b(cerezos?|sakuras?)\b/, "tree", "sakura"],
  [/\b(robles?|oaks?)\b/, "tree", "oak"],
  [/\b(cactus|cactos?)\b/, "tree", "cactus"],
  [/\b(arbol\w*|trees?)\b/, "tree", undefined],
  [/\b(arbustos?|bush\w*)\b/, "plant", "bush"],
  [/\b(flores?|flowers?)\b/, "plant", "flowers"],
  [/\b(hongos?|setas?|mushrooms?)\b/, "plant", "mushroom"],
  [/\b(cristales?|crystals?)\b/, "plant", "crystal"],
  [/\b(pasto|cesped|grass)\b/, "plant", "grass"],
  [/\b(rocas?|piedras?|rocks?|stones?)\b/, "rock", undefined],
  [/\b(farolas?|faroles?|luminarias?|street ?lights?|lamp ?posts?)\b/, "prop", "streetlight"],
  [/\b(bancos?|benches?)\b/, "prop", "bench"],
  [/\b(semaforos?|traffic lights?)\b/, "prop", "traffic_light"],
  [/\b(fuentes?|fountains?)\b/, "prop", "fountain"],
  [/\b(puestos?|stalls?)\b/, "prop", "stall"],
  [/\b(carteles?|letreros?|billboards?|signs?)\b/, "prop", "billboard"],
  [/\b(barriles?|barrels?)\b/, "prop", "barrel"],
  [/\b(cajas?|crates?)\b/, "prop", "crate"],
  [/\b(estatuas?|statues?)\b/, "prop", "statue"],
  [/\b(antorchas?|torches?)\b/, "prop", "torch"],
  [/\b(caballeros?|knights?|guardias?)\b/, "npc", "knight"],
  [/\b(personas?|personajes?|gente|peatones?|aldeanos?|habitantes?|npcs?|people|persons?|characters?|pedestrians?|villagers?|ciudadanos?)\b/, "npc", undefined],
  [/\b(taxis?)\b/, "vehicle", "taxi"],
  [/\b(colectivos?|buses?|omnibus|autobus\w*)\b/, "vehicle", "bus"],
  [/\b(camion\w*|trucks?)\b/, "vehicle", "truck"],
  [/\b(motos?|motocicletas?|motorcycles?)\b/, "vehicle", "motorcycle"],
  [/\b(naves?|spaceships?|ships?)\b/, "vehicle", "ship"],
  [/\b(autos?|coches?|carros?|vehiculos?|cars?|vehicles?)\b/, "vehicle", undefined],
  [/\b(luces|luz|lights?)\b/, "light", undefined],
  [/\b(cubos?|cajas? basicas?|cubes?|boxes?)\b/, "primitive", "box"],
  [/\b(esferas?|spheres?|balls?|pelotas?)\b/, "primitive", "sphere"],
  [/\b(cilindros?|cylinders?)\b/, "primitive", "cylinder"],
];

const MATERIALS: [RegExp, MaterialPreset][] = [
  [/\b(ladrillo\w*|bricks?)\b/, "brick"],
  [/\b(madera|wood\w*|wooden)\b/, "wood"],
  [/\b(vidrio|cristal|glass)\b/, "glass"],
  [/\b(piedra|stone)\b/, "stone"],
  [/\b(metal\w*|acero|steel|metallic)\b/, "metal"],
  [/\b(hormigon|concreto|cemento|concrete)\b/, "concrete"],
  [/\b(marmol|marble)\b/, "marble"],
  [/\b(yeso|revoque|estuco|plaster|stucco)\b/, "plaster"],
  [/\b(tejas?|tiles?)\b/, "tiles"],
  [/\b(paja|thatch)\b/, "thatch"],
  [/\b(neon)\b/, "neon"],
  [/\b(plastico|plastic)\b/, "plastic"],
];

const ADD_VERB = /\b(agreg\w*|anad\w*|pone|pon[eé]|poneme|pongan|pongas|coloc\w*|cre[aá]\w*|crea|genera\w*|gener[aá]|plant\w*|suma\w*|insert\w*|add|place|put|plant|spawn|create|generate|insert)\b/;
const DELETE_VERB = /\b(elimin\w*|borr\w*|quit\w*|sac[aá]\w*|remov\w*|delete|remove|destroy|destrui\w*)\b/;
const DUPLICATE_VERB = /\b(duplic\w*|clon\w*|copi\w*|duplicate|clone|copy)\b/;
const MOVE_VERB = /\b(mov[eé]\w*|muev\w*|desplaz\w*|traslad\w*|move|shift)\b/;
const ROTATE_VERB = /\b(rot[aá]\w*|gir[aá]\w*|rotate|turn|spin)\b/;
const RENAME_VERB = /\b(renombr\w*|rename|llamalo|llamala|cambi[aá] el nombre)\b/;
const GROUP_VERB = /\b(agrup\w*|group)\b/;
const UNGROUP_VERB = /\b(desagrup\w*|ungroup)\b/;
const THIS = /\b(este|esta|esto|estos|estas|ese|esa|seleccionad\w*|this|that|selected|these|those|lo|la)\b/;
const ALL = /\b(todos|todas|todo|all|every|cada)\b/;

export interface InterpretContext {
  doc: WorldDoc;
  selection: string[];
}

function selectionTypes(ctx: InterpretContext): Set<string> {
  return new Set(ctx.selection.map((id) => ctx.doc.entities[id]?.type).filter(Boolean) as string[]);
}

function findNoun(t: string): { type: EditableType; variant?: string; index: number } | null {
  let best: { type: EditableType; variant?: string; index: number } | null = null;
  for (const [re, type, variant] of NOUNS) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.index)) best = { type, variant, index: m.index };
  }
  return best;
}

/** Destino de una cláusula: selección, todos los de un tipo, uno por nombre o superlativo. */
function resolveClauseTarget(t: string, ctx: InterpretContext, noun: ReturnType<typeof findNoun>, previous: Target | null): Target | null {
  const name = t.match(/\b([a-z]+)[_ ](\d{1,4})\b/);
  if (name && /^(building|tree|npc|vehicle|road|rock|plant|light|camera|group|edificio|arbol|auto)$/.test(name[1]!)) {
    const map: Record<string, string> = { edificio: "building", arbol: "tree", auto: "vehicle" };
    return { kind: "name", name: `${map[name[1]!] ?? name[1]}_${name[2]!.padStart(3, "0")}` };
  }
  if (noun && has(t, /\b(mas alt[oa]|tallest|highest)\b/) && has(t, /\b(el|la|the)\b/) && !has(t, /\bhac[eé]|make\b/))
    return { kind: "type", type: noun.type, variant: noun.variant, superlative: "tallest", limit: 1 };
  if (has(t, THIS) && ctx.selection.length) return { kind: "selection" };
  if (noun) {
    if (has(t, ALL) || /\b(los|las|the)\b/.test(t) || /s\b/.test(t.slice(noun.index).split(" ")[0]!)) return { kind: "type", type: noun.type, variant: noun.variant };
    if (ctx.selection.length && selectionTypes(ctx).has(noun.type)) return { kind: "selection" };
    return { kind: "type", type: noun.type, variant: noun.variant };
  }
  if (ctx.selection.length) return { kind: "selection" };
  return previous;
}

function splitClauses(t: string): string[] {
  return t
    .split(/(?:[.;]| y luego | luego | despues | then | and then |, y |, )/)
    .flatMap((c) => c.split(/ y (?=(?:agreg|anad|pon|pone|cre|elimin|borr|quit|sac|hac|cambi|convert|mov|rot|gir|duplic|add|make|remove|delete|change|turn|set|deja|dej))/))
    .map((c) => c.trim())
    .filter(Boolean);
}

export function interpret(text: string, ctx: InterpretContext): InterpretResult {
  const all = normalize(text);
  const operations: Operation[] = [];
  const understood: string[] = [];
  const notUnderstood: string[] = [];
  let lastTarget: Target | null = null;

  for (const clause of splitClauses(all)) {
    const before = operations.length;
    interpretClause(clause, ctx, operations, lastTarget, (t) => (lastTarget = t));
    if (operations.length > before) understood.push(clause);
    else notUnderstood.push(clause);
  }

  const parsed = OperationListSchema.safeParse(operations);
  if (operations.length && !parsed.success) {
    return { operations: [], understood: [], notUnderstood: [all] };
  }
  return { operations: parsed.success ? parsed.data : [], understood, notUnderstood };
}

function interpretClause(t: string, ctx: InterpretContext, out: Operation[], previous: Target | null, setTarget: (t: Target) => void) {
  const noun = findNoun(t);
  const sel = ctx.selection;

  // --- Cámara cinematográfica ---
  if (has(t, /\b(camara|camera|cinemat\w*|sobrevuel\w*|flyover|fly over|recorrido aereo|toma aerea|drone shot)\b/) && has(t, /\b(anim\w*|sobrevuel\w*|flyover|fly|recorr\w*|orbit\w*|vuel\w*|cre\w*|hac\w*|make|create)\b/)) {
    const style = has(t, /\b(orbit\w*|alrededor|gir\w*)\b/) && !has(t, /sobrevuel|flyover/) ? "orbit" : "flyover";
    let target: Target | undefined;
    if (has(t, /\b(edificio|building|torre|tower|castillo|castle)\b/)) target = sel.length && selectionTypes(ctx).has("building") ? { kind: "selection" } : { kind: "type", type: "building", superlative: "tallest", limit: 1 };
    const dur = t.match(/(\d+)\s*(s|seg\w*|sec\w*)\b/);
    out.push({ operation: "create_camera_animation", style, target, duration: dur ? Math.min(600, Number(dur[1])) : undefined });
    return;
  }

  // --- Hora del día ---
  if (has(t, /\b(noche|nocturn\w*|night\w*|anochec\w*)\b/)) out.push({ operation: "set_environment", preset: "night" });
  else if (has(t, /\b(atardecer|ocaso|sunset|dusk|puesta de sol)\b/)) out.push({ operation: "set_environment", preset: "sunset" });
  else if (has(t, /\b(amanecer|alba|sunrise|dawn)\b/)) out.push({ operation: "set_environment", preset: "dawn" });
  else if (has(t, /\b(de dia|diurn\w*|daytime|mediodia|noon|soleado|sunny)\b/)) out.push({ operation: "set_environment", preset: "day" });
  const hour = t.match(/\b(?:a las|at)\s+(\d{1,2})(?:[:h.](\d{2}))?\b/);
  if (hour) out.push({ operation: "set_environment", timeOfDay: Math.min(24, Number(hour[1]) + Number(hour[2] ?? 0) / 60) });
  if (has(t, /\b(ciclo (de )?dia|day.?night cycle|dia y noche)\b/)) out.push({ operation: "set_environment", dayNightCycle: !has(t, /\b(desactiv\w*|apag\w*|disable|stop|sin)\b/) });

  // --- Clima ---
  const stopWeather = has(t, /\b(sac[aá]|quit[aá]|par[aá]|deten\w*|sin|stop|remove|no more|despej\w*|clear)\b/);
  if (has(t, /\b(tormentas? de arena|sand ?storm\w*)\b/)) out.push({ operation: "set_weather", type: stopWeather ? "clear" : "sandstorm" });
  else if (has(t, /\b(tormenta\w*|storm\w*|tempestad|rayos|thunder\w*)\b/)) out.push({ operation: "set_weather", type: stopWeather ? "clear" : "storm" });
  else if (has(t, /\b(lluvi\w*|llueva|llover|lloviendo|rain\w*)\b/)) out.push({ operation: "set_weather", type: stopWeather ? "clear" : "rain", wetness: stopWeather ? 0 : has(t, /charcos?|puddles?|mojad\w*|wet/) ? 1 : undefined });
  else if (has(t, /\b(niev\w*|nevad\w*|snow\w*)\b/)) out.push({ operation: "set_weather", type: stopWeather ? "clear" : "snow" });
  else if (has(t, /\b(niebla|neblina|bruma|fog\w*|mist\w*)\b/)) out.push({ operation: "set_weather", type: stopWeather ? "clear" : "fog" });
  else if (has(t, /\b(nublad\w*|nubes|cloudy|overcast)\b/)) out.push({ operation: "set_weather", type: stopWeather ? "clear" : "cloudy" });
  else if (has(t, /\b(charcos?|puddles?|mojad\w*|wet)\b/)) out.push({ operation: "set_weather", wetness: stopWeather ? 0 : 1 });
  else if (has(t, /\b(despej\w*|cielo limpio|clear sky|buen tiempo|good weather)\b/)) out.push({ operation: "set_weather", type: "clear" });
  if (has(t, /\b(viento|wind\w*)\b/) && !stopWeather) out.push({ operation: "set_weather", wind: has(t, /\b(fuerte|strong|mucho)\b/) ? 1 : 0.6 });

  // --- Simulación ---
  if (has(t, /\b(paus\w*|deten\w*|congel\w*|freeze|stop)\b/) && has(t, /\b(simulacion|trafico|traffic|simulation|personajes|npcs?)\b/)) {
    out.push({ operation: "set_simulation", npcs: has(t, /trafico|traffic/) ? undefined : false, traffic: has(t, /personajes|npcs?/) ? undefined : false });
    return;
  }
  if (has(t, /\b(reanud\w*|resume|activ\w*|arranc\w*)\b/) && has(t, /\b(simulacion|trafico|traffic|simulation)\b/)) {
    out.push({ operation: "set_simulation", npcs: true, traffic: true });
    return;
  }

  // --- Calles y autopistas ---
  if (has(t, /\b(autopista|highway|ruta|carretera|avenida|camino|calle|road|street|sendero|path)\b/) && has(t, ADD_VERB) && !has(t, DELETE_VERB)) {
    const kind = has(t, /autopista|highway|ruta|carretera/) ? "highway" : has(t, /sendero|path/) ? "path" : has(t, /camino de tierra|dirt/) ? "dirt" : "street";
    const anchor = has(t, /\b(montan\w*|mountain\w*|cerro|pico|peak)\b/) ? "mountain" : has(t, /\b(lago|lake|agua|water|rio|river)\b/) ? "water" : has(t, THIS) && sel.length ? "selection" : "center";
    out.push({ operation: "add_road", kind, mode: "ring_around", anchor: anchor === "water" ? "center" : anchor });
    return;
  }

  // --- Comportamiento de personajes ---
  if (noun?.type === "npc" && has(t, /\b(camin\w*|anden|paseen|walk\w*|deambul\w*|wander\w*|quiet\w*|parad\w*|idle|sient\w*|sit|patrull\w*|corr\w*|run\w*)\b/) && !has(t, ADD_VERB)) {
    const target = resolveClauseTarget(t, ctx, noun, previous) ?? { kind: "type", type: "npc" };
    let behavior: "sidewalk" | "wander" | "idle" | "poi" | "patrol" = "wander";
    if (has(t, /\b(veredas?|aceras?|calles?|sidewalks?|streets?)\b/)) behavior = "sidewalk";
    else if (has(t, /\b(quiet\w*|parad\w*|idle|no se muevan|stand)\b/)) behavior = "idle";
    else if (has(t, /\b(sient\w*|sit|bancos?|benches?|puestos?|mercado)\b/)) behavior = "poi";
    const speed = has(t, /\b(corr\w*|run\w*|rapido|fast)\b/) ? 3.5 : has(t, /\b(lento|despacio|slow\w*)\b/) ? 0.8 : undefined;
    out.push({ operation: "set_npc_behavior", target, behavior, speed });
    setTarget(target);
    return;
  }

  // --- Agregar objetos ---
  if (has(t, ADD_VERB) && noun && !has(t, /\b(material|color)\b/)) {
    const q = quantityBefore(t, noun.index) ?? (/s\b/.test(t.slice(noun.index).split(" ")[0]!) ? 8 : 1);
    const count = Math.max(1, Math.min(500, q));
    let placement: Extract<Operation, { operation: "add_objects" }>["placement"] = { mode: "random" };
    if (has(t, /\b(lago|laguna|lake|rio|river|agua|water|orilla|shore|costa)\b/)) placement = { mode: "around", anchor: "water" };
    else if (has(t, /\b(alrededor|around|rodeando|surrounding)\b/)) placement = { mode: "around", anchor: sel.length && (has(t, THIS) || !has(t, /centro|center|ciudad|city/)) ? "selection" : "center" };
    else if (has(t, /\b(cerca|junto|al lado|near|next to|beside)\b/)) placement = { mode: "near", anchor: sel.length ? "selection" : "center" };
    else if (has(t, /\b(centro|center|plaza)\b/)) placement = { mode: "near", anchor: "center", radius: 30 };
    else if (has(t, /\b(montan\w*|mountain\w*)\b/)) placement = { mode: "near", anchor: "mountain" };
    else if (sel.length) placement = { mode: "near", anchor: "selection" };
    const objectType = noun.type === "block" || noun.type === "road" || noun.type === "camera" || noun.type === "model" || noun.type === "group" ? null : noun.type;
    if (objectType) {
      out.push({ operation: "add_objects", objectType, variant: noun.variant, count, placement });
      return;
    }
  }

  // --- Eliminar / duplicar / renombrar / agrupar ---
  if (has(t, DELETE_VERB) && !has(t, /\b(lluvi|niev|niebla|tormenta|rain|snow|fog|storm|charcos)\w*/)) {
    const target = resolveClauseTarget(t, ctx, noun, previous);
    if (target) {
      out.push({ operation: "delete_objects", target });
      return;
    }
  }
  if (has(t, DUPLICATE_VERB)) {
    const target = resolveClauseTarget(t, ctx, noun, previous);
    if (target) {
      const n = firstNumber(t);
      out.push({ operation: "duplicate_objects", target, offset: n && n > 0 && n < 200 ? [n, 0, 0] : undefined });
      setTarget(target);
      return;
    }
  }
  if (has(t, RENAME_VERB)) {
    const m = t.match(/\b(?:como|a|to|as)\s+["']?([a-z0-9_ -]{1,40})["']?$/);
    const target = resolveClauseTarget(t, ctx, noun, previous);
    if (m && target) {
      out.push({ operation: "rename_object", target, name: m[1]!.trim() });
      return;
    }
  }
  if (has(t, UNGROUP_VERB)) return; // lo maneja el editor (necesita la jerarquía)
  if (has(t, GROUP_VERB)) {
    const target = resolveClauseTarget(t, ctx, noun, previous);
    if (target) {
      out.push({ operation: "group_objects", target });
      return;
    }
  }

  const target = resolveClauseTarget(t, ctx, noun, previous);
  const isBuilding = target ? targetIsBuilding(target, ctx, noun) : false;

  // --- Altura y tamaño ---
  const taller = has(t, /\b(mas alt[oa]s?|taller|higher|alt[ií]sim\w*|crec\w*|elev\w*|subi\w* de altura|aument\w* (la )?altura)\b/);
  const shorter = has(t, /\b(mas baj[oa]s?|shorter|lower|achat\w*|reduc\w* (la )?altura|baj[aá]\w* (la )?altura)\b/);
  const factorMatch = t.match(/\b(doble|el doble|twice|x2|duplic\w*|triple|x3|la mitad|half)\b/);
  const factor = factorMatch ? (/(triple|x3)/.test(factorMatch[0]) ? 3 : /(mitad|half)/.test(factorMatch[0]) ? 0.5 : 2) : null;
  const floorsMatch = t.match(/(\d+)\s*(pisos|plantas|floors|stories|storeys)/);
  if (target && (taller || shorter || floorsMatch || (factor && has(t, /\b(alt[oa]|tall|height|altura)\b/)))) {
    if (isBuilding) {
      if (floorsMatch) out.push({ operation: "modify_building", target, changes: { floors: Math.min(150, Number(floorsMatch[1])) } });
      else out.push({ operation: "modify_building", target, changes: { floorsBy: factor ?? (shorter ? 0.65 : 1.5) } });
    } else out.push({ operation: "modify_object", target, changes: { scaleBy: [1, factor ?? (shorter ? 0.7 : 1.5), 1] } });
    setTarget(target);
  }
  const bigger = has(t, /\b(mas grande|grandes|bigger|larger|agrand\w*|enorme|huge)\b/) && !taller;
  const smaller = has(t, /\b(mas (chic|pequen)\w*|smaller|achic\w*|reduc\w*|diminut\w*|tiny)\b/) && !shorter;
  if (target && (bigger || smaller) && !has(t, ADD_VERB)) {
    const f = factor ?? (smaller ? 0.7 : 1.4);
    if (isBuilding) out.push({ operation: "modify_building", target, changes: { sizeBy: f } });
    else out.push({ operation: "modify_object", target, changes: { scaleBy: [f, f, f] } });
    setTarget(target);
  }

  // --- Techo ---
  if (target && isBuilding && has(t, /\b(techo|tejado|roof)\b/)) {
    const roof = has(t, /dos aguas|gable|triangular/) ? "gable" : has(t, /cuatro aguas|hip/) ? "hip" : has(t, /plano|flat/) ? "flat" : has(t, /cupula|dome/) ? "dome" : has(t, /aguja|spire|punta/) ? "spire" : has(t, /paja|thatch/) ? "thatch" : has(t, /pagoda|japones/) ? "pagoda" : has(t, /almen\w*|crenel\w*/) ? "crenellated" : null;
    const color = findColor(t);
    if (roof) out.push({ operation: "modify_building", target, changes: { roof } });
    if (color) out.push({ operation: "set_material", target, part: "roof", color });
    if (roof || color) {
      setTarget(target);
      return;
    }
  }

  // --- Neón ---
  if (target && isBuilding && has(t, /\b(neon|luces de colores|luminos\w*|glow\w*)\b/) && !has(t, /\b(material)\b/)) {
    out.push({ operation: "modify_building", target, changes: { neon: !has(t, /\b(sin|quit\w*|sac\w*|remove|no)\b/) } });
    setTarget(target);
  }

  // --- Material y color ---
  const mat = MATERIALS.find(([re]) => re.test(t));
  const color = findColor(t);
  const wantsMaterial = has(t, /\b(material|hech[oa] de|made of|revest\w*|convert\w*|cambi\w*|pint\w*|paint\w*|color|de )\b/) || !!mat;
  if (target && wantsMaterial && (mat || color) && !out.some((o) => o.operation === "set_material")) {
    if (mat && !(mat[1] === "neon" && isBuilding)) out.push({ operation: "set_material", target, part: "walls", preset: mat[1], color: color ?? undefined });
    else if (color) out.push({ operation: "set_material", target, part: has(t, /\b(techo|roof)\b/) ? "roof" : "walls", color });
    setTarget(target);
  }

  // --- Mover y rotar ---
  if (target && has(t, MOVE_VERB)) {
    const n = firstNumber(t) ?? 5;
    const d = Math.min(500, Math.abs(n));
    const dir: [number, number, number] = has(t, /\b(arriba|up|subi\w*)\b/) ? [0, d, 0] : has(t, /\b(abajo|down|baj\w*)\b/) ? [0, -d, 0] : has(t, /\b(izquierda|left|oeste|west)\b/) ? [-d, 0, 0] : has(t, /\b(derecha|right|este|east)\b/) ? [d, 0, 0] : has(t, /\b(adelante|forward|norte|north|atras|back|sur|south)\b/) ? [0, 0, has(t, /\b(adelante|forward|sur|south)\b/) ? d : -d] : [d, 0, 0];
    out.push({ operation: "modify_object", target, changes: { translate: dir } });
    setTarget(target);
  }
  if (target && has(t, ROTATE_VERB) && !has(t, /\b(camara|camera)\b/)) {
    const n = firstNumber(t) ?? 45;
    out.push({ operation: "modify_object", target, changes: { rotateByDeg: [0, Math.max(-360, Math.min(360, n)) * (has(t, /\b(izquierda|left|antihorari\w*)\b/) ? -1 : 1), 0] } });
    setTarget(target);
  }

  // --- Ocultar / mostrar / bloquear ---
  if (target && has(t, /\b(ocult\w*|esconde\w*|hide)\b/)) out.push({ operation: "modify_object", target, changes: { visible: false } });
  if (target && has(t, /\b(mostr\w*|muestr\w*|show|unhide|visible)\b/)) out.push({ operation: "modify_object", target, changes: { visible: true } });
  if (target && has(t, /\b(bloque\w*|lock)\b/)) out.push({ operation: "modify_object", target, changes: { locked: !has(t, /\b(desbloque\w*|unlock)\b/) } });

  // --- Vehículos: velocidad ---
  if (noun?.type === "vehicle" && has(t, /\b(rapid\w*|velocidad|faster|speed|lent\w*|slower|despacio)\b/)) {
    const tg = target ?? { kind: "type", type: "vehicle" };
    out.push({ operation: "modify_vehicle", target: tg, changes: { speedBy: has(t, /\b(lent\w*|slower|despacio)\b/) ? 0.6 : 1.5 } });
  }

  // --- Terreno ---
  if (has(t, /\b(terreno|terrain|suelo|ground)\b/)) {
    const biome = has(t, /nevad|nieve|snow|invierno/) ? "snow" : has(t, /desiert|desert|arena/) ? "desert" : has(t, /tropical/) ? "tropical" : has(t, /fantas|magic/) ? "fantasy" : has(t, /marte|mars|alien/) ? "alien" : has(t, /verde|green|templad|pasto/) ? "temperate" : null;
    if (biome) out.push({ operation: "modify_terrain", action: "set_biome", biome });
    else if (has(t, /\b(aplan\w*|flatten|plano)\b/)) out.push({ operation: "modify_terrain", action: "flatten", radius: 40 });
    else if (has(t, /\b(suaviz\w*|smooth)\b/)) out.push({ operation: "modify_terrain", action: "smooth", radius: 60 });
  }
  if (has(t, /\b(lago|lake|laguna|estanque|pond)\b/) && has(t, ADD_VERB)) {
    out.push({ operation: "modify_terrain", action: "water", radius: firstNumber(t) && firstNumber(t)! < 200 ? firstNumber(t)! : 22 });
  }
  if (has(t, /\b(colina|monta\w*|hill|mountain|cerro)\b/) && has(t, ADD_VERB) && !noun) {
    out.push({ operation: "modify_terrain", action: "raise", radius: 35, strength: has(t, /monta|mountain/) ? 30 : 10 });
  }
}

function targetIsBuilding(target: Target, ctx: InterpretContext, noun: ReturnType<typeof findNoun>): boolean {
  if (target.kind === "type") return target.type === "building";
  if (target.kind === "selection") return ctx.selection.length > 0 && ctx.selection.every((id) => ctx.doc.entities[id]?.type === "building");
  if (target.kind === "name") return /^building/i.test(target.name) || noun?.type === "building";
  return noun?.type === "building";
}
