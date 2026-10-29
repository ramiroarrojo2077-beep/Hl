import { findColor, has, normalize, quantityBefore } from "../ai/text";
import { hashString } from "../rng";
import type { BuildingKind, NpcOutfit, PlantSpecies, TreeSpecies, VehicleModel, WeatherType } from "../types";
import { WorldPlanSchema, type Archetype, type Feature, type WorldPlan } from "./plan";

/**
 * World Planner local (Forge 1): interpreta una descripción en español o inglés
 * y produce un WorldPlan. Es determinista: el mismo texto da el mismo plan.
 */

const FEATURE_PATTERNS: [Feature, RegExp][] = [
  ["mountains", /\b(montan\w*|sierra\w*|cordiller\w*|mountain\w*|picos?|peaks?|cerros?)\b/],
  ["hills", /\b(colina\w*|lomas?|hills?|ondulad\w*)\b/],
  ["river", /\b(rios?|arroyos?|rivers?|streams?)\b/],
  ["lake", /\b(lagos?|lagunas?|lakes?|estanques?|ponds?)\b/],
  ["waterfall", /\b(cascadas?|waterfalls?|cataratas?)\b/],
  ["beach", /\b(playas?|beach\w*|costa|shore)\b/],
  ["ocean", /\b(mar|oceano|ocean|sea)\b/],
  ["buildings", /\b(edificio\w*|building\w*|construccion\w*|estructuras?)\b/],
  ["skyscrapers", /\b(rascacielos|skyscrapers?|torres altas|tall towers?)\b/],
  ["houses", /\b(casas?|casitas?|houses?|homes?|viviendas?)\b/],
  ["castle", /\b(castillos?|castles?|fortaleza\w*|fortress\w*|ciudadela)\b/],
  ["market", /\b(mercado\w*|market\w*|feria\w*|bazar\w*|puestos?)\b/],
  ["park", /\b(parques?|parks?|plazas?|jardin\w*|gardens?)\b/],
  ["streets", /\b(calles?|streets?|carreteras?|roads?|avenidas?|caminos?|veredas?)\b/],
  ["trees", /\b(arbol\w*|trees?|arboleda\w*)\b/],
  ["forest", /\b(bosques?|forests?|selvas?|jungles?|woods?)\b/],
  ["palms", /\b(palmeras?|palms?)\b/],
  ["people", /\b(personas?|gente|peatones?|aldeanos?|habitantes?|people|pedestrians?|villagers?|npcs?|ciudadanos?|personajes?|espectadores?|cientificos?)\b/],
  ["creatures", /\b(criaturas?|creatures?|animales?|animals?|bestias?|monstruos?)\b/],
  ["vehicles", /\b(autos?|coches?|carros?|vehiculos?|cars?|vehicles?|trafico|traffic|camiones?|trucks?|colectivos?|buses?|motos?)\b/],
  ["flying_vehicles", /\b(naves?|voladores?|flying|spaceships?|ships?|drones?|aeronaves?)\b/],
  ["traffic_lights", /\b(semaforos?|traffic lights?)\b/],
  ["streetlights", /\b(farolas?|faroles?|luminarias?|street ?lights?|lamp ?posts?|alumbrado)\b/],
  ["grandstands", /\b(tribunas?|gradas?|grandstands?|stands?)\b/],
  ["pits", /\b(boxes|pits?|pit lane|garajes?)\b/],
  ["huts", /\b(cabanas?|chozas?|huts?|cabins?|bungalows?)\b/],
  ["bases", /\b(bases?|estaciones? cientificas?|laboratorios?|labs?|domos?|domes?|colonia\w*|outposts?)\b/],
  ["neon", /\b(neon\w*|carteles? luminosos?|letreros? luminosos?|luminos\w*|hologram\w*|cyberpunk)\b/],
  ["rain", /\b(lluvi\w*|llueve|lloviendo|rain\w*)\b/],
  ["snow", /\b(niev\w*|nevad\w*|snow\w*|invierno|winter|helad\w*)\b/],
  ["fog", /\b(niebla|neblina|bruma|fog\w*|mist\w*)\b/],
  ["storm", /\b(tormenta\w*|storm\w*|tempestad|rayos|thunder\w*)\b/],
  ["sandstorm", /\b(tormentas? de arena|sand ?storms?)\b/],
  ["night", /\b(noche|nocturn\w*|night\w*|de madrugada|midnight)\b/],
  ["sunset", /\b(atardecer|ocaso|puesta de sol|sunset|dusk|crepusculo)\b/],
  ["dawn", /\b(amanecer|alba|sunrise|dawn)\b/],
  ["wet", /\b(mojad\w*|charcos?|wet|puddles?|humed\w*)\b/],
];

