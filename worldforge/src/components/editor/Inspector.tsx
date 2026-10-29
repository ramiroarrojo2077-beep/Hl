"use client";

import type { Draft } from "immer";
import { deg, rad, round } from "@/engine/math";
import { presetDefaults } from "@/engine/models/materials";
import { DEFAULT_MATERIAL } from "@/engine/scene/doc";
import { upsertKey } from "@/engine/scene/animation";
import {
  BIOMES,
  BUILDING_KINDS,
  BUILDING_STYLES,
  MATERIAL_PRESETS,
  NON_TRANSFORMABLE,
  NPC_BEHAVIORS,
  NPC_OUTFITS,
  PLANT_SPECIES,
  PRIMITIVE_SHAPES,
  PROP_KINDS,
  PROTECTED_TYPES,
  ROAD_KINDS,
  ROOF_TYPES,
  TREE_SPECIES,
  VEHICLE_MODELS,
  WEATHER_TYPES,
  WINDOW_STYLES,
  type Entity,
  type EntityOf,
  type MaterialSpec,
  type WorldDoc,
} from "@/engine/types";
import { useEditor } from "@/store/editor";
import { useRuntime } from "@/store/runtime";
import { canvasState } from "../viewport/Viewport";
import { Badge, Button, ColorField, NumberField, Row, Section, Select, Slider, TextField, Toggle, Vec3Field } from "../ui/controls";
import { Icon } from "../ui/Icon";

const LABELS: Record<string, string> = {
  house: "Casa", apartment: "Departamentos", office: "Oficinas", skyscraper: "Rascacielos", shop: "Comercio", castle: "Castillo", tower: "Torre", factory: "Fábrica", hospital: "Hospital", school: "Escuela", station: "Estación", stadium: "Estadio", grandstand: "Tribuna", pit: "Boxes", mall: "Centro comercial", lab: "Laboratorio", dome: "Domo", hut: "Cabaña", temple: "Templo", futuristic: "Futurista",
  modern: "Moderno", medieval: "Medieval", japanese: "Japonés", tropical: "Tropical", scifi: "Ciencia ficción", classic: "Clásico",
  flat: "Plano", gable: "Dos aguas", hip: "Cuatro aguas", spire: "Aguja", dome_r: "Cúpula", crenellated: "Almenado", pagoda: "Pagoda", thatch: "Paja",
  grid: "Grilla", bands: "Bandas", curtain: "Muro cortina", sparse: "Pocas", arched: "Arcos", storefront: "Vidriera", none: "Sin ventanas",
  idle: "Quieto", wander: "Deambular", sidewalk: "Caminar por veredas", patrol: "Patrullar", poi: "Visitar lugares",
};
const NO_TRACKS: WorldDoc["animation"]["tracks"] = [];
const NO_ROUTES: WorldDoc["routes"] = [];
const opts = <T extends string>(list: readonly T[]) => list.map((v) => ({ value: v, label: LABELS[v] ?? v }));

function useEntity(id: string | undefined): Entity | undefined {
  return useEditor((s) => (id ? s.doc?.entities[id] : undefined));
}

/** Aplica un cambio a una entidad como paso deshacible. */
function edit(id: string, label: string, fn: (e: Draft<Entity>) => void) {
  useEditor.getState().exec(label, (d) => {
    const e = d.entities[id];
    if (e) fn(e);
  });
}
/** Vista previa sin historial (mientras se arrastra un deslizador). */
function preview(id: string, fn: (e: Draft<Entity>) => void) {
  const s = useEditor.getState();
  if (!s.transientBase) s.beginTransient();
  s.updateTransient((d) => {
    const e = d.entities[id];
    if (e) fn(e);
  });
}
function commitPreview(id: string, label: string, fn: (e: Draft<Entity>) => void) {
  const s = useEditor.getState();
  if (s.transientBase)
    s.commitTransient(label, (d) => {
      const e = d.entities[id];
      if (e) fn(e);
    });
  else edit(id, label, fn);
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  if (!doc) return null;
  if (selection.length === 0) return <EmptyInspector />;
  if (selection.length > 1) return <MultiInspector ids={selection} />;
  return <EntityInspector id={selection[0]!} />;
}

