import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Select, Toggle } from '@/components/ui';
import { SimCanvas, SimLayout, Simplified } from '../shared';

type Atom = [string, number, number, number];
interface Mol {
  name: string;
  formula: string;
  geometry: string;
  angle: string;
  polar: string;
  atoms: Atom[];
  bonds: [number, number, number][]; // [a, b, orden]
  info: string;
}

const CPK: Record<string, { c: string; r: number }> = { H: { c: '#f1f5f9', r: 0.25 }, C: { c: '#3f3f46', r: 0.38 }, O: { c: '#ef4444', r: 0.36 }, N: { c: '#3b82f6', r: 0.36 }, Na: { c: '#a855f7', r: 0.42 }, Cl: { c: '#22c55e', r: 0.46 } };

const t = 109.47 / 2;
const tet = (r: number): [number, number, number][] => [
  [0, r, 0],
  [r * Math.sin((2 * t * Math.PI) / 180), r * Math.cos((2 * t * Math.PI) / 180), 0],
  [r * Math.sin((2 * t * Math.PI) / 180) * Math.cos((2 * Math.PI) / 3), r * Math.cos((2 * t * Math.PI) / 180), r * Math.sin((2 * t * Math.PI) / 180) * Math.sin((2 * Math.PI) / 3)],
  [r * Math.sin((2 * t * Math.PI) / 180) * Math.cos((4 * Math.PI) / 3), r * Math.cos((2 * t * Math.PI) / 180), r * Math.sin((2 * t * Math.PI) / 180) * Math.sin((4 * Math.PI) / 3)],
];

function nacl(): { atoms: Atom[]; bonds: [number, number, number][] } {
  const atoms: Atom[] = [];
  const idx = new Map<string, number>();
  const d = 1.4;
  for (let x = 0; x < 3; x++)
    for (let y = 0; y < 3; y++)
      for (let z = 0; z < 3; z++) {
        idx.set(`${x},${y},${z}`, atoms.length);
        atoms.push([(x + y + z) % 2 ? 'Cl' : 'Na', (x - 1) * d, (y - 1) * d, (z - 1) * d]);
      }
  const bonds: [number, number, number][] = [];
  for (const [k, i] of idx) {
    const [x, y, z] = k.split(',').map(Number);
    for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const j = idx.get(`${x + dx},${y + dy},${z + dz}`);
      if (j !== undefined) bonds.push([i, j, 0]);
    }
  }
  return { atoms, bonds };
}

const h2oA = (104.5 * Math.PI) / 360;
const nh3 = tet(1.01).slice(1);
const ch4 = tet(1.09);
const benzene: Atom[] = [];
for (let i = 0; i < 6; i++) {
  const a = (i * Math.PI) / 3;
  benzene.push(['C', 1.39 * Math.cos(a), 1.39 * Math.sin(a), 0]);
}
for (let i = 0; i < 6; i++) {
  const a = (i * Math.PI) / 3;
  benzene.push(['H', 2.48 * Math.cos(a), 2.48 * Math.sin(a), 0]);
}

export const MOLECULES: Mol[] = [
  { name: 'Agua', formula: 'H₂O', geometry: 'Angular', angle: '104,5°', polar: 'Polar', atoms: [['O', 0, 0, 0], ['H', 0.96 * Math.sin(h2oA), -0.96 * Math.cos(h2oA), 0], ['H', -0.96 * Math.sin(h2oA), -0.96 * Math.cos(h2oA), 0]], bonds: [[0, 1, 1], [0, 2, 1]], info: 'Los dos pares de electrones libres del oxígeno cierran el ángulo respecto del tetraedro ideal.' },
  { name: 'Dióxido de carbono', formula: 'CO₂', geometry: 'Lineal', angle: '180°', polar: 'No polar (los dipolos se anulan)', atoms: [['C', 0, 0, 0], ['O', 1.16, 0, 0], ['O', -1.16, 0, 0]], bonds: [[0, 1, 2], [0, 2, 2]], info: 'Dos dobles enlaces C=O opuestos.' },
  { name: 'Metano', formula: 'CH₄', geometry: 'Tetraédrica', angle: '109,5°', polar: 'No polar', atoms: [['C', 0, 0, 0], ...ch4.map((p) => ['H', ...p] as Atom)], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]], info: 'Cuatro pares enlazantes se separan al máximo.' },
  { name: 'Amoníaco', formula: 'NH₃', geometry: 'Piramidal trigonal', angle: '≈107°', polar: 'Polar', atoms: [['N', 0, 0, 0], ...nh3.map((p) => ['H', p[0], p[1], p[2]] as Atom)], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]], info: 'El par libre del nitrógeno empuja a los hidrógenos.' },
  { name: 'Oxígeno', formula: 'O₂', geometry: 'Lineal (diatómica)', angle: '—', polar: 'No polar', atoms: [['O', 0.6, 0, 0], ['O', -0.6, 0, 0]], bonds: [[0, 1, 2]], info: 'Doble enlace O=O (1,21 Å).' },
  {
    name: 'Etanol', formula: 'C₂H₅OH', geometry: 'Tetraédrica en cada C', angle: '≈109°', polar: 'Polar (grupo –OH)',
    atoms: [['C', -1.2, -0.2, 0], ['C', 0.3, 0.1, 0], ['O', 1.0, -1.1, 0], ['H', 1.9, -0.9, 0], ['H', -1.7, 0.75, 0], ['H', -1.5, -0.75, 0.88], ['H', -1.5, -0.75, -0.88], ['H', 0.6, 0.7, 0.88], ['H', 0.6, 0.7, -0.88]],
    bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [0, 4, 1], [0, 5, 1], [0, 6, 1], [1, 7, 1], [1, 8, 1]],
    info: 'Geometría aproximada. El grupo hidroxilo permite puentes de hidrógeno.',
  },
  { name: 'Cloruro de sodio (red)', formula: 'NaCl', geometry: 'Red cúbica (cristal iónico)', angle: '90°', polar: 'Iónico', ...nacl(), info: 'No hay moléculas aisladas: cada ion está rodeado por 6 de carga opuesta. Las barras indican vecinos, no enlaces covalentes.' },
  { name: 'Benceno', formula: 'C₆H₆', geometry: 'Plana hexagonal', angle: '120°', polar: 'No polar', atoms: benzene, bonds: [[0, 1, 1.5], [1, 2, 1.5], [2, 3, 1.5], [3, 4, 1.5], [4, 5, 1.5], [5, 0, 1.5], [0, 6, 1], [1, 7, 1], [2, 8, 1], [3, 9, 1], [4, 10, 1], [5, 11, 1]], info: 'Enlaces C–C equivalentes (deslocalizados), intermedios entre simple y doble.' },
];

