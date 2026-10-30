import { useNavigate, useSearchParams } from 'react-router-dom';
import { Atom, Box, Dna, FlaskConical, GraduationCap, Orbit, Shapes, Sigma, Magnet, Activity } from 'lucide-react';
import { LAB_SIMS, type LabSimId } from '@/lib/items';
import { Button, PageHeader, cx } from '@/components/ui';
import LabSim, { SIM_INFO } from './LabSim';

// Color por área (mismos tonos que las materias)
const AREA_COLOR: Record<string, { from: string; to: string; text: string }> = {
  Física: { from: '#6c35d9', to: '#3b1a85', text: '#c4a6ff' },
  Química: { from: '#0f8f7e', to: '#0a4f49', text: '#4ee0c0' },
  Biología: { from: '#1f8f4c', to: '#10502c', text: '#6ff59b' },
  Astronomía: { from: '#2a49e8', to: '#1a2a8c', text: '#8ea9ff' },
  Matemática: { from: '#b9541c', to: '#6b2a0c', text: '#ffad66' },
  Geometría: { from: '#b82a6a', to: '#6a1340', text: '#ff8fc0' },
};
const areaColor = (a: string) => AREA_COLOR[a] ?? AREA_COLOR.Astronomía;

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
      <div className={cx('gap-2 overflow-x-auto scroll-thin pb-2 mb-4', sim ? 'flex' : 'hidden sm:flex')}>
        {LAB_SIMS.map((id) => {
          const I = ICON[id];
          return (
            <button key={id} onClick={() => setParams({ sim: id })} className={cx('shrink-0 tile flex items-center gap-2.5 px-3 py-2.5 text-left min-w-[190px]', sim === id && 'nav-active')}>
              <span className="grid place-items-center size-9 rounded-lg text-white" style={{ background: `linear-gradient(135deg, ${areaColor(SIM_INFO[id].area).from}, ${areaColor(SIM_INFO[id].area).to})` }}>
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
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
          {LAB_SIMS.map((id) => {
            const I = ICON[id];
            const c = areaColor(SIM_INFO[id].area);
            return (
              <button key={id} onClick={() => setParams({ sim: id })} className="panel p-3.5 sm:p-5 text-left hover:border-line-strong active:scale-[.98] transition relative overflow-hidden flex flex-col">
                <div className="absolute -right-8 -top-8 size-28 rounded-full blur-2xl opacity-40" style={{ background: c.from }} />
                <span className="relative grid place-items-center size-11 rounded-[13px] text-white shadow-[0_10px_22px_-12px_rgba(0,0,0,.8)]" style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}>
                  <I className="size-5" />
                </span>
                <div className="relative font-display font-semibold text-[14.5px] sm:text-base leading-tight mt-3">{SIM_INFO[id].title}</div>
                <div className="relative text-[11.5px] sm:text-xs text-muted mt-1 line-clamp-3">{SIM_INFO[id].desc}</div>
                <div className="relative text-[11px] mt-auto pt-2 inline-flex items-center gap-1" style={{ color: c.text }}>
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
