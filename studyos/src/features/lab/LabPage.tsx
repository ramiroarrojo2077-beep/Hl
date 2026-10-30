import { useNavigate, useSearchParams } from 'react-router-dom';
import { Atom, Box, Dna, FlaskConical, GraduationCap, Orbit, Shapes, Sigma, Magnet, Activity } from 'lucide-react';
import { LAB_SIMS, type LabSimId } from '@/lib/items';
import { Button, PageHeader, cx } from '@/components/ui';
import LabSim, { SIM_INFO } from './LabSim';

const ICON: Record<LabSimId, React.ComponentType<{ className?: string }>> = { projectile: Activity, pendulum: Activity, molecules: Atom, separation: Magnet, cell: Dna, solar: Orbit, surface: Sigma, solids: Shapes };

export default function LabPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const sim = (LAB_SIMS as readonly string[]).includes(params.get('sim') ?? '') ? (params.get('sim') as LabSimId) : null;
  return (
    <div>
      <PageHeader
        title="Laboratorio 3D"
        subtitle="Simulaciones interactivas con parámetros reales. Cada una indica qué simplifica respecto del fenómeno real."
        icon={<Box className="size-5" />}
        actions={
          sim && (
            <Button icon={<GraduationCap className="size-4" />} onClick={() => nav(`/tutor?q=${encodeURIComponent(`Estoy usando la simulación de ${SIM_INFO[sim].title}. Explicame qué estoy viendo y proponeme un experimento.`)}`)}>
              Preguntar al profesor
            </Button>
          )
        }
      />
      <div className="flex gap-2 overflow-x-auto scroll-thin pb-2 mb-4">
        {LAB_SIMS.map((id) => {
          const I = ICON[id];
          return (
            <button key={id} onClick={() => setParams({ sim: id })} className={cx('shrink-0 tile flex items-center gap-2.5 px-3 py-2.5 text-left min-w-[190px]', sim === id && 'nav-active')}>
              <span className="grid place-items-center size-9 rounded-lg bg-primary/20 text-[#a9b8ff]">
                <I className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">{SIM_INFO[id].title}</span>
                <span className="block text-[11px] text-muted">{SIM_INFO[id].area}</span>
              </span>
            </button>
          );
        })}
      </div>
      {sim ? (
        <LabSim key={sim} sim={sim} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {LAB_SIMS.map((id) => {
            const I = ICON[id];
            return (
              <button key={id} onClick={() => setParams({ sim: id })} className="panel p-5 text-left hover:border-line-strong relative overflow-hidden">
                <div className="absolute -right-8 -bottom-8 size-28 rounded-full bg-violet/15 blur-2xl" />
                <I className="size-7 text-[#a9b8ff]" />
                <div className="font-display font-semibold mt-3">{SIM_INFO[id].title}</div>
                <div className="text-xs text-muted mt-1">{SIM_INFO[id].desc}</div>
                <div className="text-[11px] text-faint mt-2 inline-flex items-center gap-1">
                  <FlaskConical className="size-3" /> {SIM_INFO[id].area}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
