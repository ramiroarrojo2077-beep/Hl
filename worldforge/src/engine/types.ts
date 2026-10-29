import { z } from "zod";

/**
 * Esquemas del documento de mundo. Son la única fuente de verdad: los tipos
 * de TypeScript se infieren de acá y los mismos esquemas validan los archivos
 * importados y lo que devuelve la IA.
 */

export const FORMAT_ID = "worldforge";
export const FORMAT_VERSION = 1;

export const LIMITS = {
  maxEntities: 20000,
  maxNameLength: 80,
  maxPromptLength: 2000,
  maxRoadPoints: 512,
  maxTracks: 500,
  maxKeysPerTrack: 500,
  maxTerrainResolution: 256,
  maxAddCount: 500,
  maxFileBytes: 60 * 1024 * 1024,
} as const;

const finite = z.number();
export const Vec2Schema = z.tuple([finite, finite]);
export const Vec3Schema = z.tuple([finite, finite, finite]);
export type Vec2 = z.infer<typeof Vec2Schema>;
export type Vec3 = z.infer<typeof Vec3Schema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal #rrggbb");
export const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Identificador inválido");

// Quita caracteres de control y recorta. Se aplica a todo texto que entra al documento.
export function sanitizeText(value: string, max: number = LIMITS.maxNameLength): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);
}
export const NameSchema = z
  .string()
  .transform((v) => sanitizeText(v))
  .pipe(z.string().min(1).max(LIMITS.maxNameLength));

export const TransformSchema = z.object({
  position: Vec3Schema,
  rotation: Vec3Schema, // Euler XYZ en radianes
  scale: Vec3Schema,
});
export type Transform = z.infer<typeof TransformSchema>;

export const MATERIAL_PRESETS = [
  "concrete",
  "brick",
  "plaster",
  "glass",
  "stone",
  "wood",
  "timber",
  "metal",
  "marble",
  "asphalt",
  "tiles",
  "thatch",
  "sand",
  "grass",
  "neon",
  "plastic",
  "fabric",
  "crystal",
] as const;
export const MaterialPresetSchema = z.enum(MATERIAL_PRESETS);
export type MaterialPreset = z.infer<typeof MaterialPresetSchema>;

export const MaterialSpecSchema = z.object({
  preset: MaterialPresetSchema,
  color: HexColorSchema,
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
  emissive: HexColorSchema,
  emissiveIntensity: z.number().min(0).max(20),
  opacity: z.number().min(0.05).max(1),
});
export type MaterialSpec = z.infer<typeof MaterialSpecSchema>;

export const PhysicsSchema = z.object({
  body: z.enum(["none", "static", "dynamic"]),
  mass: z.number().min(0.1).max(100000),
});
export type PhysicsSpec = z.infer<typeof PhysicsSchema>;

// ---------- Tipos de entidad ----------

export const BUILDING_KINDS = [
  "house",
  "apartment",
  "office",
  "skyscraper",
  "shop",
  "castle",
  "tower",
  "factory",
  "hospital",
  "school",
  "station",
  "stadium",
  "grandstand",
  "pit",
  "mall",
  "lab",
  "dome",
  "hut",
  "temple",
  "futuristic",
] as const;
export const BuildingKindSchema = z.enum(BUILDING_KINDS);
export type BuildingKind = z.infer<typeof BuildingKindSchema>;

export const BUILDING_STYLES = ["modern", "medieval", "futuristic", "japanese", "tropical", "scifi", "classic"] as const;
export const BuildingStyleSchema = z.enum(BUILDING_STYLES);
export type BuildingStyle = z.infer<typeof BuildingStyleSchema>;

export const ROOF_TYPES = ["flat", "gable", "hip", "spire", "dome", "crenellated", "pagoda", "thatch"] as const;
export const RoofSchema = z.enum(ROOF_TYPES);
export type RoofType = z.infer<typeof RoofSchema>;

export const WINDOW_STYLES = ["grid", "bands", "curtain", "sparse", "arched", "storefront", "none"] as const;
export const WindowStyleSchema = z.enum(WINDOW_STYLES);
export type WindowStyle = z.infer<typeof WindowStyleSchema>;

export const BuildingPropsSchema = z.object({
  kind: BuildingKindSchema,
  style: BuildingStyleSchema,
  shape: z.enum(["box", "tiered", "cylinder", "L"]),
  width: z.number().min(2).max(200),
  depth: z.number().min(2).max(200),
  floors: z.number().int().min(1).max(150),
  floorHeight: z.number().min(2).max(10),
  roof: RoofSchema,
  wall: MaterialPresetSchema,
  wallColor: HexColorSchema,
  roofColor: HexColorSchema,
  accentColor: HexColorSchema,
  windowColor: HexColorSchema,
  windows: WindowStyleSchema,
  balconies: z.boolean(),
  neon: z.boolean(),
  seed: z.number().int(),
});
export type BuildingProps = z.infer<typeof BuildingPropsSchema>;

