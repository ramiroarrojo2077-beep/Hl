import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck, CircleX, Info } from 'lucide-react';
import { useToasts } from '@/stores/toast';

export function Toasts() {
  const { toasts, remove } = useToasts();
  return (
    <div className="fixed z-[60] top-[calc(var(--safe-top)+12px)] left-1/2 -translate-x-1/2 w-[min(420px,calc(100vw-24px))] space-y-2 pointer-events-none" role="status">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            onClick={() => remove(t.id)}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="glass w-full rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 text-left text-sm pointer-events-auto shadow-xl"
          >
            {t.kind === 'ok' ? <CircleCheck className="size-4 text-ok mt-0.5 shrink-0" /> : t.kind === 'error' ? <CircleX className="size-4 text-bad mt-0.5 shrink-0" /> : <Info className="size-4 text-cyan mt-0.5 shrink-0" />}
            <span>{t.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
