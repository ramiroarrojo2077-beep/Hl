import { BookOpen, Calendar, ChartColumn, ClipboardList, Clapperboard, FlaskConical, GraduationCap, House, Layers, Library, Network, PenTool, Settings, Timer, ClipboardCheck } from 'lucide-react';

export const NAV_MAIN = [
  { to: '/', label: 'Inicio', icon: House, end: true },
  { to: '/subjects', label: 'Materias', icon: BookOpen },
  { to: '/library', label: 'Biblioteca', icon: Library },
  { to: '/tutor', label: 'Profesor IA', icon: GraduationCap },
  { to: '/tasks', label: 'Mis tareas', icon: ClipboardList },
  { to: '/lab', label: 'Laboratorio 3D', icon: FlaskConical },
  { to: '/video', label: 'Estudio de video', icon: Clapperboard },
  { to: '/exams', label: 'Exámenes', icon: ClipboardCheck },
  { to: '/flashcards', label: 'Flashcards', icon: Layers },
  { to: '/calendar', label: 'Calendario', icon: Calendar },
  { to: '/stats', label: 'Estadísticas', icon: ChartColumn },
] as const;

export const NAV_TOOLS = [
  { to: '/board', label: 'Pizarra', icon: PenTool },
  { to: '/maps', label: 'Mapas conceptuales', icon: Network },
  { to: '/focus', label: 'Modo Focus', icon: Timer },
  { to: '/settings', label: 'Configuración', icon: Settings },
] as const;

export const NAV_MOBILE = ['/', '/subjects', '/tutor', '/tasks'] as const;
