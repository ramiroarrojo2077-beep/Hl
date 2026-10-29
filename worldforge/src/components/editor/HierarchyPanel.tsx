"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { reparent } from "@/engine/scene/doc";
import { PROTECTED_TYPES, type Entity, type WorldDoc } from "@/engine/types";
import { useEditor } from "@/store/editor";
import { Icon, type IconName } from "../ui/Icon";
import { cx } from "../ui/controls";

const ROW = 26;

const TYPE_ICON: Partial<Record<Entity["type"], IconName>> = {
  world: "globe",
  folder: "folder",
  group: "group",
  terrain: "mountain",
  environment: "sun",
  weather: "rain",
  building: "building",
  tree: "tree",
  plant: "tree",
  rock: "cube",
  prop: "bulb",
  npc: "user",
  vehicle: "car",
  road: "route",
  block: "grid",
  light: "bulb",
  camera: "camera",
  primitive: "cube",
  model: "cube",
  spawn: "compass",
};

interface RowData {
  id: string;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

/** Jerarquía de objetos con lista virtualizada, búsqueda y arrastrar para reordenar. */
export function HierarchyPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["world"]));
  const [query, setQuery] = useState("");
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const lastClicked = useRef<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Al seleccionar desde el visor, abre los ancestros para que se vea la fila.
  useEffect(() => {
    if (!doc || !selection.length) return;
    const next = new Set(open);
    let changed = false;
    for (const id of selection.slice(0, 5)) {
      let cur = doc.entities[id]?.parentId ?? null;
      while (cur) {
        if (!next.has(cur)) {
          next.add(cur);
          changed = true;
        }
        cur = doc.entities[cur]?.parentId ?? null;
      }
    }
    if (changed) setOpen(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, doc?.id]);

  const rows = useMemo<RowData[]>(() => {
    if (!doc) return [];
    const out: RowData[] = [];
    const q = query.trim().toLowerCase();
    if (q) {
      for (const e of Object.values(doc.entities)) if (e.name.toLowerCase().includes(q) || e.type.includes(q)) out.push({ id: e.id, depth: 0, hasChildren: false, open: false });
      return out.slice(0, 5000);
    }
    const visit = (id: string, depth: number) => {
      const e = doc.entities[id];
      if (!e) return;
      const isOpen = open.has(id);
      out.push({ id, depth, hasChildren: e.children.length > 0, open: isOpen });
      if (isOpen) for (const c of e.children) visit(c, depth + 1);
    };
    visit(doc.rootId, 0);
    return out;
  }, [doc, open, query]);

  if (!doc) return null;
  const selected = new Set(selection);
  const first = Math.max(0, Math.floor(scroll / ROW) - 5);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + 5);

  const toggle = (id: string) => {
    const next = new Set(open);
    next.has(id) ? next.delete(id) : next.add(id);
    setOpen(next);
  };

  const onRowClick = (e: React.MouseEvent, id: string) => {
    const s = useEditor.getState();
    if (e.shiftKey && lastClicked.current) {
      const a = rows.findIndex((r) => r.id === lastClicked.current);
      const b = rows.findIndex((r) => r.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        s.select(rows.slice(lo, hi + 1).map((r) => r.id), "add");
        return;
      }
    }
    s.select([id], e.ctrlKey || e.metaKey ? "toggle" : "replace");
    lastClicked.current = id;
  };

  const drop = (target: string) => {
    const s = useEditor.getState();
    if (!dragId || dragId === target || !s.doc) return;
    const t = s.doc.entities[target];
    if (!t || (t.type !== "folder" && t.type !== "group" && t.type !== "world")) return;
    const ids = selection.includes(dragId) ? selection : [dragId];
    s.exec(`Mover a ${t.name}`, (d) => {
      for (const id of ids) {
        const e = d.entities[id];
        if (e && !PROTECTED_TYPES.has(e.type)) reparent(d as WorldDoc, id, target);
      }
    });
    setDragId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="relative flex-1">
          <Icon name="search" size={14} className="absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Buscar objetos…"
            data-testid="hierarchy-search"
            className="w-full rounded-md border border-line bg-surface py-1.5 pr-2 pl-7 text-xs outline-none focus:border-accent"
          />
        </div>
        <span className="text-[10px] text-muted tabular-nums">{Object.keys(doc.entities).length}</span>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 overflow-auto" onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)} data-testid="hierarchy">
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {rows.slice(first, last).map((r, i) => {
            const e = doc.entities[r.id]!;
            const idx = first + i;
            const isSel = selected.has(r.id);
            return (
              <div
                key={r.id}
                data-testid={`row-${e.name}`}
                draggable={!PROTECTED_TYPES.has(e.type)}
                onDragStart={() => setDragId(r.id)}
                onDragOver={(ev) => {
                  if (e.type === "folder" || e.type === "group" || e.type === "world") ev.preventDefault();
                }}
                onDrop={() => drop(r.id)}
                onClick={(ev) => onRowClick(ev, r.id)}
                onDoubleClick={() => {
                  useEditor.getState().select([r.id]);
                  useEditor.getState().setUi({ focusToken: Date.now() });
                }}
                className={cx(
                  "group absolute right-0 left-0 flex cursor-default items-center gap-1 pr-1 text-xs select-none",
                  isSel ? "bg-accent/20 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
                  !e.visible && "opacity-50",
                )}
                style={{ top: idx * ROW, height: ROW, paddingLeft: 6 + r.depth * 14 }}
              >
                <button
                  className={cx("flex h-5 w-4 items-center justify-center", !r.hasChildren && "invisible")}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    toggle(r.id);
                  }}
                  aria-label={r.open ? "Contraer" : "Expandir"}
                >
                  <Icon name={r.open ? "chevronDown" : "chevronRight"} size={12} />
                </button>
                <Icon name={TYPE_ICON[e.type] ?? "cube"} size={13} className={cx(isSel ? "text-accent-2" : "text-muted")} />
                {renaming === r.id ? (
                  <input
                    autoFocus
                    defaultValue={e.name}
                    className="min-w-0 flex-1 rounded border border-accent bg-surface px-1 text-xs outline-none"
                    onClick={(ev) => ev.stopPropagation()}
                    onKeyDown={(ev) => {
                      ev.stopPropagation();
                      if (ev.key === "Enter") {
                        useEditor.getState().rename(r.id, (ev.target as HTMLInputElement).value);
                        setRenaming(null);
                      }
                      if (ev.key === "Escape") setRenaming(null);
                    }}
                    onBlur={(ev) => {
                      useEditor.getState().rename(r.id, ev.target.value);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <span
                    className="min-w-0 flex-1 truncate"
                    onDoubleClick={(ev) => {
                      if (PROTECTED_TYPES.has(e.type)) return;
                      ev.stopPropagation();
                      setRenaming(r.id);
                    }}
                  >
                    {e.name}
                    {r.hasChildren && !r.open && <span className="ml-1 text-[10px] text-muted/70">({e.children.length})</span>}
                  </span>
                )}
                {e.type !== "world" && (
                  <>
                    <button
                      className={cx("rounded p-0.5 hover:text-text", e.locked ? "text-warn" : "opacity-0 group-hover:opacity-100")}
                      title={e.locked ? "Desbloquear" : "Bloquear"}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        useEditor.getState().toggleLock([r.id]);
                      }}
                    >
                      <Icon name={e.locked ? "lock" : "unlock"} size={12} />
                    </button>
                    <button
                      className={cx("rounded p-0.5 hover:text-text", !e.visible ? "text-text" : "opacity-0 group-hover:opacity-100")}
                      title={e.visible ? "Ocultar" : "Mostrar"}
                      data-testid={`vis-${e.name}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        useEditor.getState().toggleVisibility([r.id]);
                      }}
                    >
                      <Icon name={e.visible ? "eye" : "eyeOff"} size={12} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
