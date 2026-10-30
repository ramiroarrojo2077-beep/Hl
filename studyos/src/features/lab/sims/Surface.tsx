import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Grid } from '@react-three/drei';
import { Input, Slider, Toggle } from '@/components/ui';
import { tryCompile } from '@/lib/mathexpr';
import { SimCanvas, SimLayout, Simplified } from '../shared';

const PRESETS = ['sin(x)*cos(y)', 'a*(x^2 - y^2)/4', 'exp(-(x^2+y^2)/b)*3', 'sin(sqrt(x^2+y^2)*a)', 'a*x*y/4'];

function SurfaceMesh({ expr, a, b, range, wire }: { expr: string; a: number; b: number; range: number; wire: boolean }) {
  const geo = useMemo(() => {
    const { fn } = tryCompile(expr, ['x', 'y', 'a', 'b']);
    const n = 80;
    const g = new THREE.PlaneGeometry(8, 8, n, n);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    let min = Infinity;
    let max = -Infinity;
    const zs: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = (pos.getX(i) / 4) * range;
      const y = (pos.getZ(i) / 4) * range;
      let z = fn ? fn({ x, y, a, b }) : 0;
      if (!Number.isFinite(z)) z = 0;
      z = Math.max(-50, Math.min(50, z));
      zs.push(z);
      min = Math.min(min, z);
      max = Math.max(max, z);
    }
    const span = max - min || 1;
    const k = Math.min(1, 4 / span);
    const c = new THREE.Color();
    zs.forEach((z, i) => {
      pos.setY(i, z * k);
      c.setHSL(0.66 - ((z - min) / span) * 0.55, 0.8, 0.55);
      colors.push(c.r, c.g, c.b);
    });
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [expr, a, b, range]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} wireframe={wire} roughness={0.6} />
    </mesh>
  );
}

export default function Surface({ params }: { params?: Record<string, number> }) {
  const [expr, setExpr] = useState('sin(x)*cos(y)');
  const [a, setA] = useState(params?.a ?? 1);
  const [b, setB] = useState(params?.b ?? 2);
  const [range, setRange] = useState(4);
  const [wire, setWire] = useState(false);
  const check = tryCompile(expr, ['x', 'y', 'a', 'b']);
  return (
    <SimLayout
      canvas={
        <SimCanvas camera={[7, 7, 9]} target={[0, 0, 0]}>
          <Grid args={[10, 10]} cellColor="#22305c" sectionColor="#3d5bff" position={[0, -2.05, 0]} />
          {check.fn && <SurfaceMesh expr={expr} a={a} b={b} range={range} wire={wire} />}
        </SimCanvas>
      }
      panel={
        <>
          <label className="block">
            <span className="text-xs text-muted">z = f(x, y)</span>
            <Input value={expr} onChange={(e) => setExpr(e.target.value)} className="font-mono mt-1" aria-label="Función" />
          </label>
          {check.error && <p className="text-xs text-bad">{check.error}</p>}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => setExpr(p)} className="text-[11px] font-mono rounded-full border border-line px-2 py-1 text-muted hover:text-ink">
                {p}
              </button>
            ))}
          </div>
          <Slider label="Parámetro a" value={a} min={-3} max={3} step={0.1} onChange={setA} />
          <Slider label="Parámetro b" value={b} min={0.2} max={6} step={0.1} onChange={setB} />
          <Slider label="Rango de x e y" value={range} min={1} max={10} step={0.5} onChange={setRange} format={(v) => `[-${v}, ${v}]`} />
          <Toggle label="Malla de alambre" checked={wire} onChange={setWire} />
          <p className="text-[13px] text-[#cdd5f0]">Funciones disponibles: sin, cos, tan, sqrt, exp, ln, log, abs y potencias con ^. El color indica la altura (azul bajo, rojo alto).</p>
          <Simplified>La altura se reescala para que la superficie entre en la vista; los valores muy grandes se recortan a ±50.</Simplified>
        </>
      }
    />
  );
}