function EmptyInspector() {
  return (
    <div className="space-y-3 p-4 text-xs text-muted">
      <p className="text-sm text-text">Nada seleccionado</p>
      <p>Hacé clic en un objeto del visor o de la jerarquía para editarlo. Con Shift o Ctrl seleccionás varios.</p>
      <ul className="space-y-1">
        <li>
          <kbd className="rounded bg-surface-2 px-1">W</kbd> mover · <kbd className="rounded bg-surface-2 px-1">E</kbd> rotar · <kbd className="rounded bg-surface-2 px-1">R</kbd> escalar
        </li>
        <li>
          <kbd className="rounded bg-surface-2 px-1">F</kbd> encuadrar · <kbd className="rounded bg-surface-2 px-1">Ctrl+D</kbd> duplicar · <kbd className="rounded bg-surface-2 px-1">Supr</kbd> eliminar
        </li>
        <li>
          <kbd className="rounded bg-surface-2 px-1">Ctrl+Z</kbd> deshacer · <kbd className="rounded bg-surface-2 px-1">Ctrl+S</kbd> guardar
        </li>
      </ul>
    </div>
  );
}

function MultiInspector({ ids }: { ids: string[] }) {
  const s = useEditor.getState();
  return (
    <div className="space-y-3 p-3 text-xs">
      <p className="text-sm">{ids.length} objetos seleccionados</p>
      <div className="grid grid-cols-2 gap-2">
        <Button icon="copy" onClick={() => s.duplicateSelection()}>
          Duplicar
        </Button>
        <Button icon="group" onClick={() => s.groupSelection()}>
          Agrupar
        </Button>
        <Button icon="eyeOff" onClick={() => s.toggleVisibility()}>
          Ocultar/mostrar
        </Button>
        <Button icon="lock" onClick={() => s.toggleLock()}>
          Bloquear
        </Button>
        <Button icon="trash" variant="danger" onClick={() => s.deleteSelection()} className="col-span-2">
          Eliminar
        </Button>
      </div>
    </div>
  );
}

function EntityInspector({ id }: { id: string }) {
  const e = useEntity(id);
  if (!e) return null;
  if (e.type === "terrain") return <TerrainInspector />;
  if (e.type === "environment") return <EnvironmentInspector />;
  if (e.type === "weather") return <WeatherInspector />;
  const isProtected = PROTECTED_TYPES.has(e.type);
  const placeholder = e.type === "npc" || e.type === "vehicle";
  return (
    <div className="pb-6" data-testid="inspector">
      <div className="space-y-2 border-b border-line px-3 py-3">
        <div className="flex items-center gap-2">
          <Badge tone="accent">{e.type}</Badge>
          <span className="truncate font-mono text-[10px] text-muted">{e.id}</span>
        </div>
        {isProtected ? <p className="text-sm font-semibold">{e.name}</p> : <TextField testId="inspector-name" value={e.name} onCommit={(v) => useEditor.getState().rename(id, v)} />}
        <div className="flex gap-3">
          <Toggle checked={e.visible} label="Visible" onChange={(v) => edit(id, v ? "Mostrar" : "Ocultar", (x) => void (x.visible = v))} />
          {!isProtected && <Toggle checked={e.locked} label="Bloqueado" onChange={(v) => edit(id, v ? "Bloquear" : "Desbloquear", (x) => void (x.locked = v))} />}
        </div>
        {placeholder && (
          <p className="rounded-md bg-warn/10 px-2 py-1.5 text-[11px] text-warn">Modelo procedural low-poly provisional (esqueleto y animaciones reales). Podés reemplazarlo importando un GLB riggeado.</p>
        )}
      </div>
      {!NON_TRANSFORMABLE.has(e.type) && <TransformSection e={e} />}
      {e.type === "building" && <BuildingSection e={e} />}
      {e.type === "tree" && (
        <Section title="Árbol">
          <Row label="Especie">
            <Select value={e.props.species} options={TREE_SPECIES} onChange={(v) => edit(id, "Cambiar especie", (x) => void ((x as EntityOf<"tree">).props.species = v))} />
          </Row>
        </Section>
      )}
      {e.type === "plant" && (
        <Section title="Planta">
          <Row label="Especie">
            <Select value={e.props.species} options={PLANT_SPECIES} onChange={(v) => edit(id, "Cambiar planta", (x) => void ((x as EntityOf<"plant">).props.species = v))} />
          </Row>
        </Section>
      )}
      {e.type === "rock" && (
        <Section title="Roca">
          <Row label="Variante">
            <NumberField value={e.props.variant} step={1} min={0} max={7} decimals={0} onCommit={(v) => edit(id, "Cambiar roca", (x) => void ((x as EntityOf<"rock">).props.variant = Math.round(v)))} />
          </Row>
        </Section>
      )}
      {e.type === "prop" && (
        <Section title="Objeto">
          <Row label="Tipo">
            <Select value={e.props.kind} options={PROP_KINDS} onChange={(v) => edit(id, "Cambiar objeto", (x) => void ((x as EntityOf<"prop">).props.kind = v))} />
          </Row>
          <Row label="Color">
            <ColorField value={e.props.color} onCommit={(v) => edit(id, "Color", (x) => void ((x as EntityOf<"prop">).props.color = v))} />
          </Row>
        </Section>
      )}
      {e.type === "npc" && <NpcSection e={e} />}
      {e.type === "vehicle" && <VehicleSection e={e} />}
      {e.type === "road" && <RoadSection e={e} />}
      {e.type === "block" && (
        <Section title="Manzana">
          <Row label="Uso">
            <Select value={e.props.use} options={[{ value: "buildings", label: "Edificios" }, { value: "park", label: "Parque" }, { value: "plaza", label: "Plaza" }, { value: "parking", label: "Estacionamiento" }]} onChange={(v) => edit(id, "Uso de manzana", (x) => void ((x as EntityOf<"block">).props.use = v))} />
          </Row>
          <Row label="Vereda (m)">
            <NumberField value={e.props.sidewalk} min={0} max={10} onCommit={(v) => edit(id, "Vereda", (x) => void ((x as EntityOf<"block">).props.sidewalk = v))} />
          </Row>
        </Section>
      )}
      {e.type === "light" && <LightSection e={e} />}
      {e.type === "camera" && <CameraSection e={e} />}
      {e.type === "primitive" && (
        <Section title="Primitiva">
          <Row label="Forma">
            <Select value={e.props.shape} options={PRIMITIVE_SHAPES} onChange={(v) => edit(id, "Forma", (x) => void ((x as EntityOf<"primitive">).props.shape = v))} />
          </Row>
        </Section>
      )}
      {e.type === "model" && (
        <Section title="Modelo importado">
          <p className="text-xs text-muted">{e.props.assetName}</p>
        </Section>
      )}
      {(e.type === "primitive" || e.type === "model" || e.type === "rock" || e.type === "group") && e.type !== "group" && <MaterialSection e={e} />}
      {(e.type === "primitive" || e.type === "model" || e.type === "prop") && <PhysicsSection e={e} />}
      {!NON_TRANSFORMABLE.has(e.type) && <KeyframeSection e={e} />}
      {!isProtected && (
        <div className="grid grid-cols-2 gap-2 p-3">
          <Button icon="copy" onClick={() => useEditor.getState().duplicateSelection()}>
            Duplicar
          </Button>
          <Button icon="trash" variant="danger" onClick={() => useEditor.getState().deleteSelection()} testId="inspector-delete">
            Eliminar
          </Button>
        </div>
      )}
    </div>
  );
}

