import { z } from "zod";
import {
  BiomeSchema,
  BuildingKindSchema,
  BuildingStyleSchema,
  NpcOutfitSchema,
  PlantSpeciesSchema,
  TreeSpeciesSchema,
  VehicleModelSchema,
  WeatherTypeSchema,
} from "../types";

/**
 * Plan de mundo: la descripción estructurada que produce el World Planner
 * (local o un modelo conectado) y que ejecutan los generadores.
 */

export const ARCHETYPES = [
  "city",
  "town",
  "village",
  "medieval",
  "futuristic",
  "island",
  "forest",
  "desert_base",
  "racetrack",
  "wilderness",
] as const;
export const ArchetypeSchema = z.enum(ARCHETYPES);
export type Archetype = z.infer<typeof ArchetypeSchema>;

export const FEATURES = [
  "mountains",
  "hills",
  "river",
  "lake",
  "waterfall",
  "beach",
  "ocean",
  "buildings",
  "skyscrapers",
  "houses",
  "castle",
  "market",
  "park",
  "streets",
  "trees",
  "forest",
  "palms",
  "people",
  "creatures",
  "vehicles",
  "flying_vehicles",
  "traffic_lights",
  "streetlights",
  "grandstands",
  "pits",
  "huts",
  "bases",
  "neon",
  "rain",
  "snow",
  "fog",
  "storm",
  "sandstorm",
  "night",
  "sunset",
  "dawn",
  "wet",
] as const;
export const FeatureSchema = z.enum(FEATURES);
export type Feature = z.infer<typeof FeatureSchema>;

export const WorldPlanSchema = z.object({
  name: z.string().min(1).max(80),
  archetype: ArchetypeSchema,
  style: BuildingStyleSchema,
  size: z.enum(["small", "medium", "large"]),
  biome: BiomeSchema,
  terrain: z.object({
    shape: z.enum(["flat", "hills", "mountains", "mountain_ring", "island", "valley", "dunes"]),
    relief: z.number().min(0).max(1),
    river: z.boolean(),
    lake: z.boolean(),
    waterfall: z.boolean(),
  }),
  buildings: z.object({
    density: z.number().min(0).max(1),
    kinds: z.array(BuildingKindSchema).max(20),
    maxFloors: z.number().int().min(1).max(120),
    landmark: z.enum(["none", "castle", "stadium", "temple", "tower"]),
  }),
  vegetation: z.object({
    density: z.number().min(0).max(1),
    species: z.array(TreeSpeciesSchema).min(1).max(9),
    plants: z.array(PlantSpeciesSchema).max(6),
  }),
  npcs: z.object({
    count: z.number().int().min(0).max(200),
    outfits: z.array(NpcOutfitSchema).min(1).max(10),
  }),
  vehicles: z.object({
    count: z.number().int().min(0).max(120),
    models: z.array(VehicleModelSchema).max(13),
    flying: z.boolean(),
    parkedRatio: z.number().min(0).max(1),
  }),
  props: z.object({
    streetlights: z.boolean(),
    trafficLights: z.boolean(),
    market: z.boolean(),
    benches: z.boolean(),
    signs: z.boolean(),
  }),
  timeOfDay: z.number().min(0).max(24),
  weather: WeatherTypeSchema,
  weatherIntensity: z.number().min(0).max(1),
  wet: z.boolean(),
  features: z.array(FeatureSchema).max(FEATURES.length),
  seed: z.number().int(),
});
export type WorldPlan = z.infer<typeof WorldPlanSchema>;
