import { lazy, Suspense, useState } from 'react';
import { ArrowRight, FlaskConical } from 'lucide-react';
import type { Media } from '@/lib/items';
import { Button, Modal, Spinner } from '../ui';
import { FunctionPlot } from './FunctionPlot';

const LabSim = lazy(() => import('@/features/lab/LabSim'));

export function ItemMedia({ media }: { media: Media }) {
  const [lab, setLab] = useState(false);
  if (media.kind === 'chart') return <FunctionPlot expression={media.expression} xMin={media.xMin} xMax={media.xMax} title={media.title} />;
  if (media.kind === 'table')
    return (
      <div className="overflow-x-auto rounded-xl border border-line">
        {media.title && <div className="text-xs text-muted px-3 pt-2">{media.title}</div>}
        <table className="w-full text-sm">
          <thead>
            <tr>
              {media.headers.map((h, i) => (
                <th key={i} className="text-left px-3 py-2 bg-primary/10 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {media.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-1.5">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (media.kind === 'diagram')
    return (
      <figure className="rounded-xl border border-line bg-[#0a1024] p-3">
        {media.title && <figcaption className="text-xs text-muted mb-2">{media.title}</figcaption>}
        <div className="flex flex-wrap gap-2 mb-2">
          {media.nodes.map((n) => (
            <span key={n} className="rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs">
              {n}
            </span>
          ))}
        </div>
        <ul className="space-y-1 text-xs text-[#cdd5f0]">
          {media.edges.map((e, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="font-medium">{e.from}</span>
              <ArrowRight className="size-3 text-cyan" />
              {e.label && <span className="text-muted italic">{e.label}</span>}
              {e.label && <ArrowRight className="size-3 text-cyan" />}
              <span className="font-medium">{e.to}</span>
            </li>
          ))}
        </ul>
      </figure>
    );
  return (
    <div className="rounded-xl border border-violet/40 bg-violet/10 p-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-2 text-sm">
        <FlaskConical className="size-4 text-[#d6c8ff] mt-0.5 shrink-0" />
        <span>{media.instructions}</span>
      </div>
      <Button size="sm" variant="primary" onClick={() => setLab(true)}>
        Abrir simulación 3D
      </Button>
      <Modal open={lab} onClose={() => setLab(false)} title="Laboratorio 3D" wide>
        <Suspense fallback={<Spinner />}>
          <LabSim sim={media.simId} params={media.params} compact />
        </Suspense>
      </Modal>
    </div>
  );
}