function TransformSection({ e }: { e: Entity }) {
  const t = e.transform;
  const id = e.id;
  return (
    <Section title="Transformación">
      <Row label="Posición">
        <Vec3Field testId="pos" value={t.position} onCommit={(v) => edit(id, "Mover", (x) => void (x.transform.position = v))} />
      </Row>
      <Row label="Rotación °">
        <Vec3Field testId="rot" step={5} decimals={1} value={t.rotation.map(deg)} onCommit={(v) => edit(id, "Rotar", (x) => void (x.transform.rotation = v.map((d) => round(rad(d), 4)) as [number, number, number]))} />
      </Row>
      <Row label="Escala">
        <Vec3Field testId="scale" step={0.1} value={t.scale} onCommit={(v) => edit(id, "Escalar", (x) => void (x.transform.scale = v.map((s) => Math.max(0.01, s)) as [number, number, number]))} />
      </Row>
    </Section>
  );
}

function BuildingSection({ e }: { e: EntityOf<"building"> }) {
  const p = e.props;
  const id = e.id;
  const set = <K extends keyof typeof p>(key: K, label: string) => (v: (typeof p)[K]) => edit(id, label, (x) => void ((x as EntityOf<"building">).props[key] = v));
  return (
    <>
      <Section title="Edificio">
        <Row label="Tipo">
          <Select value={p.kind} options={opts(BUILDING_KINDS)} onChange={set("kind", "Tipo de edificio")} />
        </Row>
        <Row label="Estilo">
          <Select value={p.style} options={opts(BUILDING_STYLES)} onChange={set("style", "Estilo")} />
        </Row>
        <Row label="Forma">
          <Select value={p.shape} options={[{ value: "box", label: "Prisma" }, { value: "tiered", label: "Escalonada" }, { value: "cylinder", label: "Cilíndrica" }]} onChange={set("shape", "Forma")} />
        </Row>
        <Row label="Pisos">
          <Slider
            testId="floors"
            value={p.floors}
            min={1}
            max={120}
            step={1}
            format={(v) => String(Math.round(v))}
            onPreview={(v) => preview(id, (x) => void ((x as EntityOf<"building">).props.floors = Math.round(v)))}
            onCommit={(v) => commitPreview(id, "Cambiar pisos", (x) => void ((x as EntityOf<"building">).props.floors = Math.round(v)))}
          />
        </Row>
        <Row label="Alto por piso">
          <NumberField value={p.floorHeight} min={2} max={10} step={0.1} onCommit={set("floorHeight", "Altura de piso")} />
        </Row>
        <Row label="Ancho (m)">
          <NumberField value={p.width} min={2} max={200} step={0.5} onCommit={set("width", "Ancho")} />
        </Row>
        <Row label="Profundidad">
          <NumberField value={p.depth} min={2} max={200} step={0.5} onCommit={set("depth", "Profundidad")} />
        </Row>
        <Row label="Techo">
          <Select value={p.roof} options={ROOF_TYPES.map((r) => ({ value: r, label: r === "dome" ? "Cúpula" : LABELS[r] ?? r }))} onChange={set("roof", "Techo")} />
        </Row>
        <Row label="Ventanas">
          <Select value={p.windows} options={opts(WINDOW_STYLES)} onChange={set("windows", "Ventanas")} />
        </Row>
        <div className="flex gap-4 pt-1">
          <Toggle checked={p.balconies} label="Balcones" onChange={set("balconies", "Balcones")} />
          <Toggle checked={p.neon} label="Neón" onChange={set("neon", "Neón")} />
        </div>
        <Row label="Variación">
          <Button icon="sparkles" variant="ghost" onClick={() => edit(id, "Nueva variación", (x) => void ((x as EntityOf<"building">).props.seed = Math.floor(Math.random() * 1e9)))}>
            Regenerar detalles
          </Button>
        </Row>
      </Section>
      <Section title="Materiales">
        <Row label="Paredes">
          <Select value={p.wall} options={MATERIAL_PRESETS} onChange={set("wall", "Material de paredes")} testId="wall-material" />
        </Row>
        <Row label="Color paredes">
          <ColorField value={p.wallColor} onCommit={set("wallColor", "Color de paredes")} />
        </Row>
        <Row label="Color techo">
          <ColorField value={p.roofColor} onCommit={set("roofColor", "Color de techo")} />
        </Row>
        <Row label="Detalles">
          <ColorField value={p.accentColor} onCommit={set("accentColor", "Color de detalles")} />
        </Row>
        <Row label="Vidrios">
          <ColorField value={p.windowColor} onCommit={set("windowColor", "Color de vidrios")} />
        </Row>
      </Section>
    </>
  );
}

