"use client";

import { useEffect, useRef, useState } from "react";
import { renderThumbnail } from "@/engine/models/preview";
import type { EntityType } from "@/engine/types";
import { addFromLibrary, importModelFile } from "./actions";
import { cx } from "../ui/controls";
import { Icon } from "../ui/Icon";

interface Item {
  type: EntityType;
  variant?: string;
  label: string;
}

export const LIBRARY: { id: string; label: string; items: Item[] }[] = [
  {
    id: "arch",
    label: "Arquitectura",
    items: [
      { type: "building", variant: "house", label: "Casa" },
      { type: "building", variant: "apartment", label: "Departamentos" },
      { type: "building", variant: "office", label: "Oficinas" },
      { type: "building", variant: "skyscraper", label: "Rascacielos" },
      { type: "building", variant: "shop", label: "Comercio" },
      { type: "building", variant: "school", label: "Escuela" },
      { type: "building", variant: "hospital", label: "Hospital" },
      { type: "building", variant: "station", label: "Estación" },
      { type: "building", variant: "mall", label: "Shopping" },
      { type: "building", variant: "stadium", label: "Estadio" },
      { type: "building", variant: "temple", label: "Templo" },
    ],
  },
  {
    id: "nature",
    label: "Naturaleza",
    items: [
      { type: "tree", variant: "oak", label: "Roble" },
      { type: "tree", variant: "pine", label: "Pino" },
      { type: "tree", variant: "birch", label: "Abedul" },
      { type: "tree", variant: "palm", label: "Palmera" },
      { type: "tree", variant: "cypress", label: "Ciprés" },
      { type: "tree", variant: "sakura", label: "Cerezo" },
      { type: "plant", variant: "bush", label: "Arbusto" },
      { type: "plant", variant: "flowers", label: "Flores" },
      { type: "plant", variant: "grass", label: "Pasto" },
      { type: "plant", variant: "fern", label: "Helecho" },
      { type: "rock", label: "Roca" },
    ],
  },
  {
    id: "furniture",
    label: "Mobiliario",
    items: [
      { type: "prop", variant: "bench", label: "Banco" },
      { type: "prop", variant: "trash_bin", label: "Cesto" },
      { type: "prop", variant: "hydrant", label: "Hidrante" },
      { type: "prop", variant: "fountain", label: "Fuente" },
      { type: "prop", variant: "well", label: "Aljibe" },
      { type: "prop", variant: "statue", label: "Estatua" },
      { type: "prop", variant: "traffic_light", label: "Semáforo" },
    ],
  },
  {
    id: "transport",
    label: "Transporte",
    items: [
      { type: "vehicle", variant: "sedan", label: "Sedán" },
      { type: "vehicle", variant: "suv", label: "SUV" },
      { type: "vehicle", variant: "taxi", label: "Taxi" },
      { type: "vehicle", variant: "van", label: "Furgoneta" },
      { type: "vehicle", variant: "bus", label: "Colectivo" },
      { type: "vehicle", variant: "truck", label: "Camión" },
      { type: "vehicle", variant: "sports", label: "Deportivo" },
      { type: "vehicle", variant: "motorcycle", label: "Moto" },
      { type: "vehicle", variant: "race", label: "Carrera" },
    ],
  },
  {
    id: "characters",
    label: "Personajes",
    items: [
      { type: "npc", variant: "casual", label: "Peatón" },
      { type: "npc", variant: "formal", label: "Oficinista" },
      { type: "npc", variant: "worker", label: "Obrero" },
      { type: "npc", variant: "medieval", label: "Aldeano" },
      { type: "npc", variant: "knight", label: "Caballero" },
      { type: "npc", variant: "explorer", label: "Explorador" },
      { type: "npc", variant: "tropical", label: "Turista" },
      { type: "npc", variant: "racer", label: "Piloto" },
      { type: "npc", variant: "futuristic", label: "Futurista" },
      { type: "npc", variant: "elf", label: "Elfo" },
    ],
  },
  {
    id: "decor",
    label: "Decoración",
    items: [
      { type: "prop", variant: "barrel", label: "Barril" },
      { type: "prop", variant: "crate", label: "Cajón" },
      { type: "prop", variant: "fence", label: "Cerca" },
      { type: "prop", variant: "parasol", label: "Sombrilla" },
      { type: "prop", variant: "stall", label: "Puesto" },
      { type: "prop", variant: "billboard", label: "Cartel" },
      { type: "prop", variant: "pier", label: "Muelle" },
    ],
  },
  {
    id: "scifi",
    label: "Ciencia ficción",
    items: [
      { type: "building", variant: "futuristic", label: "Torre futurista" },
      { type: "building", variant: "dome", label: "Domo" },
      { type: "building", variant: "lab", label: "Laboratorio" },
      { type: "vehicle", variant: "hover", label: "Auto flotante" },
      { type: "vehicle", variant: "rover", label: "Rover" },
      { type: "vehicle", variant: "ship", label: "Nave" },
      { type: "prop", variant: "antenna", label: "Antena" },
      { type: "prop", variant: "landing_pad", label: "Plataforma" },
    ],
  },
  {
    id: "fantasy",
    label: "Fantasía",
    items: [
      { type: "building", variant: "castle", label: "Castillo" },
      { type: "building", variant: "tower", label: "Torre" },
      { type: "building", variant: "hut", label: "Cabaña" },
      { type: "tree", variant: "giant", label: "Árbol gigante" },
      { type: "plant", variant: "mushroom", label: "Hongos" },
      { type: "plant", variant: "crystal", label: "Cristales" },
      { type: "prop", variant: "waterfall", label: "Cascada" },
    ],
  },
  {
    id: "industrial",
    label: "Industrial",
    items: [
      { type: "building", variant: "factory", label: "Fábrica" },
      { type: "prop", variant: "tire_stack", label: "Neumáticos" },
      { type: "prop", variant: "light_tower", label: "Torre de luz" },
      { type: "building", variant: "pit", label: "Boxes" },
      { type: "building", variant: "grandstand", label: "Tribuna" },
    ],
  },
  {
    id: "lighting",
    label: "Iluminación",
    items: [
      { type: "light", variant: "point", label: "Luz puntual" },
      { type: "light", variant: "spot", label: "Foco" },
      { type: "prop", variant: "streetlight", label: "Farola" },
      { type: "prop", variant: "lantern", label: "Farol" },
      { type: "prop", variant: "torch", label: "Antorcha" },
    ],
  },
  {
    id: "primitives",
    label: "Primitivas",
    items: [
      { type: "primitive", variant: "box", label: "Cubo" },
      { type: "primitive", variant: "sphere", label: "Esfera" },
      { type: "primitive", variant: "cylinder", label: "Cilindro" },
      { type: "primitive", variant: "cone", label: "Cono" },
      { type: "primitive", variant: "torus", label: "Toroide" },
      { type: "primitive", variant: "capsule", label: "Cápsula" },
      { type: "primitive", variant: "plane", label: "Plano" },
    ],
  },
];

