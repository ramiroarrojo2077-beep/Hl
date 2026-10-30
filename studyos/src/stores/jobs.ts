import { create } from 'zustand';
import { newId } from '@/lib/ids';
import { aiErrorMessage, isAbort } from '@/ai/types';

// Tareas largas en segundo plano (importar, generar resúmenes, exámenes, videos)
// con progreso real y cancelación. No sobreviven al cierre de la app: lo ya
// guardado persiste y lo que estaba en curso se puede volver a lanzar.

export interface Job {
  id: string;
  title: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: number | null;
  detail: string;
  error?: string;
  route?: string;
  startedAt: number;
  controller: AbortController;
}

export interface JobCtx {
  signal: AbortSignal;
  progress: (p: number | null, detail?: string) => void;
}

interface JobsState {
  jobs: Job[];
  run: <T>(title: string, fn: (ctx: JobCtx) => Promise<T>, opts?: { route?: (r: T) => string | undefined }) => Promise<T | undefined>;
  cancel: (id: string) => void;
  dismiss: (id: string) => void;
}

export const useJobs = create<JobsState>((set, get) => ({
  jobs: [],
  run: async (title, fn, opts) => {
    const job: Job = { id: newId(), title, status: 'running', progress: null, detail: 'Iniciando…', startedAt: Date.now(), controller: new AbortController() };
    set({ jobs: [job, ...get().jobs].slice(0, 12) });
    const patch = (p: Partial<Job>) => set({ jobs: get().jobs.map((j) => (j.id === job.id ? { ...j, ...p } : j)) });
    try {
      const r = await fn({ signal: job.controller.signal, progress: (p, detail) => patch({ progress: p, ...(detail ? { detail } : {}) }) });
      patch({ status: 'done', progress: 1, detail: 'Completado', route: opts?.route?.(r) });
      setTimeout(() => get().dismiss(job.id), 12_000);
      return r;
    } catch (e) {
      if (isAbort(e) || job.controller.signal.aborted) patch({ status: 'cancelled', detail: 'Cancelado' });
      else patch({ status: 'error', error: aiErrorMessage(e), detail: 'Error' });
      return undefined;
    }
  },
  cancel: (id) => {
    get().jobs.find((j) => j.id === id)?.controller.abort();
  },
  dismiss: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) }),
}));

export function runJob<T>(title: string, fn: (ctx: JobCtx) => Promise<T>, opts?: { route?: (r: T) => string | undefined }) {
  return useJobs.getState().run(title, fn, opts);
}