function NpcSection({ e }: { e: EntityOf<"npc"> }) {
  const p = e.props;
  const id = e.id;
  const setA = <K extends keyof typeof p.appearance>(key: K, label: string) => (v: (typeof p.appearance)[K]) => edit(id, label, (x) => void ((x as EntityOf<"npc">).props.appearance[key] = v));
  return (
    <>
      <Section title="Comportamiento">
        <Row label="Acción">
          <Select value={p.behavior} options={opts(NPC_BEHAVIORS)} onChange={(v) => edit(id, "Comportamiento", (x) => void ((x as EntityOf<"npc">).props.behavior = v))} />
        </Row>
        <Row label="Velocidad m/s">
          <NumberField value={p.speed} min={0} max={8} step={0.1} onCommit={(v) => edit(id, "Velocidad", (x) => void ((x as EntityOf<"npc">).props.speed = v))} />
        </Row>
        <Row label="Radio (m)">
          <NumberField value={p.wanderRadius} min={1} max={200} step={1} onCommit={(v) => edit(id, "Radio", (x) => void ((x as EntityOf<"npc">).props.wanderRadius = v))} />
        </Row>
        <Toggle checked={p.greets} label="Saluda al jugador" onChange={(v) => edit(id, "Saludo", (x) => void ((x as EntityOf<"npc">).props.greets = v))} />
      </Section>
      <Section title="Apariencia">
        <Row label="Vestimenta">
          <Select value={p.appearance.outfit} options={NPC_OUTFITS} onChange={setA("outfit", "Vestimenta")} />
        </Row>
        <Row label="Piel">
          <ColorField value={p.appearance.skin} onCommit={setA("skin", "Piel")} />
        </Row>
        <Row label="Superior">
          <ColorField value={p.appearance.top} onCommit={setA("top", "Ropa superior")} />
        </Row>
        <Row label="Inferior">
          <ColorField value={p.appearance.bottom} onCommit={setA("bottom", "Ropa inferior")} />
        </Row>
        <Row label="Pelo">
          <ColorField value={p.appearance.hair} onCommit={setA("hair", "Pelo")} />
        </Row>
        <Row label="Altura (m)">
          <NumberField value={p.appearance.height} min={1.2} max={2.4} step={0.01} onCommit={setA("height", "Altura")} />
        </Row>
        <Row label="Contextura">
          <NumberField value={p.appearance.build} min={0.7} max={1.4} step={0.05} onCommit={setA("build", "Contextura")} />
        </Row>
      </Section>
    </>
  );
}

