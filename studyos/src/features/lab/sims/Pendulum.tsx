import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { Slider } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { PlayBar, Readout, SimCanvas, SimLayout, Simplified, fmt } from '../shared';

interface PState {
  th: number;
  w: number;
  t: number;
  lastCross: number;
  period: number;
}

function Scene({ st, L, g, damp, amp, playing, onSample }: { st: React.MutableRefObject<PState>; L: number; g: number; damp: number; amp: number; playing: boolean; onSample: (s: PState) => void }) {
  const bob = useRef<THREE.Mesh>(null);
  const rod = useRef<THREE.BufferGeometry>(null);
  const scale = 3 / Math.max(L, 1);
  const acc = useRef(0);
  const arc = useMemo(
    () =>
      Array.from({ length: 41 }, (_, i) => {
        const a = (-amp + (2 * amp * i) / 40) * (Math.PI / 180);
        return [Math.sin(a) * L * scale, 4.5 - Math.cos(a) * L * scale, 0] as [number, number, number];
      }),
    [amp, L, scale],
  );
  useFrame((_, dtRaw) => {
    const s = st.current;
    if (playing) {
      // Integración RK4 de θ'' = -(g/L)·sen θ - b·θ'
      const f = (th: number, w: number) => [w, -(g / L) * Math.sin(th) - damp * w];
      const steps = 8;
      const dt = Math.min(dtRaw, 0.05) / steps;
      for (let i = 0; i < steps; i++) {
        const [k1a, k1b] = f(s.th, s.w);
        const [k2a, k2b] = f(s.th + (k1a * dt) / 2, s.w + (k1b * dt) / 2);
        const [k3a, k3b] = f(s.th + (k2a * dt) / 2, s.w + (k2b * dt) / 2);
        const [k4a, k4b] = f(s.th + k3a * dt, s.w + k3b * dt);
        const prev = s.th;
        s.th += ((k1a + 2 * k2a + 2 * k3a + k4a) * dt) / 6;
        s.w += ((k1b + 2 * k2b + 2 * k3b + k4b) * dt) / 6;
        s.t += dt;
        // Período medido: tiempo entre dos cruces por el centro en el mismo sentido
        if (prev < 0 && s.th >= 0) {
          if (s.lastCross >= 0) s.period = s.t - s.lastCross;
          s.lastCross = s.t;
        }
      }
    }
    const bx = Math.sin(s.th) * L * scale;
    const by = 4.5 - Math.cos(s.th) * L * scale;
    bob.current?.position.set(bx, by, 0);
    if (rod.current) {
      rod.current.setFromPoints([new THREE.Vector3(0, 4.5, 0), new THREE.Vector3(bx, by, 0)]);
    }
    acc.current += dtRaw;
    if (acc.current > 0.1) {
      acc.current = 0;
      onSample({ ...s });
    }
  });
  return (
    <>
      <mesh position={[0, 4.6, 0]}>
        <boxGeometry args={[2.5, 0.1, 0.4]} />
        <meshStandardMaterial color="#5b6b95" />
      </mesh>
      <line>
        <bufferGeometry ref={rod} />
        <lineBasicMaterial color="#cdd5f0" />
      </line>
      <mesh ref={bob}>
        <sphereGeometry args={[0.28, 32, 32]} />
        <meshStandardMaterial color="#8b5cf6" metalness={0.4} roughness={0.25} />
      </mesh>
      <Line points={arc} color="#3d5bff" dashed dashSize={0.1} gapSize={0.08} transparent opacity={0.6} />
    </>
  );
}

export default function Pendulum({ params }: { params?: Record<string, number> }) {
  const [L, setL] = useState(params?.length ?? 2);
  const [g, setG] = useState(params?.g ?? 9.81);
  const [amp, setAmp] = useState(params?.amplitude ?? 30);
  const [damp, setDamp] = useState(params?.damping ?? 0);
  const [playing, setPlaying] = useState(true);
  const st = useRef<PState>({ th: (amp * Math.PI) / 180, w: 0, t: 0, lastCross: -1, period: NaN });
  const [sample, setSample] = useState<PState>(st.current);
  const reset = () => {
    st.current = { th: (amp * Math.PI) / 180, w: 0, t: 0, lastCross: -1, period: NaN };
    setSample(st.current);
  };
  useEffect(reset, [L, g, amp, damp]); // eslint-disable-line react-hooks/exhaustive-deps
  const T0 = 2 * Math.PI * Math.sqrt(L / g);
  return (
    <SimLayout
      canvas={
        <SimCanvas camera={[0, 3, 9]} target={[0, 2.5, 0]}>
          <Scene st={st} L={L} g={g} damp={damp} amp={amp} playing={playing} onSample={setSample} />
        </SimCanvas>
      }
      panel={
        <>
          <PlayBar playing={playing} setPlaying={setPlaying} onReset={reset} />
          <Slider label="Longitud L" value={L} min={0.5} max={4} step={0.1} onChange={setL} format={(v) => `${fmt(v, 1)} m`} />
          <Slider label="Gravedad g" value={g} min={1} max={25} step={0.01} onChange={setG} format={(v) => `${fmt(v)} m/s²`} />
          <Slider label="Amplitud" value={amp} min={5} max={80} onChange={setAmp} format={(v) => `${v}°`} />
          <Slider label="Amortiguamiento" value={damp} min={0} max={0.6} step={0.02} onChange={setDamp} format={(v) => fmt(v)} />
          <Readout
            items={[
              { label: 'Ángulo actual', value: `${fmt((sample.th * 180) / Math.PI, 1)}°` },
              { label: 'Tiempo', value: `${fmt(sample.t, 1)} s` },
              { label: 'T teórico (ángulo pequeño)', value: `${fmt(T0)} s` },
              { label: 'T medido', value: Number.isFinite(sample.period) ? `${fmt(sample.period)} s` : 'midiendo…' },
            ]}
          />
          <Markdown className="!text-[13px]">{'Con amplitudes grandes el período medido supera a $T = 2\\pi\\sqrt{L/g}$: esa fórmula supone ángulos pequeños ($\\sin\\theta \\approx \\theta$).'}</Markdown>
          <Simplified>Masa puntual, hilo ideal sin masa y rozamiento proporcional a la velocidad.</Simplified>
        </>
      }
    />
  );
}