function Bond({ a, b, order }: { a: THREE.Vector3; b: THREE.Vector3; order: number }) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const n = order >= 2 ? 2 : 1;
  const off = new THREE.Vector3(0, 0, 1).cross(dir).normalize().multiplyScalar(order >= 2 ? 0.09 : 0);
  return (
    <>
      {Array.from({ length: order === 0 ? 1 : n }, (_, i) => (
        <mesh key={i} position={mid.clone().add(off.clone().multiplyScalar(i === 0 ? 1 : -1))} quaternion={q}>
          <cylinderGeometry args={[order === 0 ? 0.04 : 0.07, order === 0 ? 0.04 : 0.07, len, 12]} />
          <meshStandardMaterial color={order === 0 ? '#64748b' : order === 1.5 ? '#94a3b8' : '#cbd5e1'} />
        </mesh>
      ))}
    </>
  );
}

function Model({ mol, labels, spin }: { mol: Mol; labels: boolean; spin: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (spin && g.current) g.current.rotation.y += dt * 0.4;
  });
  const s = 1.6;
  const pos = mol.atoms.map(([, x, y, z]) => new THREE.Vector3(x * s, y * s + 1.5, z * s));
  return (
    <group ref={g} position={[0, 0, 0]}>
      {mol.atoms.map(([el], i) => (
        <mesh key={i} position={pos[i]}>
          <sphereGeometry args={[CPK[el].r * (mol.formula === 'NaCl' ? 1.1 : 1.3), 32, 32]} />
          <meshStandardMaterial color={CPK[el].c} roughness={0.35} metalness={0.05} />
          {labels && (
            <Html center distanceFactor={10} className="pointer-events-none">
              <span className="text-[11px] font-bold text-white drop-shadow">{el}</span>
            </Html>
          )}
        </mesh>
      ))}
      {mol.bonds.map(([a, b, o], i) => (
        <Bond key={i} a={pos[a]} b={pos[b]} order={o} />
      ))}
    </group>
  );
}

export default function Molecules({ params }: { params?: Record<string, number> }) {
  const [i, setI] = useState(Math.min(MOLECULES.length - 1, Math.max(0, Math.round(params?.molecule ?? 0))));
  const [labels, setLabels] = useState(true);
  const [spin, setSpin] = useState(true);
  const mol = MOLECULES[i];
  return (
    <SimLayout
      canvas={
        <SimCanvas camera={[0, 2.5, 7]} target={[0, 1.5, 0]}>
          <Model mol={mol} labels={labels} spin={spin} />
        </SimCanvas>
      }
      panel={
        <>
          <Select value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Molécula">
            {MOLECULES.map((m, j) => (
              <option key={m.formula} value={j}>
                {m.name} ({m.formula})
              </option>
            ))}
          </Select>
          <div className="tile p-3 text-sm space-y-1">
            <div>
              <span className="text-muted">Geometría:</span> {mol.geometry}
            </div>
            <div>
              <span className="text-muted">Ángulo de enlace:</span> {mol.angle}
            </div>
            <div>
              <span className="text-muted">Polaridad:</span> {mol.polar}
            </div>
            <p className="text-[13px] text-[#cdd5f0] pt-1">{mol.info}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            {Object.entries(CPK).map(([el, v]) => (
              <span key={el} className="inline-flex items-center gap-1">
                <span className="size-3 rounded-full" style={{ background: v.c }} /> {el}
              </span>
            ))}
          </div>
          <Toggle label="Etiquetas" checked={labels} onChange={setLabels} />
          <Toggle label="Rotación automática" checked={spin} onChange={setSpin} />
          <Simplified>Modelo de esferas y varillas: los átomos no son esferas sólidas y los tamaños están escalados para que se vean los enlaces. Distancias según valores típicos de enlace.</Simplified>
        </>
      }
    />
  );
}