function VehicleSection({ e }: { e: EntityOf<"vehicle"> }) {
  const p = e.props;
  const id = e.id;
  const routes = useEditor((s) => s.doc?.routes) ?? NO_ROUTES;
  return (
    <Section title="Vehículo">
      <Row label="Modelo">
        <Select value={p.model} options={VEHICLE_MODELS} onChange={(v) => edit(id, "Modelo", (x) => void ((x as EntityOf<"vehicle">).props.model = v))} />
      </Row>
      <Row label="Color">
        <ColorField value={p.color} onCommit={(v) => edit(id, "Color", (x) => void ((x as EntityOf<"vehicle">).props.color = v))} />
      </Row>
      <Row label="Velocidad m/s">
        <NumberField value={p.speed} min={0} max={120} step={0.5} onCommit={(v) => edit(id, "Velocidad", (x) => void ((x as EntityOf<"vehicle">).props.speed = v))} />
      </Row>
      <Row label="Ruta">
        <Select
          value={p.routeId ?? ""}
          options={[{ value: "", label: "Sin ruta" }, ...routes.map((r) => ({ value: r.id, label: `${r.id} (${r.kind})` }))]}
          onChange={(v) => edit(id, "Ruta", (x) => {
            const vv = x as EntityOf<"vehicle">;
            vv.props.routeId = v || null;
            vv.props.parked = !v;
          })}
        />
      </Row>
      <Toggle checked={p.parked} label="Estacionado" onChange={(v) => edit(id, v ? "Estacionar" : "Circular", (x) => void ((x as EntityOf<"vehicle">).props.parked = v || !(x as EntityOf<"vehicle">).props.routeId))} />
    </Section>
  );
}

function RoadSection({ e }: { e: EntityOf<"road"> }) {
  const p = e.props;
  const id = e.id;
  return (
    <Section title="Calle">
      <Row label="Tipo">
        <Select value={p.kind} options={ROAD_KINDS} onChange={(v) => edit(id, "Tipo de calle", (x) => void ((x as EntityOf<"road">).props.kind = v))} />
      </Row>
      <Row label="Ancho (m)">
        <NumberField value={p.width} min={1} max={60} step={0.5} onCommit={(v) => edit(id, "Ancho de calle", (x) => void ((x as EntityOf<"road">).props.width = v))} />
      </Row>
      <div className="flex gap-4">
        <Toggle checked={p.markings} label="Demarcación" onChange={(v) => edit(id, "Demarcación", (x) => void ((x as EntityOf<"road">).props.markings = v))} />
        <Toggle checked={p.closed} label="Cerrada" onChange={(v) => edit(id, "Cerrar calle", (x) => void ((x as EntityOf<"road">).props.closed = v))} />
      </div>
      <p className="text-[11px] text-muted">{p.points.length} puntos. Para trazar caminos nuevos usá Herramientas → Camino.</p>
    </Section>
  );
}

function LightSection({ e }: { e: EntityOf<"light"> }) {
  const p = e.props;
  const id = e.id;
  if (p.kind === "sun")
    return (
      <Section title="Sol">
        <p className="text-xs text-muted">La posición del sol depende de la hora del día. Ajustala en Environment o en la pestaña Mundo.</p>
        <Button variant="ghost" icon="sun" onClick={() => useEditor.getState().select(["environment"])}>
          Abrir ambiente
        </Button>
      </Section>
    );
  return (
    <Section title="Luz">
      <Row label="Tipo">
        <Select value={p.kind} options={[{ value: "point", label: "Puntual" }, { value: "spot", label: "Foco" }]} onChange={(v) => edit(id, "Tipo de luz", (x) => void ((x as EntityOf<"light">).props.kind = v as "point"))} />
      </Row>
      <Row label="Color">
        <ColorField value={p.color} onCommit={(v) => edit(id, "Color de luz", (x) => void ((x as EntityOf<"light">).props.color = v))} />
      </Row>
      <Row label="Intensidad">
        <Slider value={p.intensity} min={0} max={100} step={0.5} onPreview={(v) => preview(id, (x) => void ((x as EntityOf<"light">).props.intensity = v))} onCommit={(v) => commitPreview(id, "Intensidad", (x) => void ((x as EntityOf<"light">).props.intensity = v))} />
      </Row>
      <Row label="Alcance (m)">
        <NumberField value={p.distance} min={0} max={1000} step={1} onCommit={(v) => edit(id, "Alcance", (x) => void ((x as EntityOf<"light">).props.distance = v))} />
      </Row>
      {p.kind === "spot" && (
        <Row label="Apertura">
          <NumberField value={p.angle} min={0.05} max={1.5} step={0.05} onCommit={(v) => edit(id, "Apertura", (x) => void ((x as EntityOf<"light">).props.angle = v))} />
        </Row>
      )}
      <Toggle checked={p.castShadow} label="Proyecta sombras" onChange={(v) => edit(id, "Sombras", (x) => void ((x as EntityOf<"light">).props.castShadow = v))} />
    </Section>
  );
}

