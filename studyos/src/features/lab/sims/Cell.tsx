import { useState } from 'react';
import { Html } from '@react-three/drei';
import { Segmented, Toggle } from '@/components/ui';
import { SimCanvas, SimLayout, Simplified } from '../shared';

interface Org {
  id: string;
  name: string;
  info: string;
  plantOnly?: boolean;
  animalOnly?: boolean;
}

const ORGS: Org[] = [
  { id: 'membrane', name: 'Membrana plasmática', info: 'Bicapa lipídica que regula el paso de sustancias (permeabilidad selectiva).' },
  { id: 'wall', name: 'Pared celular', info: 'Capa rígida de celulosa que da forma y sostén a la célula vegetal.', plantOnly: true },
  { id: 'nucleus', name: 'Núcleo', info: 'Contiene el ADN y dirige la actividad celular. El nucléolo fabrica ribosomas.' },
  { id: 'mito', name: 'Mitocondrias', info: 'Realizan la respiración celular y producen ATP.' },
  { id: 'chloro', name: 'Cloroplastos', info: 'Realizan la fotosíntesis gracias a la clorofila.', plantOnly: true },
  { id: 'vacuole', name: 'Vacuola central', info: 'Almacena agua y sustancias; mantiene la turgencia.', plantOnly: true },
  { id: 'er', name: 'Retículo endoplasmático', info: 'Red de membranas: el rugoso (con ribosomas) sintetiza proteínas; el liso, lípidos.' },
  { id: 'golgi', name: 'Aparato de Golgi', info: 'Modifica, empaqueta y distribuye proteínas y lípidos.' },
  { id: 'lyso', name: 'Lisosomas', info: 'Vesículas con enzimas digestivas.', animalOnly: true },
  { id: 'ribo', name: 'Ribosomas', info: 'Sintetizan proteínas a partir del ARN mensajero.' },
];

function Label({ text, on }: { text: string; on: boolean }) {
  if (!on) return null;
  return (
    <Html center distanceFactor={9} className="pointer-events-none">
      <span className="text-[10px] text-white bg-black/60 rounded px-1.5 py-0.5 whitespace-nowrap">{text}</span>
    </Html>
  );
}