function Thumb({ item }: { item: Item }) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        // Se genera de a una para no bloquear la interfaz.
        const id = requestIdleCallbackSafe(() => setSrc(renderThumbnail(item.type, item.variant)));
        return () => cancelIdleSafe(id);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [item.type, item.variant]);
  return (
    <div ref={ref} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-surface-2 to-surface">
      {src ? <img src={src} alt="" className="h-full w-full object-contain" draggable={false} /> : <Icon name="cube" size={20} className="text-line" />}
    </div>
  );
}

function requestIdleCallbackSafe(fn: () => void): number {
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
  return w.requestIdleCallback ? w.requestIdleCallback(fn) : window.setTimeout(fn, 30);
}
function cancelIdleSafe(id: number) {
  const w = window as Window & { cancelIdleCallback?: (id: number) => void };
  if (w.cancelIdleCallback) w.cancelIdleCallback(id);
  else clearTimeout(id);
}

/** Biblioteca de objetos con vistas previas reales; arrastrar al visor o tocar para agregar. */
export function LibraryPanel() {
  const [cat, setCat] = useState("arch");
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const items = q.trim()
    ? LIBRARY.flatMap((c) => c.items).filter((i) => i.label.toLowerCase().includes(q.toLowerCase()) || (i.variant ?? i.type).includes(q.toLowerCase()))
    : (LIBRARY.find((c) => c.id === cat)?.items ?? []);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="library">
      <div className="space-y-2 px-2 py-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Buscar en la biblioteca…" className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent" />
        {!q && (
          <div className="flex flex-wrap gap-1">
            {LIBRARY.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className={cx("rounded-full px-2 py-0.5 text-[11px]", cat === c.id ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-text")}>
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-2 overflow-auto px-2 pb-2">
        {items.map((it) => (
          <button
            key={`${it.type}-${it.variant}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/x-worldforge", JSON.stringify({ type: it.type, variant: it.variant }))}
            onClick={() => addFromLibrary(it.type, it.variant)}
            className="group space-y-1 rounded-lg p-1 text-left hover:bg-surface-2"
            title="Tocá para agregar en el centro de la vista o arrastrá al visor"
            data-testid={`lib-${it.type}-${it.variant ?? ""}`}
          >
            <Thumb item={it} />
            <p className="truncate text-[11px] text-muted group-hover:text-text">{it.label}</p>
          </button>
        ))}
      </div>
      <div className="border-t border-line p-2">
        <input ref={fileRef} type="file" accept=".glb,.gltf,model/gltf-binary" className="hidden" onChange={(e) => e.target.files?.[0] && void importModelFile(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2 text-xs text-muted hover:border-accent hover:text-text">
          <Icon name="upload" size={14} />
          Importar modelo GLB/glTF
        </button>
        <p className="mt-1 text-center text-[10px] text-muted/70">Usá recursos propios o con licencia que permita su uso.</p>
      </div>
    </div>
  );
}