function CameraSection({ e }: { e: EntityOf<"camera"> }) {
  const id = e.id;
  return (
    <Section title="Cámara">
      <Row label="FOV">
        <NumberField value={e.props.fov} min={10} max={120} step={1} onCommit={(v) => edit(id, "FOV", (x) => void ((x as EntityOf<"camera">).props.fov = v))} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Button
          icon="camera"
          onClick={() => {
            const st = canvasState.current;
            if (!st) return;
            const p = st.camera.position;
            const dir = st.camera.getWorldDirection(p.clone());
            const target = p.clone().addScaledVector(dir, 20);
            edit(id, "Cámara desde la vista", (x) => {
              x.transform.position = [round(p.x), round(p.y), round(p.z)];
              (x as EntityOf<"camera">).props.target = [round(target.x), round(target.y), round(target.z)];
            });
          }}
        >
          Usar vista actual
        </Button>
        <Button
          icon="eye"
          onClick={() => {
            const st = canvasState.current;
            if (!st) return;
            const [x, y, z] = e.transform.position;
            st.camera.position.set(x, y, z);
            st.camera.lookAt(...e.props.target);
            useEditor.setState({ cameraMode: "fly" });
          }}
        >
          Ver por esta cámara
        </Button>
      </div>
    </Section>
  );
}

function MaterialSection({ e }: { e: Entity }) {
  const m: MaterialSpec = e.material ?? DEFAULT_MATERIAL;
  const id = e.id;
  const set = (patch: Partial<MaterialSpec>, label: string) => edit(id, label, (x) => void (x.material = { ...(x.material ?? DEFAULT_MATERIAL), ...patch }));
  return (
    <Section title="Material">
      <Row label="Tipo">
        <Select value={m.preset} options={MATERIAL_PRESETS} onChange={(v) => set({ preset: v, ...presetDefaults(v) }, "Material")} />
      </Row>
      <Row label="Color">
        <ColorField value={m.color} onCommit={(v) => set({ color: v }, "Color")} />
      </Row>
      <Row label="Rugosidad">
        <Slider value={m.roughness} min={0} max={1} onCommit={(v) => set({ roughness: v }, "Rugosidad")} />
      </Row>
      <Row label="Metal">
        <Slider value={m.metalness} min={0} max={1} onCommit={(v) => set({ metalness: v }, "Metalicidad")} />
      </Row>
      <Row label="Emisión">
        <ColorField value={m.emissive} onCommit={(v) => set({ emissive: v }, "Emisión")} />
      </Row>
      <Row label="Brillo">
        <Slider value={m.emissiveIntensity} min={0} max={10} step={0.1} onCommit={(v) => set({ emissiveIntensity: v }, "Intensidad de emisión")} />
      </Row>
      <Row label="Opacidad">
        <Slider value={m.opacity} min={0.05} max={1} onCommit={(v) => set({ opacity: v }, "Opacidad")} />
      </Row>
    </Section>
  );
}

function PhysicsSection({ e }: { e: Entity }) {
  const ph = e.physics ?? { body: "none" as const, mass: 1 };
  const id = e.id;
  return (
    <Section title="Física" defaultOpen={false}>
      <Row label="Cuerpo">
        <Select
          value={ph.body}
          options={[{ value: "none", label: "Sin física" }, { value: "static", label: "Estático" }, { value: "dynamic", label: "Dinámico" }]}
          onChange={(v) => edit(id, "Física", (x) => void (x.physics = { ...(x.physics ?? { mass: 1 }), body: v }))}
        />
      </Row>
      <Row label="Masa (kg)">
        <NumberField value={ph.mass} min={0.1} max={100000} step={1} onCommit={(v) => edit(id, "Masa", (x) => void (x.physics = { ...(x.physics ?? { body: "none" }), mass: v }))} />
      </Row>
      <p className="text-[11px] text-muted">Los cuerpos dinámicos caen y se empujan en el modo Explorar (solo primitivas).</p>
    </Section>
  );
}