export const TREE_SPECIES = ["oak", "pine", "birch", "palm", "cypress", "giant", "dead", "cactus", "sakura"] as const;
export const TreeSpeciesSchema = z.enum(TREE_SPECIES);
export type TreeSpecies = z.infer<typeof TreeSpeciesSchema>;

export const PLANT_SPECIES = ["bush", "grass", "flowers", "fern", "mushroom", "crystal"] as const;
export const PlantSpeciesSchema = z.enum(PLANT_SPECIES);
export type PlantSpecies = z.infer<typeof PlantSpeciesSchema>;

export const PROP_KINDS = [
  "streetlight",
  "bench",
  "traffic_light",
  "stall",
  "fountain",
  "barrel",
  "crate",
  "fence",
  "lantern",
  "billboard",
  "light_tower",
  "antenna",
  "landing_pad",
  "pier",
  "parasol",
  "well",
  "torch",
  "trash_bin",
  "hydrant",
  "tire_stack",
  "statue",
  "waterfall",
] as const;
export const PropKindSchema = z.enum(PROP_KINDS);
export type PropKind = z.infer<typeof PropKindSchema>;

export const VEHICLE_MODELS = [
  "sedan",
  "suv",
  "taxi",
  "van",
  "bus",
  "truck",
  "sports",
  "race",
  "hover",
  "rover",
  "ship",
  "motorcycle",
  "cart",
] as const;
export const VehicleModelSchema = z.enum(VEHICLE_MODELS);
export type VehicleModel = z.infer<typeof VehicleModelSchema>;

export const NPC_BEHAVIORS = ["idle", "wander", "sidewalk", "patrol", "poi"] as const;
export const NpcBehaviorSchema = z.enum(NPC_BEHAVIORS);
export type NpcBehavior = z.infer<typeof NpcBehaviorSchema>;

export const NPC_OUTFITS = ["casual", "formal", "worker", "medieval", "knight", "futuristic", "tropical", "explorer", "racer", "elf"] as const;
export const NpcOutfitSchema = z.enum(NPC_OUTFITS);
export type NpcOutfit = z.infer<typeof NpcOutfitSchema>;

export const NpcAppearanceSchema = z.object({
  outfit: NpcOutfitSchema,
  skin: HexColorSchema,
  top: HexColorSchema,
  bottom: HexColorSchema,
  hair: HexColorSchema,
  height: z.number().min(1.2).max(2.4),
  build: z.number().min(0.7).max(1.4),
});
export type NpcAppearance = z.infer<typeof NpcAppearanceSchema>;

export const ROAD_KINDS = ["street", "avenue", "highway", "dirt", "track", "path"] as const;
export const RoadKindSchema = z.enum(ROAD_KINDS);
export type RoadKind = z.infer<typeof RoadKindSchema>;

export const PRIMITIVE_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "capsule", "plane"] as const;
export const PrimitiveShapeSchema = z.enum(PRIMITIVE_SHAPES);
export type PrimitiveShape = z.infer<typeof PrimitiveShapeSchema>;

export const LIGHT_KINDS = ["sun", "point", "spot", "area"] as const;
export const LightKindSchema = z.enum(LIGHT_KINDS);

const EntityBase = z.object({
  id: IdSchema,
  name: NameSchema,
  parentId: IdSchema.nullable(),
  children: z.array(IdSchema),
  transform: TransformSchema,
  visible: z.boolean(),
  locked: z.boolean(),
  material: MaterialSpecSchema.nullable().optional(),
  physics: PhysicsSchema.optional(),
});

const ent = <T extends string, P extends z.ZodType>(type: T, props: P) =>
  EntityBase.extend({ type: z.literal(type), props });