export default function Cell({ params }: { params?: Record<string, number> }) {
  const [plant, setPlant] = useState(!!params?.plant);
  const [labels, setLabels] = useState(true);
  const [sel, setSel] = useState<Org>(ORGS[2]);
  const pick = (id: string) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setSel(ORGS.find((o) => o.id === id)!);
  };
  const hi = (id: string) => (sel.id === id ? 0.5 : 0);
  return (
    <SimLayout
      canvas={
        <SimCanvas camera={[0, 3, 8]} target={[0, 0, 0]}>
          {plant ? (
            <mesh onClick={pick('wall')}>
              <boxGeometry args={[6.2, 4.2, 4.2]} />
              <meshStandardMaterial color="#4ade80" transparent opacity={0.12} emissive="#16a34a" emissiveIntensity={hi('wall')} />
            </mesh>
          ) : null}
          <mesh onClick={pick('membrane')} scale={plant ? [2.9, 1.95, 1.95] : [2.6, 2.1, 2.1]}>
            <sphereGeometry args={[1, 48, 48]} />
            <meshStandardMaterial color="#60a5fa" transparent opacity={0.14} emissive="#3d5bff" emissiveIntensity={hi('membrane')} />
          </mesh>
          <group position={[-0.4, 0.2, 0]} onClick={pick('nucleus')}>
            <mesh>
              <sphereGeometry args={[0.75, 40, 40]} />
              <meshStandardMaterial color="#8b5cf6" transparent opacity={0.85} emissive="#6d28d9" emissiveIntensity={hi('nucleus')} />
            </mesh>
            <mesh position={[0.15, 0.1, 0.35]}>
              <sphereGeometry args={[0.25, 24, 24]} />
              <meshStandardMaterial color="#c4b5fd" />
            </mesh>
            <Label text="Núcleo" on={labels} />
          </group>
          {[[1.3, -0.5, 0.6, 0.4], [-1.6, -0.6, 0.4, 1.2], [0.9, 0.9, -0.6, 2]].map(([x, y, z, r], i) => (
            <group key={i} position={[x, y, z]} rotation={[0, r, 0.6]} onClick={pick('mito')}>
              <mesh>
                <capsuleGeometry args={[0.18, 0.5, 8, 16]} />
                <meshStandardMaterial color="#f97316" emissive="#c2410c" emissiveIntensity={hi('mito')} />
              </mesh>
              {i === 0 && <Label text="Mitocondria" on={labels} />}
            </group>
          ))}
          {plant &&
            [[1.7, 0.5, 0.5], [-1.8, 0.7, -0.4], [0.6, -1.0, -0.7], [1.9, -0.6, -0.5]].map(([x, y, z], i) => (
              <group key={i} position={[x, y, z]} onClick={pick('chloro')} scale={[0.42, 0.24, 0.3]}>
                <mesh>
                  <sphereGeometry args={[1, 24, 24]} />
                  <meshStandardMaterial color="#16a34a" emissive="#15803d" emissiveIntensity={hi('chloro')} />
                </mesh>
                {i === 0 && <Label text="Cloroplasto" on={labels} />}
              </group>
            ))}
          {plant && (
            <mesh position={[0.9, 0.1, 0.2]} scale={[1.0, 1.1, 1.0]} onClick={pick('vacuole')}>
              <sphereGeometry args={[1, 32, 32]} />
              <meshStandardMaterial color="#38bdf8" transparent opacity={0.3} emissive="#0284c7" emissiveIntensity={hi('vacuole')} />
              <Label text="Vacuola" on={labels} />
            </mesh>
          )}
          <group position={[-0.5, -0.9, 0.6]} onClick={pick('er')}>
            {[0, 1, 2].map((i) => (
              <mesh key={i} rotation={[Math.PI / 2, 0, 0]} position={[0, i * 0.12, 0]}>
                <torusGeometry args={[0.55 + i * 0.12, 0.04, 8, 32, Math.PI * 1.2]} />
                <meshStandardMaterial color="#22d3ee" emissive="#0891b2" emissiveIntensity={hi('er')} />
              </mesh>
            ))}
            <Label text="Retículo" on={labels} />
          </group>
          <group position={[0.6, 1.0, 0.9]} rotation={[0.3, 0, 0.3]} onClick={pick('golgi')}>
            {[0, 1, 2, 3].map((i) => (
              <mesh key={i} position={[0, i * 0.09, 0]} scale={[1 - i * 0.1, 1, 0.6]}>
                <cylinderGeometry args={[0.35, 0.35, 0.05, 24]} />
                <meshStandardMaterial color="#facc15" emissive="#ca8a04" emissiveIntensity={hi('golgi')} />
              </mesh>
            ))}
            <Label text="Golgi" on={labels} />
          </group>
          {!plant &&
            [[-1.2, 1.0, 0.5], [1.5, 0.2, -0.9]].map(([x, y, z], i) => (
              <mesh key={i} position={[x, y, z]} onClick={pick('lyso')}>
                <sphereGeometry args={[0.16, 16, 16]} />
                <meshStandardMaterial color="#f43f5e" emissive="#be123c" emissiveIntensity={hi('lyso')} />
              </mesh>
            ))}
          {Array.from({ length: 40 }, (_, i) => {
            const a = i * 2.39996;
            const r = 0.9 + (i % 7) * 0.13;
            return (
              <mesh key={i} position={[Math.cos(a) * r, Math.sin(i * 1.3) * 1.1, Math.sin(a) * r * 0.8]} onClick={pick('ribo')}>
                <sphereGeometry args={[0.035, 8, 8]} />
                <meshStandardMaterial color="#e2e8f0" />
              </mesh>
            );
          })}
        </SimCanvas>
      }
      panel={
        <>
          <Segmented value={plant ? 'p' : 'a'} onChange={(v) => setPlant(v === 'p')} options={[{ value: 'a', label: 'Célula animal' }, { value: 'p', label: 'Célula vegetal' }]} />
          <Toggle label="Etiquetas" checked={labels} onChange={setLabels} />
          <div className="tile p-3">
            <div className="font-medium text-sm">{sel.name}</div>
            <p className="text-[13px] text-[#cdd5f0] mt-1">{sel.info}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ORGS.filter((o) => (plant ? !o.animalOnly : !o.plantOnly)).map((o) => (
              <button key={o.id} onClick={() => setSel(o)} className={`text-xs rounded-full border px-2.5 py-1 ${sel.id === o.id ? 'nav-active' : 'border-line text-muted'}`}>
                {o.name}
              </button>
            ))}
          </div>
          <Simplified>Representación esquemática: formas, tamaños y cantidades no están a escala y las organelas reales son mucho más numerosas.</Simplified>
        </>
      }
    />
  );
}
