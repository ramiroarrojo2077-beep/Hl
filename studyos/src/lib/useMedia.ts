import { useSyncExternalStore } from 'react';

/** true mientras la media query se cumple (se actualiza al rotar o redimensionar). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Pantallas con la barra lateral (breakpoint lg de Tailwind). */
export const useDesktop = () => useMedia('(min-width: 1024px)');
