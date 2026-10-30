import { lazy, Suspense } from 'react';
import type { LabSimId } from '@/lib/items';
import { Spinner } from '@/components/ui';

const SIMS: Record<LabSimId, React.LazyExoticComponent<React.ComponentType<{ params?: Record<string, number> }>>> = {
  projectile: lazy(() => import('./sims/Projectile')),
  pendulum: lazy(() => import('./sims/Pendulum')),
  molecules: lazy(() => import('./sims/Molecules')),
  separation: lazy(() => import('./sims/Separation')),
  cell: lazy(() => import('./sims/Cell')),
  solar: lazy(() => import('./sims/Solar')),
  surface: lazy(() => import('./sims/Surface')),
  solids: lazy(() => import('./sims/Solids')),
};

export const SIM_INFO: Record<LabSimId, { title: string; area: string; desc: string }> = {
  projectile: { title: 'Tiro oblicuo', area: 'Física', desc: 'Gravedad, velocidad y ángulo: trayectoria, alcance y altura máxima.' },
  pendulum: { title: 'Péndulo simple', area: 'Física', desc: 'Oscilaciones, período y amortiguamiento.' },
  molecules: { title: 'Moléculas 3D', area: 'Química', desc: 'Geometría molecular, enlaces y polaridad.' },
  separation: { title: 'Separación magnética', area: 'Química', desc: 'Separación de mezclas en una planta de reciclaje.' },
  cell: { title: 'Célula animal y vegetal', area: 'Biología', desc: 'Organelas y sus funciones.' },
  solar: { title: 'Sistema solar', area: 'Astronomía', desc: 'Órbitas, períodos y leyes de Kepler.' },
  surface: { title: 'Superficies z = f(x, y)', area: 'Matemática', desc: 'Funciones de dos variables con parámetros.' },
  solids: { title: 'Sólidos geométricos', area: 'Geometría', desc: 'Volumen y área de cuerpos.' },
};

export default function LabSim({ sim, params }: { sim: LabSimId; params?: Record<string, number>; compact?: boolean }) {
  const C = SIMS[sim];
  return (
    <Suspense fallback={<Spinner className="m-10" />}>
      <C params={params} />
    </Suspense>
  );
}
