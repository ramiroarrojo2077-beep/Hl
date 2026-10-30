import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Slider } from '@/components/ui';
import { Label3D, PlayBar, Readout, SimCanvas, SimLayout, Simplified, fmt } from '../shared';

// Separación magnética con polea magnética en el extremo de una cinta: las
// partículas ferromagnéticas quedan adheridas al tambor y caen en el contenedor
// de atrás; las no magnéticas siguen su trayectoria y caen adelante.

type Kind = 'iron' | 'plastic' | 'aluminum';
interface P {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  state: 'belt' | 'drum' | 'fly' | 'done';
  angle: number;
  bin?: 'A' | 'B';
  mass: number;
}

const COLOR: Record<Kind, string> = { iron: '#9ca3af', plastic: '#f97316', aluminum: '#e2e8f0' };
const BELT_END = 3;
const DRUM_R = 0.6;

export default function Separation({ params }: { params?: Record<string, number> }) {
  const [magnet, setMagnet] = useState(params?.magnet ?? 70);
  const [ironPct, setIronPct] = useState(params?.ironPct ?? 40);
  const [speed, setSpeed] = useState(params?.speed ?? 1.2);
  const [playing, setPlaying] = useState(true);
  const parts = useRef<P[]>([]);
  const nextId = useRef(0);
  const spawnAcc = useRef(0);
  const [counts, setCounts] = useState({ A: { iron: 0, plastic: 0, aluminum: 0 }, B: { iron: 0, plastic: 0, aluminum: 0 } });
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const colors = useMemo(() => Object.fromEntries(Object.entries(COLOR).map(([k, c]) => [k, new THREE.Color(c)])) as Record<Kind, THREE.Color>, []);
  const reset = () => {
    parts.current = [];
    setCounts({ A: { iron: 0, plastic: 0, aluminum: 0 }, B: { iron: 0, plastic: 0, aluminum: 0 } });
  };
  useEffect(reset, [magnet, ironPct, speed]);

  function Engine() {
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const acc = useRef(0);
    useFrame((_, dtRaw) => {
      const dt = Math.min(dtRaw, 0.05);
      if (playing) {
        spawnAcc.current += dt * speed * 3;
        while (spawnAcc.current > 1) {
          spawnAcc.current -= 1;
          const r = Math.random() * 100;
          const kind: Kind = r < ironPct ? 'iron' : r < ironPct + (100 - ironPct) / 2 ? 'plastic' : 'aluminum';
          parts.current.push({ id: nextId.current++, kind, x: -4, y: 0.62, z: (Math.random() - 0.5) * 1.2, vx: speed, vy: 0, state: 'belt', angle: 0, mass: kind === 'iron' ? 1 : 0.6 + Math.random() * 0.5 });
        }
        for (const p of parts.current) {
          if (p.state === 'belt') {
            p.x += speed * dt;
            if (p.x >= BELT_END) {
              // La fuerza magnética efectiva disminuye con la velocidad tangencial (más fuerza centrífuga).
              const captured = p.kind === 'iron' && Math.random() < Math.min(1, (magnet / 100) * (1.6 / (0.6 + speed)));
              p.state = captured ? 'drum' : 'fly';
              p.angle = 0;
              p.vx = speed;
              p.vy = 0;
            }
          } else if (p.state === 'drum') {
            p.angle += (speed / DRUM_R) * dt;
            p.x = BELT_END + Math.sin(p.angle) * (DRUM_R + 0.08);
            p.y = 0.0 + Math.cos(p.angle) * (DRUM_R + 0.08);
            if (p.angle > Math.PI * 0.85) {
              p.state = 'fly';
              p.vx = -0.6;
              p.vy = -0.5;
            }
          } else if (p.state === 'fly') {
            p.vy -= 9.81 * dt * 0.5;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.y < -2) {
              p.state = 'done';
              p.bin = p.x < BELT_END + 0.3 ? 'B' : 'A';
            }
          }
        }
        const done = parts.current.filter((p) => p.state === 'done');
        if (done.length) {
          setCounts((c) => {
            const n = structuredClone(c);
            for (const p of done) n[p.bin!][p.kind]++;
            return n;
          });
          parts.current = parts.current.filter((p) => p.state !== 'done');
        }
      }
      const m = meshRef.current;
      if (m) {
        parts.current.slice(0, 400).forEach((p, i) => {
          dummy.position.set(p.x, p.y, p.z);
          dummy.scale.setScalar(p.kind === 'iron' ? 0.13 : 0.15);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
          m.setColorAt(i, colors[p.kind]);
        });
        m.count = Math.min(400, parts.current.length);
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      acc.current += dt;
    });
    return null;
  }

  const totA = counts.A.iron + counts.A.plastic + counts.A.aluminum;
  const totB = counts.B.iron + counts.B.plastic + counts.B.aluminum;
  const totalIron = counts.A.iron + counts.B.iron;
  return (
    <SimLayout
      canvas={
        <SimCanvas camera={[1, 3, 9]} target={[1, 0, 0]}>
          <Engine />
          <mesh position={[-0.5, 0.25, 0]}>
            <boxGeometry args={[7, 0.5, 1.6]} />
            <meshStandardMaterial color="#1f2937" />
          </mesh>
          <mesh position={[-0.5, 0.51, 0]}>
            <boxGeometry args={[7, 0.02, 1.5]} />
            <meshStandardMaterial color="#374151" />
          </mesh>
          <mesh position={[BELT_END, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[DRUM_R, DRUM_R, 1.7, 32]} />
            <meshStandardMaterial color="#b91c1c" emissive="#7f1d1d" emissiveIntensity={magnet / 200} metalness={0.6} roughness={0.3} />
          </mesh>
          <Label3D position={[BELT_END, 1.0, 0.9]} size={0.3} text="Polea magnética" />
          <mesh position={[BELT_END - 0.5, -2.4, 0]}>
            <boxGeometry args={[1.2, 0.8, 1.8]} />
            <meshStandardMaterial color="#3d5bff" transparent opacity={0.55} />
          </mesh>
          <Label3D position={[BELT_END - 0.5, -1.7, 1]} size={0.3} text="B · ferrosos" />
          <mesh position={[BELT_END + 1.6, -2.4, 0]}>
            <boxGeometry args={[1.8, 0.8, 1.8]} />
            <meshStandardMaterial color="#12a58a" transparent opacity={0.55} />
          </mesh>
          <Label3D position={[BELT_END + 1.6, -1.7, 1]} size={0.3} text="A · no ferrosos" />
          <instancedMesh ref={meshRef} args={[undefined, undefined, 400]}>
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial vertexColors metalness={0.3} roughness={0.5} />
          </instancedMesh>
        </SimCanvas>
      }
      panel={
        <>
          <PlayBar playing={playing} setPlaying={setPlaying} onReset={reset} />
          <Slider label="Intensidad del imán" value={magnet} min={0} max={100} onChange={setMagnet} format={(v) => `${v}%`} />
          <Slider label="Hierro en la mezcla" value={ironPct} min={0} max={90} onChange={setIronPct} format={(v) => `${v}%`} />
          <Slider label="Velocidad de la cinta" value={speed} min={0.4} max={3} step={0.1} onChange={setSpeed} format={(v) => `${fmt(v, 1)} m/s`} />
          <div className="flex gap-3 text-xs">
            {(Object.keys(COLOR) as Kind[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className="size-3 rounded-full" style={{ background: COLOR[k] }} />
                {k === 'iron' ? 'Hierro/acero' : k === 'plastic' ? 'Plástico' : 'Aluminio'}
              </span>
            ))}
          </div>
          <Readout
            items={[
              { label: 'Contenedor B (ferrosos)', value: `${totB} piezas` },
              { label: 'Pureza de B', value: totB ? `${Math.round((counts.B.iron / totB) * 100)}%` : '—' },
              { label: 'Contenedor A', value: `${totA} piezas` },
              { label: 'Hierro recuperado', value: totalIron ? `${Math.round((counts.B.iron / totalIron) * 100)}%` : '—' },
            ]}
          />
          <p className="text-[13px] text-[#cdd5f0]">Solo los materiales ferromagnéticos (hierro, acero) son atraídos. Más velocidad aumenta el caudal pero baja la recuperación: la fuerza magnética tiene que vencer la inercia de cada pieza.</p>
          <Simplified>La captura se modela con una probabilidad que crece con la intensidad del imán y baja con la velocidad. El aluminio no es ferromagnético: en plantas reales se separa con corrientes de Foucault (no simulado).</Simplified>
        </>
      }
    />
  );
}