export function detectFeatures(normalized: string): Feature[] {
  const out: Feature[] = [];
  for (const [f, re] of FEATURE_PATTERNS) if (re.test(normalized)) out.push(f);
  // "tormenta de arena" no es una tormenta eléctrica.
  if (out.includes("sandstorm")) {
    const withoutSand = normalized.replace(/tormentas? de arena|sand ?storms?/g, "");
    if (!/\b(tormenta\w*|storm\w*|tempestad)\b/.test(withoutSand)) out.splice(out.indexOf("storm"), 1);
  }
  return out;
}

function detectArchetype(t: string, f: Set<Feature>): Archetype {
  if (has(t, /\b(circuito|autodromo|carreras?|race\w*|racing|track|pista de carreras|formula)\b/)) return "racetrack";
  if (has(t, /\b(planeta|planet|marte|mars|alien\w*|extraterrestre|lunar|luna)\b/) || (f.has("bases") && has(t, /\b(desiert\w*|desert)\b/)))
    return "desert_base";
  if (has(t, /\b(isla|islas|island\w*|atolon|archipielago)\b/)) return "island";
  if (has(t, /\b(medieval\w*|castillo\w*|castle\w*|feudal|reino|kingdom|caballeros?|knights?)\b/)) return "medieval";
  if (has(t, /\b(futurist\w*|future|futuro|cyberpunk|sci-?fi|neon|cibernetic\w*|high-?tech)\b/)) return "futuristic";
  if (has(t, /\b(ciudad|city|metropoli\w*|urbe|downtown|centro urbano)\b/)) {
    if (has(t, /\b(pequen\w*|chic\w*|small|little)\b/)) return "town";
    return "city";
  }
  if (has(t, /\b(pueblo|pueblito|town|villa)\b/)) return "town";
  if (has(t, /\b(aldea|village|caserio|hamlet)\b/)) return "village";
  if (f.has("bases")) return "desert_base";
  if (f.has("forest") || has(t, /\b(fantastic\w*|fantasy|magic\w*|encantad\w*|enchanted)\b/)) return "forest";
  if (f.has("buildings") || f.has("houses") || f.has("streets")) return "town";
  if (f.has("mountains") || f.has("lake") || f.has("river") || f.has("hills")) return "wilderness";
  return "town";
}