function KeyframeSection({ e }: { e: Entity }) {
  const time = useEditor((s) => s.playback.time);
  const allTracks = useEditor((s) => s.doc?.animation.tracks);
  const tracks = (allTracks ?? NO_TRACKS).filter((t) => t.entityId === e.id);
  const addKey = () => {
    const t = Math.round(time * 100) / 100;
    useEditor.getState().exec(`Clave en ${t}s`, (d) => {
      const ent = d.entities[e.id];
      if (!ent) return;
      for (const prop of ["position", "rotation", "scale"] as const) {
        let track = d.animation.tracks.find((tr) => tr.entityId === e.id && tr.property === prop);
        if (!track) {
          track = { id: `${e.id}_${prop}`, entityId: e.id, property: prop, keys: [] };
          d.animation.tracks.push(track);
        }
        track.keys = upsertKey(track.keys, { t, value: [...ent.transform[prop]], ease: "smooth" });
      }
    });
  };
  return (
    <Section title="Animación" defaultOpen={tracks.length > 0}>
      <p className="text-[11px] text-muted">
        {tracks.length ? `${tracks.reduce((s, t) => s + t.keys.length, 0)} claves en ${tracks.length} pistas.` : "Sin claves."} Mové el cursor de la línea de tiempo, ubicá el objeto y agregá una clave.
      </p>
      <Button icon="diamond" onClick={addKey} testId="add-keyframe">
        Clave de transformación en {time.toFixed(1)} s
      </Button>
    </Section>
  );
}

// ---------- Ajustes globales ----------

function setDoc(label: string, fn: (d: Draft<WorldDoc>) => void) {
  useEditor.getState().exec(label, fn);
}