export const EntitySchema = z.discriminatedUnion("type", [
  ent("world", z.object({})),
  ent("folder", z.object({ category: z.string().max(32) })),
  ent("group", z.object({})),
  ent("terrain", z.object({})),
  ent("environment", z.object({})),
  ent("weather", z.object({})),
  ent("building", BuildingPropsSchema),
  ent("tree", z.object({ species: TreeSpeciesSchema, seed: z.number().int() })),
  ent("plant", z.object({ species: PlantSpeciesSchema, seed: z.number().int() })),
  ent("rock", z.object({ variant: z.number().int().min(0).max(7) })),
  ent(
    "prop",
    z.object({
      kind: PropKindSchema,
      color: HexColorSchema,
      intersectionId: z.string().max(64).nullable(),
      axis: z.enum(["x", "z"]),
    }),
  ),
  ent(
    "npc",
    z.object({
      appearance: NpcAppearanceSchema,
      behavior: NpcBehaviorSchema,
      speed: z.number().min(0).max(8),
      wanderRadius: z.number().min(1).max(200),
      patrol: z.array(Vec2Schema).max(64),
      greets: z.boolean(),
      modelAssetId: z.string().max(64).nullable(),
    }),
  ),
  ent(
    "vehicle",
    z.object({
      model: VehicleModelSchema,
      color: HexColorSchema,
      routeId: z.string().max(64).nullable(),
      routeT: z.number().min(0).max(1),
      speed: z.number().min(0).max(120),
      parked: z.boolean(),
    }),
  ),
  ent(
    "road",
    z.object({
      kind: RoadKindSchema,
      points: z.array(Vec2Schema).min(2).max(LIMITS.maxRoadPoints),
      closed: z.boolean(),
      width: z.number().min(1).max(60),
      markings: z.boolean(),
    }),
  ),
  ent(
    "block",
    z.object({
      size: Vec2Schema,
      sidewalk: z.number().min(0).max(10),
      use: z.enum(["buildings", "park", "plaza", "parking"]),
    }),
  ),
  ent(
    "light",
    z.object({
      kind: LightKindSchema,
      color: HexColorSchema,
      intensity: z.number().min(0).max(100),
      distance: z.number().min(0).max(1000),
      angle: z.number().min(0.05).max(1.5),
      castShadow: z.boolean(),
    }),
  ),
  ent("camera", z.object({ fov: z.number().min(10).max(120), target: Vec3Schema })),
  ent("primitive", z.object({ shape: PrimitiveShapeSchema })),
  ent("model", z.object({ assetId: z.string().max(64), assetName: z.string().max(120) })),
  ent("spawn", z.object({})),
]);
export type Entity = z.infer<typeof EntitySchema>;
export type EntityType = Entity["type"];
export type EntityOf<T extends EntityType> = Extract<Entity, { type: T }>;
export const ENTITY_TYPES = EntitySchema.options.map((o) => o.shape.type.value) as EntityType[];

/** Tipos que no se pueden borrar ni duplicar: forman el esqueleto del mundo. */
export const PROTECTED_TYPES: ReadonlySet<EntityType> = new Set(["world", "folder", "terrain", "environment", "weather"]);
/** Tipos sin transformación editable (sus datos viven en coordenadas de mundo o en ajustes globales). */
export const NON_TRANSFORMABLE: ReadonlySet<EntityType> = new Set([
  "world",
  "folder",
  "terrain",
  "environment",
  "weather",
  "road",
]);

// ---------- Terreno ----------

export const BIOMES = ["temperate", "desert", "tropical", "snow", "fantasy", "alien", "urban"] as const;
export const BiomeSchema = z.enum(BIOMES);
export type Biome = z.infer<typeof BiomeSchema>;

export const TERRAIN_PAINT = ["auto", "grass", "sand", "rock", "snow", "dirt", "pavement"] as const;

export const TerrainSchema = z
  .object({
    size: z.number().min(50).max(4000),
    resolution: z.number().int().min(8).max(LIMITS.maxTerrainResolution),
    heights: z.array(z.number()),
    paint: z.array(z.number().int().min(0).max(TERRAIN_PAINT.length - 1)),
    waterLevel: z.number().min(-100).max(500),
    waterEnabled: z.boolean(),
    biome: BiomeSchema,
    snowLine: z.number(),
  })
  .refine((t) => t.heights.length === (t.resolution + 1) ** 2, "La cantidad de alturas no coincide con la resolución")
  .refine((t) => t.paint.length === t.heights.length, "La capa de pintura no coincide con el terreno");
export type Terrain = z.infer<typeof TerrainSchema>;

// ---------- Ambiente y clima ----------

