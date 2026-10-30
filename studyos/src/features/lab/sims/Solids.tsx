import { useState } from 'react';
import { Grid } from '@react-three/drei';
import { Select, Slider, Toggle } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { Readout, SimCanvas, SimLayout, fmt } from '../shared';

const SOLIDS = ['Cubo', 'Prisma rectangular', 'Cilindro', 'Cono', 'Esfera', 'Pirámide de base cuadrada'];

function calc(i: number, a: number, b: number, h: number) {
  switch (i) {
    case 0:
      return { V: a ** 3, A: 6 * a * a, fV: 'V = a^3', fA: 'A = 6a^2' };
    case 1:
      return { V: a * b * h, A: 2 * (a * b + a * h + b * h), fV: 'V = a \\cdot b \\cdot h', fA: 'A = 2(ab + ah + bh)' };
    case 2:
      return { V: Math.PI * a * a * h, A: 2 * Math.PI * a * (a + h), fV: 'V = \\pi r^2 h', fA: 'A = 2\\pi r(r + h)' };
    case 3: {
      const g = Math.sqrt(a * a + h * h);
      return { V: (Math.PI * a * a * h) / 3, A: Math.PI * a * (a + g), fV: 'V = \\tfrac{1}{3}\\pi r^2 h', fA: 'A = \\pi r(r + g),\\ g = \\sqrt{r^2 + h^2}' };
    }
    case 4:
      return { V: (4 / 3) * Math.PI * a ** 3, A: 4 * Math.PI * a * a, fV: 'V = \\tfrac{4}{3}\\pi r^3', fA: 'A = 4\\pi r^2' };
    default: {
      const ap = Math.sqrt((a / 2) ** 2 + h * h);
      return { V: (a * a * h) / 3, A: a * a + 2 * a * ap, fV: 'V = \\tfrac{1}{3}a^2 h', fA: 'A = a^2 + 2a\\,a_p,\\ a_p = \\sqrt{(a/2)^2 + h^2}' };
    }
  }
}

export default function Solids({ params }: { params?: Record<string, number> }) {
  const [i, setI] = useState(Math.min(5, Math.max(0, Math.round(params?.solid ?? 0))));
  const [a, setA] = useState(params?.a ?? 2);
  const [b, setB] = useState(params?.b ?? 3);
  const [h, setH] = useState(params?.h ?? 3);
  const [wire, setWire] = useState(false);
  const r = calc(i, a, b, h);
  const k = 2.6 / Math.max(a, b, h, 1);
  const mat = <meshStandardMaterial color="#5b7bff" transparent opacity={wire ? 1 : 0.85} wireframe={wire} metalness={0.2} roughness={0.35} />;
  const labelA = i === 2 || i === 3 || i === 4 ? 'Radio r' : 'Lado a';
  return (
    <SimLayout
      canvas={
        <SimCanvas camera={[5, 4, 6]} target={[0, 1.2, 0]}>
          <Grid args={[10, 10]} cellColor="#22305c" sectionColor="#3d5bff" infiniteGrid fadeDistance={25} />
          <group scale={k}>
            {i === 0 && (
              <mesh position={[0, a / 2, 0]}>
                <boxGeometry args={[a, a, a]} />
                {mat}
              </mesh>
            )}
            {i === 1 && (
              <mesh position={[0, h / 2, 0]}>
                <boxGeometry args={[a, h, b]} />
                {mat}
              </mesh>
            )}
            {i === 2 && (
              <mesh position={[0, h / 2, 0]}>
                <cylinderGeometry args={[a, a, h, 48]} />
                {mat}
              </mesh>
            )}
            {i === 3 && (
              <mesh position={[0, h / 2, 0]}>
                <coneGeometry args={[a, h, 48]} />
                {mat}
              </mesh>
            )}
            {i === 4 && (
              <mesh position={[0, a, 0]}>
                <sphereGeometry args={[a, 48, 48]} />
                {mat}
              </mesh>
            )}
            {i === 5 && (
              <mesh position={[0, h / 2, 0]} rotation={[0, Math.PI / 4, 0]}>
                <coneGeometry args={[a / Math.SQRT2, h, 4]} />
                {mat}
              </mesh>
            )}
          </group>
        </SimCanvas>
      }
      panel={
        <>
          <Select value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Sólido">
            {SOLIDS.map((s, j) => (
              <option key={s} value={j}>
                {s}
              </option>
            ))}
          </Select>
          <Slider label={labelA} value={a} min={0.5} max={6} step={0.1} onChange={setA} format={(v) => `${fmt(v, 1)} cm`} />
          {i === 1 && <Slider label="Lado b" value={b} min={0.5} max={6} step={0.1} onChange={setB} format={(v) => `${fmt(v, 1)} cm`} />}
          {i !== 0 && i !== 4 && <Slider label="Altura h" value={h} min={0.5} max={8} step={0.1} onChange={setH} format={(v) => `${fmt(v, 1)} cm`} />}
          <Toggle label="Ver aristas" checked={wire} onChange={setWire} />
          <Readout items={[{ label: 'Volumen', value: `${fmt(r.V)} cm³` }, { label: 'Área total', value: `${fmt(r.A)} cm²` }]} />
          <Markdown className="!text-[13px]">{`$$${r.fV}$$ $$${r.fA}$$`}</Markdown>
        </>
      }
    />
  );
}