export function EnvironmentInspector() {
  const env = useEditor((s) => s.doc?.environment);
  const liveTime = useRuntime((s) => s.timeOfDay);
  if (!env) return null;
  return (
    <Section title="Iluminación y ambiente">
      <Row label="Hora del día">
        <Slider
          testId="time-of-day"
          value={env.dayNightCycle ? liveTime : env.timeOfDay}
          min={0}
          max={24}
          step={0.1}
          format={(v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`}
          onPreview={(v) => {
            const s = useEditor.getState();
            if (!s.transientBase) s.beginTransient();
            s.updateTransient((d) => void (d.environment.timeOfDay = v));
          }}
          onCommit={(v) => {
            const s = useEditor.getState();
            if (s.transientBase) s.commitTransient("Hora del día", (d) => void (d.environment.timeOfDay = v));
            else setDoc("Hora del día", (d) => void (d.environment.timeOfDay = v));
          }}
        />
      </Row>
      <div className="grid grid-cols-4 gap-1">
        {[
          ["Amanecer", 6.9],
          ["Día", 13],
          ["Atardecer", 17.3],
          ["Noche", 22],
        ].map(([l, v]) => (
          <button key={l} className="rounded-md bg-surface-2 px-1 py-1 text-[11px] hover:bg-line" onClick={() => setDoc(`Hora: ${l}`, (d) => void (d.environment.timeOfDay = v as number))}>
            {l}
          </button>
        ))}
      </div>
      <Toggle checked={env.dayNightCycle} label="Ciclo día/noche" onChange={(v) => setDoc("Ciclo día/noche", (d) => void (d.environment.dayNightCycle = v))} />
      <Row label="Duración (min)">
        <NumberField value={env.cycleMinutes} min={0.5} max={240} step={0.5} onCommit={(v) => setDoc("Duración del ciclo", (d) => void (d.environment.cycleMinutes = v))} />
      </Row>
      <Row label="Sol">
        <Slider value={env.sunIntensity} min={0} max={6} step={0.1} onCommit={(v) => setDoc("Intensidad del sol", (d) => void (d.environment.sunIntensity = v))} />
      </Row>
      <Row label="Ambiente">
        <Slider value={env.ambientIntensity} min={0} max={3} step={0.05} onCommit={(v) => setDoc("Luz ambiente", (d) => void (d.environment.ambientIntensity = v))} />
      </Row>
      <Row label="Niebla">
        <Slider value={env.fogDensity} min={0} max={0.05} step={0.0005} format={(v) => v.toFixed(4)} onCommit={(v) => setDoc("Niebla", (d) => void (d.environment.fogDensity = v))} />
      </Row>
      <Row label="Exposición">
        <Slider value={env.exposure} min={0.2} max={3} step={0.05} onCommit={(v) => setDoc("Exposición", (d) => void (d.environment.exposure = v))} />
      </Row>
      <Row label="Cielo">
        <Select value={env.sky} options={[{ value: "earth", label: "Terrestre" }, { value: "dusk", label: "Crepuscular" }, { value: "alien", label: "Alienígena" }]} onChange={(v) => setDoc("Cielo", (d) => void (d.environment.sky = v))} />
      </Row>
    </Section>
  );
}

export function WeatherInspector() {
  const w = useEditor((s) => s.doc?.weather);
  if (!w) return null;
  const LABEL: Record<string, string> = { clear: "Despejado", cloudy: "Nublado", rain: "Lluvia", storm: "Tormenta", snow: "Nieve", fog: "Niebla", sandstorm: "Tormenta de arena" };
  return (
    <Section title="Clima">
      <div className="grid grid-cols-4 gap-1">
        {WEATHER_TYPES.map((t) => (
          <button
            key={t}
            data-testid={`weather-${t}`}
            className={`rounded-md px-1 py-1.5 text-[10px] ${w.type === t ? "bg-accent/25 text-text ring-1 ring-accent/60" : "bg-surface-2 text-muted hover:bg-line"}`}
            onClick={() => useEditor.getState().applyOperations(`Clima: ${LABEL[t]}`, [{ operation: "set_weather", type: t }], "Inspector")}
          >
            {LABEL[t]}
          </button>
        ))}
      </div>
      <Row label="Intensidad">
        <Slider value={w.intensity} min={0} max={1} onCommit={(v) => setDoc("Intensidad del clima", (d) => void (d.weather.intensity = v))} />
      </Row>
      <Row label="Viento">
        <Slider value={w.wind} min={0} max={1} onCommit={(v) => setDoc("Viento", (d) => void (d.weather.wind = v))} />
      </Row>
      <Row label="Nubes">
        <Slider value={w.clouds} min={0} max={1} onCommit={(v) => setDoc("Nubes", (d) => void (d.weather.clouds = v))} />
      </Row>
      <Row label="Humedad">
        <Slider value={w.wetness} min={0} max={1} onCommit={(v) => setDoc("Superficies mojadas", (d) => void (d.weather.wetness = v))} />
      </Row>
    </Section>
  );
}

export function TerrainInspector() {
  const t = useEditor((s) => s.doc?.terrain);
  if (!t) return null;
  return (
    <>
      <Section title="Terreno">
        <p className="text-xs text-muted">
          {t.size} m × {t.size} m · {t.resolution}² celdas en {64} sectores con 3 niveles de detalle
        </p>
        <Row label="Bioma">
          <Select value={t.biome} options={BIOMES} onChange={(v) => useEditor.getState().applyOperations("Bioma", [{ operation: "modify_terrain", action: "set_biome", biome: v }], "Inspector")} />
        </Row>
        <Toggle checked={t.waterEnabled} label="Agua" onChange={(v) => setDoc("Agua", (d) => void (d.terrain.waterEnabled = v))} />
        <Row label="Nivel del agua">
          <NumberField value={t.waterLevel} min={-100} max={500} step={0.5} onCommit={(v) => setDoc("Nivel del agua", (d) => void (d.terrain.waterLevel = v))} />
        </Row>
        <Row label="Línea de nieve">
          <NumberField value={t.snowLine} min={-1000} max={1000} step={1} onCommit={(v) => setDoc("Línea de nieve", (d) => void (d.terrain.snowLine = v))} />
        </Row>
        <Button icon="brush" variant="primary" onClick={() => useEditor.getState().setTool("terrain")} className="w-full">
          Esculpir y pintar terreno
        </Button>
      </Section>
    </>
  );
}

export function WorldSettings() {
  const doc = useEditor((s) => s.doc);
  if (!doc) return null;
  return (
    <div className="pb-6">
      <EnvironmentInspector />
      <WeatherInspector />
      <TerrainInspector />
      <Section title="Simulación">
        <Toggle checked={doc.simulation.npcs} label="Personajes activos" onChange={(v) => setDoc("Simulación de personajes", (d) => void (d.simulation.npcs = v))} />
        <Toggle checked={doc.simulation.traffic} label="Tránsito activo" onChange={(v) => setDoc("Simulación de tránsito", (d) => void (d.simulation.traffic = v))} />
        <p className="text-[11px] text-muted">
          {doc.routes.length} rutas · {doc.intersections.filter((i) => i.hasLights).length} cruces con semáforo · {doc.navigation.nodes.length} nodos peatonales
        </p>
      </Section>
      <Section title="Proyecto" defaultOpen={false}>
        <p className="text-[11px] break-words text-muted">
          <Icon name="sparkles" size={12} className="mr-1 inline" />
          {doc.prompt || "Mundo creado manualmente"}
        </p>
        <p className="text-[11px] text-muted">Semilla {doc.seed} · formato v{doc.formatVersion}</p>
      </Section>
    </div>
  );
}
