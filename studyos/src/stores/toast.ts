import { create } from 'zustand';
import { newId } from '@/lib/ids';

export interface Toast {
  id: string;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: Toast['kind'], text: string) => void;
  remove: (id: string) => void;
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, text) => {
    const t = { id: newId(), kind, text };
    set({ toasts: [...get().toasts, t].slice(-4) });
    setTimeout(() => get().remove(t.id), kind === 'error' ? 7000 : 3500);
  },
  remove: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  ok: (t: string) => useToasts.getState().push('ok', t),
  error: (t: string) => useToasts.getState().push('error', t),
  info: (t: string) => useToasts.getState().push('info', t),
};
