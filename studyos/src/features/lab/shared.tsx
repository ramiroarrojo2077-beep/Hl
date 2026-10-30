import { type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Button, Notice, cx } from '@/components/ui';

export function SimCanvas({ children, camera = [6, 5, 9], target = [0, 1, 0], className }: { children: ReactNode; camera?: [number, number, number]; target?: [number, number, number]; className?: string }) {
  return (
    <div className={cx('relative rounded-2xl overflow-hidden border border-line bg-[radial-gradient(ellipse_at_top,#16204a,#070a16)]', className ?? 'h-[52dvh] min-h-[320px]')}>
      <Canvas camera={{ position: camera, fov: 45 }} dpr={[1, 1.75]} gl={{ antialias: true, powerPreference: 'low-power' }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[5, 8, 5]} intensity={1.4} />
        <pointLight position={[-6, 4, -4]} intensity={30} color="#8b5cf6" />
        {children}
        <OrbitControls target={target} makeDefault enableDamping />
      </Canvas>
      <span className="absolute left-2 bottom-2 text-[10px] text-faint bg-black/40 rounded px-1.5 py-0.5 pointer-events-none">Arrastrá para girar · pellizcá para acercar</span>
    </div>
  );
}

export function PlayBar({ playing, setPlaying, onReset, extra }: { playing: boolean; setPlaying: (v: boolean) => void; onReset: () => void; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="primary" icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={() => setPlaying(!playing)}>
        {playing ? 'Pausar' : 'Iniciar'}
      </Button>
      <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={onReset}>
        Reiniciar
      </Button>
      {extra}
    </div>
  );
}

export function Readout({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((i) => (
        <div key={i.label} className="tile px-3 py-2">
          <div className="text-[10px] text-muted">{i.label}</div>
          <div className="font-mono text-sm">{i.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Simplified({ children }: { children: ReactNode }) {
  return (
    <Notice tone="warn" title="Modelo simplificado">
      {children}
    </Notice>
  );
}

export function SimLayout({ canvas, panel }: { canvas: ReactNode; panel: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>{canvas}</div>
      <div className="space-y-4">{panel}</div>
    </div>
  );
}

export const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '—');