const DEFAULTS: Record<Archetype, Omit<WorldPlan, "name" | "features" | "seed">> = {
  city: {
    archetype: "city",
    style: "modern",
    size: "medium",
    biome: "temperate",
    terrain: { shape: "hills", relief: 0.5, river: false, lake: false, waterfall: false },
    buildings: { density: 0.85, kinds: ["skyscraper", "office", "apartment", "shop", "house"], maxFloors: 32, landmark: "none" },
    vegetation: { density: 0.5, species: ["oak", "birch", "pine"], plants: ["bush", "grass", "flowers"] },
    npcs: { count: 44, outfits: ["casual", "formal", "worker"] },
    vehicles: { count: 26, models: ["sedan", "suv", "taxi", "van", "bus", "truck"], flying: false, parkedRatio: 0.3 },
    props: { streetlights: true, trafficLights: true, market: false, benches: true, signs: false },
    timeOfDay: 13,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
  town: {
    archetype: "town",
    style: "modern",
    size: "small",
    biome: "temperate",
    terrain: { shape: "hills", relief: 0.5, river: false, lake: false, waterfall: false },
    buildings: { density: 0.75, kinds: ["house", "apartment", "shop"], maxFloors: 6, landmark: "none" },
    vegetation: { density: 0.65, species: ["oak", "birch", "pine"], plants: ["bush", "grass", "flowers"] },
    npcs: { count: 28, outfits: ["casual", "worker", "formal"] },
    vehicles: { count: 12, models: ["sedan", "suv", "van", "taxi"], flying: false, parkedRatio: 0.35 },
    props: { streetlights: true, trafficLights: true, market: false, benches: true, signs: false },
    timeOfDay: 14,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
  village: {
    archetype: "village",
    style: "classic",
    size: "small",
    biome: "temperate",
    terrain: { shape: "hills", relief: 0.6, river: true, lake: false, waterfall: false },
    buildings: { density: 0.6, kinds: ["house", "shop"], maxFloors: 2, landmark: "temple" },
    vegetation: { density: 0.75, species: ["oak", "pine", "birch"], plants: ["bush", "grass", "flowers", "fern"] },
    npcs: { count: 18, outfits: ["casual", "worker"] },
    vehicles: { count: 3, models: ["cart"], flying: false, parkedRatio: 1 },
    props: { streetlights: true, trafficLights: false, market: true, benches: true, signs: false },
    timeOfDay: 10,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
  medieval: {
    archetype: "medieval",
    style: "medieval",
    size: "medium",
    biome: "temperate",
    terrain: { shape: "mountain_ring", relief: 0.75, river: true, lake: false, waterfall: false },
    buildings: { density: 0.75, kinds: ["house", "shop", "tower"], maxFloors: 3, landmark: "castle" },
    vegetation: { density: 0.7, species: ["oak", "pine", "cypress"], plants: ["bush", "grass", "flowers", "fern"] },
    npcs: { count: 30, outfits: ["medieval", "knight"] },
    vehicles: { count: 4, models: ["cart"], flying: false, parkedRatio: 1 },
    props: { streetlights: true, trafficLights: false, market: true, benches: false, signs: false },
    timeOfDay: 11,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
  futuristic: {
    archetype: "futuristic",
    style: "futuristic",
    size: "medium",
    biome: "urban",
    terrain: { shape: "flat", relief: 0.3, river: false, lake: false, waterfall: false },
    buildings: { density: 0.9, kinds: ["skyscraper", "futuristic", "office", "apartment", "shop"], maxFloors: 70, landmark: "tower" },
    vegetation: { density: 0.25, species: ["sakura", "cypress"], plants: ["bush", "crystal"] },
    npcs: { count: 40, outfits: ["futuristic", "casual", "formal"] },
    vehicles: { count: 30, models: ["hover", "sports", "taxi"], flying: true, parkedRatio: 0.15 },
    props: { streetlights: true, trafficLights: true, market: false, benches: true, signs: true },
    timeOfDay: 21.5,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
  island: {
    archetype: "island",
    style: "tropical",
    size: "small",
    biome: "tropical",
    terrain: { shape: "island", relief: 0.7, river: false, lake: false, waterfall: false },
    buildings: { density: 0.5, kinds: ["hut", "house"], maxFloors: 2, landmark: "none" },
    vegetation: { density: 0.75, species: ["palm", "oak"], plants: ["bush", "grass", "flowers", "fern"] },
    npcs: { count: 16, outfits: ["tropical", "casual"] },
    vehicles: { count: 0, models: [], flying: false, parkedRatio: 0 },
    props: { streetlights: false, trafficLights: false, market: false, benches: false, signs: false },
    timeOfDay: 15,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
  forest: {
    archetype: "forest",
    style: "classic",
    size: "medium",
    biome: "fantasy",
    terrain: { shape: "hills", relief: 0.7, river: true, lake: true, waterfall: true },
    buildings: { density: 0.15, kinds: ["hut"], maxFloors: 1, landmark: "none" },
    vegetation: { density: 0.95, species: ["giant", "oak", "pine"], plants: ["mushroom", "fern", "grass", "flowers", "crystal"] },
    npcs: { count: 14, outfits: ["elf", "explorer"] },
    vehicles: { count: 0, models: [], flying: false, parkedRatio: 0 },
    props: { streetlights: false, trafficLights: false, market: false, benches: false, signs: false },
    timeOfDay: 17.5,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
  desert_base: {
    archetype: "desert_base",
    style: "scifi",
    size: "small",
    biome: "desert",
    terrain: { shape: "dunes", relief: 0.6, river: false, lake: false, waterfall: false },
    buildings: { density: 0.6, kinds: ["dome", "lab", "factory", "tower"], maxFloors: 6, landmark: "tower" },
    vegetation: { density: 0.08, species: ["cactus", "dead"], plants: ["crystal"] },
    npcs: { count: 14, outfits: ["explorer", "worker"] },
    vehicles: { count: 8, models: ["rover", "ship", "hover"], flying: true, parkedRatio: 0.3 },
    props: { streetlights: true, trafficLights: false, market: false, benches: false, signs: false },
    timeOfDay: 16,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
  racetrack: {
    archetype: "racetrack",
    style: "modern",
    size: "medium",
    biome: "temperate",
    terrain: { shape: "mountain_ring", relief: 0.7, river: false, lake: false, waterfall: false },
    buildings: { density: 0.4, kinds: ["grandstand", "pit"], maxFloors: 3, landmark: "none" },
    vegetation: { density: 0.55, species: ["pine", "oak", "cypress"], plants: ["bush", "grass"] },
    npcs: { count: 40, outfits: ["casual", "racer", "worker"] },
    vehicles: { count: 10, models: ["race"], flying: false, parkedRatio: 0 },
    props: { streetlights: false, trafficLights: false, market: false, benches: false, signs: true },
    timeOfDay: 15,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
  wilderness: {
    archetype: "wilderness",
    style: "classic",
    size: "medium",
    biome: "temperate",
    terrain: { shape: "mountains", relief: 0.85, river: true, lake: true, waterfall: false },
    buildings: { density: 0.1, kinds: ["hut"], maxFloors: 1, landmark: "none" },
    vegetation: { density: 0.85, species: ["pine", "oak", "birch"], plants: ["bush", "grass", "flowers", "fern"] },
    npcs: { count: 6, outfits: ["explorer"] },
    vehicles: { count: 0, models: [], flying: false, parkedRatio: 0 },
    props: { streetlights: false, trafficLights: false, market: false, benches: false, signs: false },
    timeOfDay: 12,
    weather: "clear",
    weatherIntensity: 0,
    wet: false,
  },
};

const ARCHETYPE_NAMES: Record<Archetype, string> = {
  city: "Ciudad",
  town: "Pueblo",
  village: "Aldea",
  medieval: "Reino medieval",
  futuristic: "Metrópolis futurista",
  island: "Isla tropical",
  forest: "Bosque fantástico",
  desert_base: "Base en el desierto",
  racetrack: "Circuito de carreras",
  wilderness: "Valle salvaje",
};

export interface PlannerResult {
  plan: WorldPlan;
  notes: string[];
}

export function planWorld(prompt: string, seedOverride?: number): PlannerResult {
  const t = normalize(prompt);
  const features = detectFeatures(t);
  const f = new Set(features);
  const archetype = detectArchetype(t, f);
  const d = structuredClone(DEFAULTS[archetype]);
  const notes: string[] = [`Tipo de mundo: ${ARCHETYPE_NAMES[archetype]}`];

  // Estilo
  if (has(t, /\b(japon\w*|tokio|tokyo|japanese|kioto|kyoto|oriental)\b/)) {
    d.style = "japanese";
    if (archetype !== "futuristic") d.vegetation.species = ["sakura", "pine"];
    else d.vegetation.species = ["sakura", "cypress"];
    notes.push("Estilo japonés");
  } else if (archetype === "city" && has(t, /\b(futurist\w*|cyberpunk)\b/)) d.style = "futuristic";
  if (archetype === "city" && has(t, /\b(colonial|clasic\w*|europe\w*|antigu\w*|old)\b/)) d.style = "classic";

  // Tamaño
  if (has(t, /\b(pequen\w*|chic\w*|small|little|tiny|diminut\w*)\b/)) d.size = "small";
  else if (has(t, /\b(grande|gran|enorme|gigante|big|large|huge|vast\w*|extens\w*|metropoli\w*|megaciudad)\b/)) d.size = "large";

  // Terreno
  if (f.has("mountains")) {
    d.terrain.shape = has(t, /\b(rodead\w*|surrounded|alrededor|entre montan\w*|valle)\b/) ? "mountain_ring" : d.terrain.shape === "island" ? "island" : "mountains";
    d.terrain.relief = Math.max(d.terrain.relief, 0.8);
  } else if (f.has("hills") && d.terrain.shape !== "island") d.terrain.shape = "hills";
  if (has(t, /\b(llanura\w*|plano|plana|flat|plains?|pampa)\b/)) d.terrain.shape = "flat";
  if (has(t, /\b(valle|valley)\b/) && d.terrain.shape !== "island") d.terrain.shape = "valley";
  if (has(t, /\b(desiert\w*|desert|dunas?|dunes?|arena)\b/) && archetype !== "island") {
    d.biome = "desert";
    if (d.terrain.shape === "hills" || d.terrain.shape === "flat") d.terrain.shape = "dunes";
    d.vegetation.species = ["cactus", "dead", "palm"];
    d.vegetation.density = Math.min(d.vegetation.density, 0.2);
  }
  if (archetype === "desert_base" && has(t, /\b(marte|mars|rojo|red|alien\w*|planeta|planet)\b/)) d.biome = "alien";
  if (f.has("river")) d.terrain.river = true;
  if (f.has("lake")) d.terrain.lake = true;
  if (f.has("waterfall")) {
    d.terrain.waterfall = true;
    d.terrain.river = true;
  }
  if ((f.has("beach") || f.has("ocean")) && archetype !== "island") {
    d.terrain.shape = "island";
    d.biome = d.biome === "temperate" ? "tropical" : d.biome;
  }

  // Clima y hora
  const weather = pickWeather(f);
  if (weather) {
    d.weather = weather.type;
    d.weatherIntensity = weather.intensity;
  }
  if (f.has("snow")) {
    d.biome = "snow";
    d.vegetation.species = ["pine", "birch"];
  }
  if (f.has("wet") || d.weather === "rain" || d.weather === "storm") d.wet = true;
  if (f.has("night")) d.timeOfDay = 22;
  else if (f.has("sunset")) d.timeOfDay = 17.3;
  else if (f.has("dawn")) d.timeOfDay = 6.9;
  else if (has(t, /\b(mediodia|de dia|daytime|noon|soleado|sunny)\b/)) d.timeOfDay = 12.5;

  // Edificios
  if (f.has("skyscrapers")) {
    if (!d.buildings.kinds.includes("skyscraper")) d.buildings.kinds.unshift("skyscraper");
    d.buildings.maxFloors = Math.max(d.buildings.maxFloors, 30);
  }
  if (f.has("houses") && !d.buildings.kinds.includes("house")) d.buildings.kinds.push("house");
  if (f.has("huts") && !d.buildings.kinds.includes("hut")) d.buildings.kinds.push("hut");
  if (f.has("bases") && !d.buildings.kinds.includes("dome")) d.buildings.kinds.push("dome", "lab");
  if (f.has("castle")) d.buildings.landmark = "castle";
  if (has(t, /\b(estadio|stadium)\b/)) d.buildings.landmark = "stadium";
  if (has(t, /\b(templo|temple|iglesia|church|catedral|cathedral|santuario|shrine)\b/)) d.buildings.landmark = "temple";
  if (has(t, /\b(hospital\w*)\b/)) addKind(d.buildings.kinds, "hospital");
  if (has(t, /\b(escuela\w*|colegio\w*|school\w*)\b/)) addKind(d.buildings.kinds, "school");
  if (has(t, /\b(fabrica\w*|factory|factories|industrial\w*|galpon\w*)\b/)) addKind(d.buildings.kinds, "factory");
  if (has(t, /\b(estacion de tren|train station|station)\b/)) addKind(d.buildings.kinds, "station");
  if (has(t, /\b(shopping|centro comercial|mall)\b/)) addKind(d.buildings.kinds, "mall");
  if (has(t, /\b(altos|alt\w* edificios|tall)\b/)) d.buildings.maxFloors = Math.max(d.buildings.maxFloors, 24);
  if (has(t, /\b(denso|densa|dense|abarrotad\w*|crowded)\b/)) d.buildings.density = Math.min(1, d.buildings.density + 0.15);

  // Vegetación
  if (f.has("forest") && archetype !== "forest") d.vegetation.density = Math.max(d.vegetation.density, 0.9);
  if (f.has("palms") && !d.vegetation.species.includes("palm")) d.vegetation.species.unshift("palm");
  if (has(t, /\b(sin arboles|no trees|sin vegetacion)\b/)) d.vegetation.density = 0;
  if (has(t, /\b(gigantes?|giant|enorme\w*|huge)\b/) && (f.has("trees") || f.has("forest")) && !d.vegetation.species.includes("giant"))
    d.vegetation.species.unshift("giant");
  if (has(t, /\b(pinos?|pines?|coniferas?)\b/) && !d.vegetation.species.includes("pine")) d.vegetation.species.unshift("pine");
  if (has(t, /\b(cerezos?|sakura|cherry)\b/) && !d.vegetation.species.includes("sakura")) d.vegetation.species.unshift("sakura");
  if (has(t, /\b(hongos?|setas?|mushrooms?)\b/)) addPlant(d.vegetation.plants, "mushroom");
  if (has(t, /\b(cristal\w*|crystals?)\b/)) addPlant(d.vegetation.plants, "crystal");

  // Personajes
  const peopleIdx = t.search(/\b(personas?|gente|peatones?|aldeanos?|habitantes?|people|pedestrians?|villagers?|npcs?|ciudadanos?|personajes?)\b/);
  if (peopleIdx >= 0) {
    const q = quantityBefore(t, peopleIdx);
    if (q) d.npcs.count = clampInt(q, 0, 200);
    else d.npcs.count = Math.max(d.npcs.count, 12);
  }
  if (has(t, /\b(sin gente|sin personas|no people|desiert[oa] de gente|abandonad\w*)\b/)) d.npcs.count = 0;
  if (has(t, /\b(caballeros?|knights?|guardias?|guards?|soldados?)\b/)) addOutfit(d.npcs.outfits, "knight");
  if (has(t, /\b(cientificos?|scientists?|astronautas?|astronauts?|exploradores?|explorers?)\b/)) addOutfit(d.npcs.outfits, "explorer");
  if (f.has("creatures")) addOutfit(d.npcs.outfits, "elf");

  // Vehículos
  const vehIdx = t.search(/\b(autos?|coches?|carros?|vehiculos?|cars?|vehicles?)\b/);
  if (vehIdx >= 0) {
    const q = quantityBefore(t, vehIdx);
    if (q) d.vehicles.count = clampInt(q, 0, 120);
    else d.vehicles.count = Math.max(d.vehicles.count, archetype === "racetrack" ? 10 : 10);
    if (d.vehicles.models.length === 0 || d.vehicles.models.every((m) => m === "cart")) d.vehicles.models = ["sedan", "suv", "van"];
  }
  if (f.has("vehicles") && d.vehicles.count === 0) {
    d.vehicles.count = 8;
    if (d.vehicles.models.length === 0) d.vehicles.models = archetype === "desert_base" ? ["rover", "hover"] : ["sedan", "suv"];
  }
  if (has(t, /\b(camion\w*|trucks?)\b/)) addVehicle(d.vehicles.models, "truck");
  if (has(t, /\b(colectivos?|buses?|omnibus|autobus\w*)\b/)) addVehicle(d.vehicles.models, "bus");
  if (has(t, /\b(motos?|motocicletas?|motorcycles?|motorbikes?)\b/)) addVehicle(d.vehicles.models, "motorcycle");
  if (has(t, /\b(taxis?)\b/)) addVehicle(d.vehicles.models, "taxi");
  if (f.has("flying_vehicles") || (archetype === "futuristic" && has(t, /\b(vehiculos? futurist\w*|futuristic vehicles?)\b/))) {
    d.vehicles.flying = true;
    addVehicle(d.vehicles.models, archetype === "futuristic" || archetype === "desert_base" ? "ship" : "hover");
    if (d.vehicles.count === 0) d.vehicles.count = 8;
  }
  if (has(t, /\b(vehiculos? futurist\w*|futuristic vehicles?|hover\w*)\b/)) addVehicle(d.vehicles.models, "hover");
  if (has(t, /\b(sin autos|sin vehiculos|sin trafico|no cars|no traffic|peatonal)\b/)) d.vehicles.count = 0;

  // Objetos urbanos
  if (f.has("traffic_lights")) d.props.trafficLights = true;
  if (f.has("streetlights")) d.props.streetlights = true;
  if (f.has("market")) d.props.market = true;
  if (f.has("neon")) d.props.signs = true;
  if (f.has("park")) d.props.benches = true;

  const seed = seedOverride ?? hashString(t || "worldforge");
  const color = findColor(t);
  if (color) notes.push(`Color destacado: ${color}`);

  const planInput: WorldPlan = {
    name: makeName(prompt, archetype),
    ...d,
    features,
    seed,
  };
  const plan = WorldPlanSchema.parse(planInput);
  notes.push(
    `Tamaño ${plan.size}, terreno ${plan.terrain.shape}, ${plan.npcs.count} personajes, ${plan.vehicles.count} vehículos`,
  );
  return { plan, notes };
}

function pickWeather(f: Set<Feature>): { type: WeatherType; intensity: number } | null {
  if (f.has("sandstorm")) return { type: "sandstorm", intensity: 0.8 };
  if (f.has("storm")) return { type: "storm", intensity: 0.9 };
  if (f.has("snow")) return { type: "snow", intensity: 0.7 };
  if (f.has("rain")) return { type: "rain", intensity: 0.7 };
  if (f.has("fog")) return { type: "fog", intensity: 0.7 };
  return null;
}

function makeName(prompt: string, archetype: Archetype): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) return ARCHETYPE_NAMES[archetype];
  const short = clean
    .replace(/^(cre[aá]|gener[aá]|constru[ií]|hac[eé]|dise[nñ]a|create|generate|build|make)\s+(una?|el|la|a|an|the)?\s*/i, "")
    .split(/[,.;]| con | with /i)[0]!
    .trim();
  const name = short.charAt(0).toUpperCase() + short.slice(1);
  return name.length >= 3 ? name.slice(0, 60) : ARCHETYPE_NAMES[archetype];
}

const clampInt = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)));
const addKind = (arr: BuildingKind[], k: BuildingKind) => {
  if (!arr.includes(k)) arr.push(k);
};
const addPlant = (arr: PlantSpecies[], k: PlantSpecies) => {
  if (!arr.includes(k)) arr.push(k);
};
const addOutfit = (arr: NpcOutfit[], k: NpcOutfit) => {
  if (!arr.includes(k)) arr.push(k);
};
const addVehicle = (arr: VehicleModel[], k: VehicleModel) => {
  if (!arr.includes(k)) arr.push(k);
};
export type { TreeSpecies };
