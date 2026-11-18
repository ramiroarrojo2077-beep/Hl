import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import { useEngine } from "../context.ts";
import { cameraState } from "../../state/store.ts";
import { lonLatToTilePixel } from "../../geo/tiles.ts";
import { t } from "../../i18n/index.ts";

const TILE = 256;
const cache = new Map<string, HTMLImageElement>();

function tileImage(z: number, x: number, y: number, onload: () => void): HTMLImageElement {
  const key = `${z}/${x}/${y}`;
  let img = cache.get(key);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = onload;
    img.src = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
    cache.set(key, img);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return img;
}

/** Minimapa 2D con la posición y el rumbo de la cámara; clic para saltar. */
export function Minimap() {
  const engine = useEngine();
  const ref = useRef<HTMLCanvasElement>(null);
  const zRef = useRef(2);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const c = ref.current;
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== w * dpr) {
          c.width = w * dpr;
          c.height = h * dpr;
        }
        const g = c.getContext("2d")!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = "#0a1a2e";
        g.fillRect(0, 0, w, h);
        const cam = cameraState.value;
        // Zoom del minimapa unos niveles por debajo de la vista 3D
        const z = Math.max(0, Math.min(14, Math.round(Math.log2(40_000_000 / Math.max(500, cam.heightAboveGround * 6)))));
        zRef.current = z;
        const { tile, px, py } = lonLatToTilePixel(cam, z);
        const n = 2 ** z;
        const ox = w / 2 - px;
        const oy = h / 2 - py;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const tx = (((tile.x + dx) % n) + n) % n;
            const ty = tile.y + dy;
            if (ty < 0 || ty >= n) continue;
            const img = tileImage(z, tx, ty, draw);
            if (img.complete && img.naturalWidth) g.drawImage(img, ox + dx * TILE, oy + dy * TILE, TILE, TILE);
          }
        }
        // Marcador con rumbo
        g.save();
        g.translate(w / 2, h / 2);
        g.rotate((cam.heading * Math.PI) / 180);
        g.fillStyle = "#38bdf8";
        g.strokeStyle = "#fff";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, -11);
        g.lineTo(7, 8);
        g.lineTo(0, 4);
        g.lineTo(-7, 8);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
        g.fillStyle = "rgba(0,0,0,.55)";
        g.fillRect(0, h - 14, w, 14);
        g.fillStyle = "#cbd5e1";
        g.font = "9px system-ui";
        g.fillText("© Esri, HERE, Garmin, OSM", 4, h - 4);
      });
    };
    const dispose = effect(() => {
      void cameraState.value;
      draw();
    });
    return () => {
      dispose();
      cancelAnimationFrame(raf);
    };
  }, []);

  const onClick = (e: MouseEvent) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const cam = cameraState.value;
    const z = zRef.current;
    const scale = 360 / (TILE * 2 ** z);
    const dxPx = e.clientX - r.left - r.width / 2;
    const dyPx = e.clientY - r.top - r.height / 2;
    const lon = cam.lon + dxPx * scale;
    // Aproximación Mercator local para la latitud
    const lat = cam.lat - (dyPx * scale) * Math.cos((cam.lat * Math.PI) / 180);
    void engine.flyTo({ lon, lat, height: cam.height, heading: cam.heading, pitch: cam.pitch, duration: 1 });
  };

  return (
    <div class="minimap glass" title={t("Minimapa: clic para desplazarte")}>
      <canvas ref={ref} onClick={onClick} aria-label={t("Minimapa")} />
    </div>
  );
}
