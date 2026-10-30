import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { Segmented, Select, Slider, Toggle } from '@/components/ui';
import { PlayBar, Readout, SimCanvas, SimLayout, Simplified, fmt } from '../shared';

const PLANETS = [
  { name: 'Mercurio', a: 0.387, T: 87.97, r: 0.38, c: '#a8a29e' },
  { name: 'Venus', a: 0.723, T: 224.7, r: 0.95, c: '#fcd34d' },
  { name: 'Tierra', a: 1, T: 365.26, r: 1, c: '#3b82f6' },
  { name: 'Marte', a: 1.524, T: 686.98, r: 0.53, c: '#ef4444' },
  { name: 'Júpiter', a: 5.203, T: 4332.6, r: 11.2, c: '#f59e0b' },
  { name: 'Saturno', a: 9.537, T: 10759, r: 9.45, c: '#fde68a' },
  { name: 'Urano', a: 19.19, T: 30687, r: 4.0, c: '#67e8f9' },
  { name: 'Neptuno', a: 30.07, T: 60190, r: 3.88, c: '#6366f1' },
];

function dist(a: number, mode: 'compressed' | 'linear') {
  return mode === 'linear' ? a * 1.2 : 2 + Math.sqrt(a) * 4.2;
}

function System({ days, mode, labels }: { days: number; mode: 'compressed' | 'linear'; labels: boolean }) {
  const orbits = useMemo(
    () =>
      PLANETS.map((p) =>
        Array.from({ length: 129 }, (_, i) => {
          const t = (i / 128) * Math.PI * 2;
          const d = dist(p.a, mode);
          return [Math.cos(t) * d, 0, Math.sin(t) * d] as [number, number, number];
        }),
      ),
    [mode],
  );
  return (
    <>
      <Stars radius={150} depth={50} count={2500} factor={4} fade />
      <mesh>
        <sphereGeometry args={[1.1, 48, 48]} />
        <meshBasicMaterial color="#ffcf5c" />
      </mesh>
      <pointLight intensity={400} distance={0} decay={1.5} color="#fff4d6" />
      {PLANETS.map((p, i) => {
        const ang = (days / p.T) * Math.PI * 2;
        const d = dist(p.a, mode);
        const size = 0.12 + Math.cbrt(p.r) * 0.18;
        return (
          <group key={p.name}>
            <Line points={orbits[i]} color="#c7c2ff" transparent opacity={0.25} lineWidth={1} />
            <group position={[Math.cos(ang) * d, 0, -Math.sin(ang) * d]}>
              <mesh>
                <sphereGeometry args={[size, 32, 32]} />
                <meshStandardMaterial color={p.c} roughness={0.8} />
              </mesh>
              {p.name === 'Saturno' && (
                <mesh rotation={[Math.PI / 2.4, 0, 0]}>
                  <ringGeometry args={[size * 1.3, size * 2.1, 48]} />
                  <meshBasicMaterial color="#e7d3a8" side={THREE.DoubleSide} transparent opacity={0.7} />
                </mesh>
              )}
              {labels && (
                <Html center position={[0, size + 0.3, 0]} distanceFactor={18} className="pointer-events-none">
                  <span className="text-[11px] text-white bg-black/50 rounded px-1 whitespace-nowrap">{p.name}</span>
                </Html>
              )}
            </group>
          </group>
        );
      })}
    </>
  );
}

function Clock({ playing, speed, onTick }: { playing: boolean; speed: number; onTick: (dd: number) => void }) {
  useFrame((_, dt) => playing && onTick(Math.min(dt, 0.05) * speed));
  return null;
}

export default function Solar({ params }: { params?: Record<string, number> }) {
  const [days, setDays] = useState(0);
  const [speed, setSpeed] = useState(params?.speed ?? 30);
  const [playing, setPlaying] = useState(true);
  const [mode, setMode] = useState<'compressed' | 'linear'>('compressed');
  const [labels, setLabels] = useState(true);
  const [sel, setSel] = useState(2);
  const dRef = useRef(0);
  dRef.current = days;
  const p = PLANETS[sel];
  const years = p.T / 365.26;
  return (
    <SimLayout
      canvas={
        <SimCanvas camera={[0, 22, 34]} target={[0, 0, 0]}>
          <Clock playing={playing} speed={speed} onTick={(dd) => setDays(dRef.current + dd)} />
          <System days={days} mode={mode} labels={labels} />
        </SimCanvas>
      }
      panel={
        <>
          <PlayBar playing={playing} setPlaying={setPlaying} onReset={() => setDays(0)} />
          <Slider label="Velocidad" value={speed} min={1} max={2000} step={1} onChange={setSpeed} format={(v) => `${v} días/s`} />
          <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'compressed', label: 'Distancias comprimidas' }, { value: 'linear', label: 'Distancias a escala' }]} />
          <Toggle label="Nombres" checked={labels} onChange={setLabels} />
          <Readout items={[{ label: 'Tiempo transcurrido', value: `${fmt(days / 365.26, 2)} años` }, { label: 'Días', value: Math.round(days).toLocaleString('es-AR') }]} />
          <label className="block text-xs text-muted">
            Planeta
            <Select value={sel} onChange={(e) => setSel(Number(e.target.value))} className="mt-1">
              {PLANETS.map((x, i) => (
                <option key={x.name} value={i}>
                  {x.name}
                </option>
              ))}
            </Select>
          </label>
          <Readout
            items={[
              { label: 'Semieje mayor a', value: `${fmt(p.a, 3)} UA` },
              { label: 'Período T', value: `${fmt(years, 2)} años` },
              { label: 'T² / a³ (3.ª ley de Kepler)', value: fmt((years * years) / (p.a * p.a * p.a), 3) },
              { label: 'Vueltas completadas', value: fmt(days / p.T, 1) },
            ]}
          />
          <Simplified>Órbitas circulares y coplanares; los tamaños de los planetas están exagerados (a escala real serían invisibles). Con distancias comprimidas la separación entre órbitas no es proporcional.</Simplified>
        </>
      }
    />
  );
}
