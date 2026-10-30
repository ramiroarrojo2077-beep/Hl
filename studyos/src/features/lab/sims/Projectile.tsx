import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Grid, Line } from '@react-three/drei';
import { Select, Slider } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { Label3D, PlayBar, Readout, SimCanvas, SimLayout, Simplified, fmt } from '../shared';

const GRAVITY: Record<string, number> = { Tierra: 9.81, Luna: 1.62, Marte: 3.71, Júpiter: 24.79 };

function Scene({ v0, angle, g, h0, t, scale }: { v0: number; angle: number; g: number; h0: number; t: number; scale: number }) {
  const a = (angle * Math.PI) / 180;
  const vx = v0 * Math.cos(a);
  const vy = v0 * Math.sin(a);
  const T = (vy + Math.sqrt(vy * vy + 2 * g * h0)) / g;
  const path = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 80; i++) {
      const tt = (T * i) / 80;
      pts.push([vx * tt * scale - 6, (h0 + vy * tt - 0.5 * g * tt * tt) * scale, 0]);
    }
    return pts;
  }, [vx, vy, g, h0, T, scale]);
  const tc = Math.min(t, T);
  const x = vx * tc * scale - 6;
  const y = Math.max(0, h0 + vy * tc - 0.5 * g * tc * tc) * scale;
  const trail = path.filter((_, i) => (T * i) / 80 <= tc);
  return (
    <>
      <Grid args={[30, 30]} position={[0, 0, 0]} cellColor="#22305c" sectionColor="#3d5bff" fadeDistance={40} infiniteGrid />
      {h0 > 0 && (
        <mesh position={[-6, (h0 * scale) / 2, 0]}>
          <boxGeometry args={[0.8, h0 * scale, 0.8]} />
          <meshStandardMaterial color="#334066" />
        </mesh>
      )}
      <group position={[-6, h0 * scale, 0]} rotation={[0, 0, a]}>
        <mesh position={[0.4, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.14, 0.18, 0.9, 20]} />
          <meshStandardMaterial color="#8ea2ff" metalness={0.5} roughness={0.3} />
        </mesh>
      </group>
      <Line points={path} color="#5fdcff" dashed dashSize={0.25} gapSize={0.15} lineWidth={1.2} transparent opacity={0.5} />
      {trail.length > 1 && <Line points={trail} color="#ffb43a" lineWidth={2.5} />}
      <mesh position={[x, y, 0]}>
        <sphereGeometry args={[0.18, 24, 24]} />
        <meshStandardMaterial color="#ff8a3d" emissive="#ff6a00" emissiveIntensity={0.4} />
      </mesh>
      <Label3D position={[x, y + 0.55, 0]} size={0.3} text={`(${fmt(vx * tc, 1)} m; ${fmt(Math.max(0, h0 + vy * tc - 0.5 * g * tc * tc), 1)} m)`} />
    </>
  );
}

function Clock({ playing, onTick }: { playing: boolean; onTick: (dt: number) => void }) {
  useFrame((_, dt) => playing && onTick(Math.min(dt, 0.05)));
  return null;
}

export default function Projectile({ params }: { params?: Record<string, number> }) {
  const [v0, setV0] = useState(params?.v0 ?? 20);
  const [angle, setAngle] = useState(params?.angle ?? 45);
  const [planet, setPlanet] = useState('Tierra');
  const [h0, setH0] = useState(params?.h0 ?? 0);
  const [speed, setSpeed] = useState(1);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const g = params?.g ?? GRAVITY[planet];
  const a = (angle * Math.PI) / 180;
  const vy = v0 * Math.sin(a);
  const vx = v0 * Math.cos(a);
  const T = (vy + Math.sqrt(vy * vy + 2 * g * h0)) / g;
  const R = vx * T;
  const H = h0 + (vy * vy) / (2 * g);
  const scale = 12 / Math.max(R, H * 1.6, 8);
  const tRef = useRef(0);
  tRef.current = t;
  const reset = () => {
    setT(0);
    setPlaying(false);
  };
  const tc = Math.min(t, T);
  return (
    <SimLayout
      canvas={
        <SimCanvas camera={[0, 5, 16]} target={[0, 3, 0]}>
          <Clock
            playing={playing}
            onTick={(dt) => {
              const nt = tRef.current + dt * speed;
              if (nt >= T) {
                setT(T);
                setPlaying(false);
              } else setT(nt);
            }}
          />
          <Scene v0={v0} angle={angle} g={g} h0={h0} t={t} scale={scale} />
        </SimCanvas>
      }
      panel={
        <>
          <PlayBar playing={playing} setPlaying={(p) => { if (p && t >= T) setT(0); setPlaying(p); }} onReset={reset} />
          <Slider label="Velocidad inicial v₀" value={v0} min={2} max={60} onChange={(v) => { setV0(v); reset(); }} format={(v) => `${v} m/s`} />
          <Slider label="Ángulo θ" value={angle} min={5} max={85} onChange={(v) => { setAngle(v); reset(); }} format={(v) => `${v}°`} />
          <Slider label="Altura inicial h₀" value={h0} min={0} max={30} onChange={(v) => { setH0(v); reset(); }} format={(v) => `${v} m`} />
          <label className="block text-xs text-muted">
            Gravedad
            <Select value={planet} onChange={(e) => { setPlanet(e.target.value); reset(); }} className="mt-1">
              {Object.entries(GRAVITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} ({v} m/s²)
                </option>
              ))}
            </Select>
          </label>
          <Slider label="Velocidad de reproducción" value={speed} min={0.25} max={3} step={0.25} onChange={setSpeed} format={(v) => `${v}×`} />
          <Readout
            items={[
              { label: 'Tiempo', value: `${fmt(tc)} s` },
              { label: 'Tiempo de vuelo', value: `${fmt(T)} s` },
              { label: 'Alcance', value: `${fmt(R, 1)} m` },
              { label: 'Altura máxima', value: `${fmt(H, 1)} m` },
              { label: 'vₓ', value: `${fmt(vx)} m/s` },
              { label: 'v_y(t)', value: `${fmt(vy - g * tc)} m/s` },
            ]}
          />
          <Markdown className="!text-[13px]">{`$x = v_0\\cos\\theta\\,t$, $y = h_0 + v_0\\sin\\theta\\,t - \\tfrac{1}{2}gt^2$. El alcance es máximo cerca de 45° cuando $h_0 = 0$.`}</Markdown>
          <Simplified>Sin rozamiento del aire ni rotación de la Tierra: en la realidad el alcance es menor y la trayectoria no es una parábola perfecta.</Simplified>
        </>
      }
    />
  );
}
