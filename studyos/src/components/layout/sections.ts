// Identidad visual de cada sección: dos colores de acento (los mismos de las
// acciones rápidas del inicio) y el motivo ilustrado de su encabezado. Se usa
// en los encabezados de página, la navegación inferior y la hoja «Más».

export type SectionArtKey = 'subjects' | 'library' | 'tutor' | 'tasks' | 'lab' | 'video' | 'exams' | 'flashcards' | 'calendar' | 'stats' | 'settings' | 'board' | 'maps' | 'focus' | 'home';

export interface SectionTheme {
  art: SectionArtKey;
  from: string;
  to: string;
}

export const SECTION_THEME: Record<string, SectionTheme> = {
  '/': { art: 'home', from: '#3d5bff', to: '#8b5cf6' },
  '/subjects': { art: 'subjects', from: '#3d5bff', to: '#8b5cf6' },
  '/library': { art: 'library', from: '#5a5cff', to: '#22d3ee' },
  '/summaries': { art: 'library', from: '#12a58a', to: '#22d3ee' },
  '/tutor': { art: 'tutor', from: '#2e7bff', to: '#3d4dff' },
  '/tasks': { art: 'tasks', from: '#8b5cf6', to: '#d946ef' },
  '/lab': { art: 'lab', from: '#1f6dff', to: '#22d3ee' },
  '/video': { art: 'video', from: '#e0389a', to: '#a92ad6' },
  '/exams': { art: 'exams', from: '#8b4dff', to: '#5b5cff' },
  '/flashcards': { art: 'flashcards', from: '#5a4dd6', to: '#a78bfa' },
  '/calendar': { art: 'calendar', from: '#12a58a', to: '#22d3ee' },
  '/stats': { art: 'stats', from: '#22d3ee', to: '#3d7bff' },
  '/settings': { art: 'settings', from: '#5b6b95', to: '#8b9be8' },
  '/board': { art: 'board', from: '#16a34a', to: '#12a58a' },
  '/maps': { art: 'maps', from: '#1fb3a1', to: '#2f63ff' },
  '/focus': { art: 'focus', from: '#ff8a3d', to: '#e0389a' },
};

export function sectionRoot(pathname: string) {
  return '/' + (pathname.split('/').filter(Boolean)[0] ?? '');
}

export function sectionTheme(pathname: string): SectionTheme {
  return SECTION_THEME[sectionRoot(pathname)] ?? SECTION_THEME['/'];
}

/** Gradiente de la sección para fondos de íconos (CSS). */
export function sectionGradient(t: SectionTheme, angle = 135) {
  return `linear-gradient(${angle}deg, ${t.from}, ${t.to})`;
}
