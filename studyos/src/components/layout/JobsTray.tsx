import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, CircleX, X } from 'lucide-react';
import { useJobs } from '@/stores/jobs';
import { ProgressBar, Spinner } from '../ui';

export function JobsTray() {
  const { jobs, cancel, dismiss } = useJobs();
  const nav = useNavigate();
  return (
    <div className="fixed z-40 right-3 bottom-20 lg:bottom-4 w-[min(360px,calc(100vw-24px))] space-y-2 pointer-events-none" aria-live="polite">
      <AnimatePresence>
        {jobs.map((j) => (
          <motion.div key={j.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }} className="glass rounded-2xl p-3 pointer-events-auto shadow-2xl">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5">{j.status === 'running' ? <Spinner /> : j.status === 'done' ? <CircleCheck className="size-4 text-ok" /> : <CircleX className="size-4 text-bad" />}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{j.title}</div>
                <div className="text-xs text-muted truncate">{j.error ?? j.detail}</div>
                {j.status === 'running' && j.progress !== null && <ProgressBar value={j.progress} className="mt-2" />}
                <div className="flex gap-3 mt-1.5">
                  {j.status === 'running' && (
                    <button className="text-xs text-bad hover:underline" onClick={() => cancel(j.id)}>
                      Cancelar
                    </button>
                  )}
                  {j.status === 'done' && j.route && (
                    <button
                      className="text-xs text-[#a9b8ff] hover:underline"
                      onClick={() => {
                        nav(j.route!);
                        dismiss(j.id);
                      }}
                    >
                      Abrir resultado
                    </button>
                  )}
                </div>
              </div>
              {j.status !== 'running' && (
                <button className="text-faint hover:text-ink" onClick={() => dismiss(j.id)} aria-label="Descartar">
                  <X className="size-4" />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
