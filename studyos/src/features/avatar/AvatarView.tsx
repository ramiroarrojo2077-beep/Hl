import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AvatarController, type CharacterId } from './AvatarController';
import { useAvatar } from './store';
import { Spinner } from '@/components/ui';

function Rig({ character, framing, facing, onReady, onError }: { character: CharacterId; framing: 'bust' | 'half' | 'full'; facing: number; onReady: () => void; onError: (e: Error) => void }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const ctrl = useMemo(() => new AvatarController(character), [character]);
  const gesture = useAvatar((s) => s.gesture);
  const mood = useAvatar((s) => s.mood);
  useEffect(() => {
    let alive = true;
    ctrl
      .init(camera)
      .then(() => {
        if (!alive) return;
        ctrl.root.rotation.y = facing;
        const h = ctrl.height;
        if (framing === 'bust') {
          camera.position.set(0, h - 0.05, 1.25);
          camera.lookAt(0, h - 0.12, 0);
        } else if (framing === 'half') {
          camera.position.set(0, h - 0.06, 2.5);
          camera.lookAt(0, h - 0.2, 0);
        } else {
          camera.position.set(0, h * 0.62, 3.6);
          camera.lookAt(0, h * 0.55, 0);
        }
        onReady();
        setTimeout(() => ctrl.playGesture('wave'), 400);
      })
      .catch((e) => alive && onError(e));
    return () => {
      alive = false;
      ctrl.dispose();
    };
  }, [ctrl, camera, framing, facing, onReady, onError]);
  useEffect(() => {
    if (gesture) ctrl.playGesture(gesture.type);
  }, [gesture, ctrl]);
  useEffect(() => {
    ctrl.mood = mood;
  }, [mood, ctrl]);
  useFrame((_, dt) => ctrl.update(Math.min(dt, 0.05)));
  return <primitive object={ctrl.root} />;
}

class GlBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Profesor 3D animado (canvas transparente). Si WebGL no está disponible, muestra una imagen fija. */
export function AvatarView({ character, framing = 'half', facing = 0, className, fallbackImage = './teacher-seed.png' }: { character: CharacterId; framing?: 'bust' | 'half' | 'full'; facing?: number; className?: string; fallbackImage?: string }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onReady = useRef(() => setReady(true)).current;
  const onError = useRef((e: Error) => setError(e.message)).current;
  const fallback = (
    <div className="relative size-full">
      <img src={fallbackImage} alt="Profesora virtual" className="absolute bottom-0 right-0 h-full w-auto object-contain" />
      <span className="absolute left-2 bottom-2 text-[10px] text-muted bg-black/40 rounded px-1.5 py-0.5">Vista fija: 3D no disponible</span>
    </div>
  );
  if (error) return <div className={className}>{fallback}</div>;
  return (
    <div className={className}>
      <div className="relative size-full">
      <GlBoundary fallback={fallback}>
        <Canvas
          gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
          dpr={[1, 1.75]}
          camera={{ fov: 26, near: 0.1, far: 30, position: [0, 1.3, 2.2] }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[1.2, 2, 2.5]} intensity={1.2} />
          <directionalLight position={[-2, 1.5, -1.5]} intensity={2.4} color="#8b5cf6" />
          <directionalLight position={[2, 1, -2]} intensity={1.5} color="#22d3ee" />
          <Suspense fallback={null}>
            <Rig character={character} framing={framing} facing={facing} onReady={onReady} onError={onError} />
          </Suspense>
        </Canvas>
      </GlBoundary>
      {!ready && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Spinner /> Cargando profesor 3D…
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