export const EnvironmentSchema = z.object({
  timeOfDay: z.number().min(0).max(24),
  dayNightCycle: z.boolean(),
  cycleMinutes: z.number().min(0.5).max(240),
  sunIntensity: z.number().min(0).max(10),
  ambientIntensity: z.number().min(0).max(5),
  sky: z.enum(["earth", "alien", "dusk"]),
  fogDensity: z.number().min(0).max(0.1),
  fogColor: HexColorSchema.nullable(),
  exposure: z.number().min(0.1).max(4),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const WEATHER_TYPES = ["clear", "cloudy", "rain", "storm", "snow", "fog", "sandstorm"] as const;
export const WeatherTypeSchema = z.enum(WEATHER_TYPES);
export type WeatherType = z.infer<typeof WeatherTypeSchema>;

export const WeatherSchema = z.object({
  type: WeatherTypeSchema,
  intensity: z.number().min(0).max(1),
  wind: z.number().min(0).max(1),
  clouds: z.number().min(0).max(1),
  wetness: z.number().min(0).max(1),
});
export type Weather = z.infer<typeof WeatherSchema>;

// ---------- Tránsito y navegación ----------

export const RouteSchema = z.object({
  id: z.string().max(64),
  points: z.array(Vec2Schema).min(2).max(2048),
  closed: z.boolean(),
  kind: z.enum(["road", "race", "air"]),
  altitude: z.number().min(0).max(500),
  lane: z.number().min(-10).max(10), // desplazamiento lateral a la derecha, en metros
  speedLimit: z.number().min(1).max(120),
});
export type Route = z.infer<typeof RouteSchema>;

export const IntersectionSchema = z.object({
  id: z.string().max(64),
  position: Vec2Schema,
  radius: z.number().min(1).max(60),
  hasLights: z.boolean(),
  phaseOffset: z.number(),
});
export type Intersection = z.infer<typeof IntersectionSchema>;

export const NavEdgeSchema = z.object({
  a: z.number().int().min(0),
  b: z.number().int().min(0),
  /** Si el tramo cruza una calle: intersección y eje de la calle que cruza. */
  crossing: z
    .object({ intersectionId: z.string().max(64), streetAxis: z.enum(["x", "z"]) })
    .nullable(),
});
export const PoiSchema = z.object({
  id: z.string().max(64),
  position: Vec2Schema,
  facing: z.number(),
  kind: z.enum(["bench", "stall", "fountain", "viewpoint", "door"]),
  node: z.number().int().min(-1),
});
export type Poi = z.infer<typeof PoiSchema>;

export const NavigationSchema = z.object({
  nodes: z.array(Vec2Schema).max(20000),
  edges: z.array(NavEdgeSchema).max(60000),
  pois: z.array(PoiSchema).max(5000),
});
export type Navigation = z.infer<typeof NavigationSchema>;

// ---------- Animación ----------

export const TRACK_PROPERTIES = ["position", "rotation", "scale", "intensity", "timeOfDay"] as const;
export const KeyframeSchema = z.object({
  t: z.number().min(0).max(3600),
  value: z.array(z.number()).min(1).max(3),
  ease: z.enum(["linear", "smooth", "step"]),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;
export const TrackSchema = z.object({
  id: z.string().max(64),
  entityId: IdSchema,
  property: z.enum(TRACK_PROPERTIES),
  keys: z.array(KeyframeSchema).max(LIMITS.maxKeysPerTrack),
});
export type Track = z.infer<typeof TrackSchema>;
export const CameraKeySchema = z.object({
  t: z.number().min(0).max(3600),
  position: Vec3Schema,
  target: Vec3Schema,
  fov: z.number().min(10).max(120),
});
export type CameraKey = z.infer<typeof CameraKeySchema>;
export const AnimationSchema = z.object({
  duration: z.number().min(1).max(3600),
  fps: z.number().int().min(1).max(120),
  tracks: z.array(TrackSchema).max(LIMITS.maxTracks),
  camera: z.array(CameraKeySchema).max(LIMITS.maxKeysPerTrack),
});
export type Animation = z.infer<typeof AnimationSchema>;

// ---------- Documento ----------

export const AssetMetaSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(120),
  mime: z.string().max(80),
  size: z.number().int().min(0),
});
export type AssetMeta = z.infer<typeof AssetMetaSchema>;

export const WorldDocSchema = z.object({
  format: z.literal(FORMAT_ID),
  formatVersion: z.literal(FORMAT_VERSION),
  id: IdSchema,
  name: NameSchema,
  prompt: z.string().max(LIMITS.maxPromptLength),
  seed: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
  rootId: IdSchema,
  entities: z.record(IdSchema, EntitySchema),
  counters: z.record(z.string().max(40), z.number().int().min(0)),
  terrain: TerrainSchema,
  environment: EnvironmentSchema,
  weather: WeatherSchema,
  routes: z.array(RouteSchema).max(500),
  intersections: z.array(IntersectionSchema).max(2000),
  navigation: NavigationSchema,
  animation: AnimationSchema,
  simulation: z.object({ npcs: z.boolean(), traffic: z.boolean() }),
  assets: z.record(z.string().max(64), AssetMetaSchema),
});
export type WorldDoc = z.infer<typeof WorldDocSchema>;
