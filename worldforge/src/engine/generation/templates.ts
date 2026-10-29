/** Mundos de demostración: todos se generan con el mismo motor a partir de texto. */
export interface WorldTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  gradient: [string, string];
  icon: "building" | "tree" | "sparkles" | "globe" | "car" | "mountain" | "moon" | "sun";
}

export const TEMPLATES: WorldTemplate[] = [
  {
    id: "modern-city",
    name: "Ciudad moderna",
    description: "Rascacielos, departamentos, parques, tránsito con semáforos y peatones.",
    prompt: "Construí una ciudad moderna con edificios altos, parques, autos, semáforos y peatones",
    gradient: ["#4a86c8", "#1b2a4a"],
    icon: "building",
  },
  {
    id: "tropical-island",
    name: "Isla tropical",
    description: "Isla montañosa con playa, agua, palmeras, cabañas y muelle.",
    prompt: "Creá una isla tropical montañosa con playa, palmeras, cabañas y gente paseando al atardecer",
    gradient: ["#f0a066", "#1f5f7a"],
    icon: "sun",
  },
  {
    id: "future-city",
    name: "Ciudad futurista",
    description: "Torres de vidrio, neón, noche, autos flotantes y naves voladoras.",
    prompt: "Creá una ciudad futurista de noche con rascacielos, carteles de neón, vehículos voladores y personas caminando",
    gradient: ["#7c4dff", "#0b0f25"],
    icon: "sparkles",
  },
  {
    id: "medieval-town",
    name: "Pueblo medieval",
    description: "Castillo en la colina, casas con entramado, mercado, caminos y aldeanos.",
    prompt: "Creá un pueblo medieval con castillo, casas, caminos, mercado y aldeanos, rodeado de montañas",
    gradient: ["#c9a227", "#3b2a1d"],
    icon: "mountain",
  },
  {
    id: "race-circuit",
    name: "Circuito de carreras",
    description: "Pista con pianos, tribunas, boxes, torres de luz y autos de carrera.",
    prompt: "Construí un circuito de carreras rodeado de montañas, con tribunas, boxes, iluminación y autos de carrera",
    gradient: ["#d23c3c", "#1d1f23"],
    icon: "car",
  },
  {
    id: "small-town",
    name: "Pueblo entre montañas",
    description: "El caso base: pequeña ciudad rodeada de montañas con gente caminando.",
    prompt: "Creá una pequeña ciudad rodeada de montañas, con edificios, calles, árboles y personas caminando",
    gradient: ["#5e8c3a", "#22344a"],
    icon: "globe",
  },
  {
    id: "neo-tokyo",
    name: "Tokio nocturno",
    description: "Ciudad japonesa futurista bajo la lluvia, calles mojadas y carteles luminosos.",
    prompt: "Creá una ciudad japonesa futurista de noche, con edificios altos, calles mojadas, carteles luminosos, vehículos circulando, personas caminando y lluvia",
    gradient: ["#ff2bd6", "#101830"],
    icon: "moon",
  },
  {
    id: "fantasy-forest",
    name: "Bosque fantástico",
    description: "Árboles gigantes, río, lago, cascada, hongos luminosos y elfos.",
    prompt: "Creá un bosque fantástico con árboles gigantes, ríos, cascadas y criaturas",
    gradient: ["#2fa58a", "#0e2a22"],
    icon: "tree",
  },
  {
    id: "mars-base",
    name: "Base en Marte",
    description: "Planeta desértico con domos científicos, rovers, naves y tormenta de arena.",
    prompt: "Generá un planeta desértico con tormentas de arena, bases científicas y vehículos futuristas",
    gradient: ["#c27a4a", "#3a1a10"],
    icon: "globe",
  },
];

export const EXAMPLE_PROMPTS = TEMPLATES.map((t) => t.prompt);
