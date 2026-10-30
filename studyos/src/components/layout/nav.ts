import { BookOpen, Calendar, ChartColumn, ClipboardList, Copy, FileText, House, Layers, Network, PenTool, Settings, Timer, UserRound, Box, Video } from 'lucide-react';

export const NAV_MAIN = [
  { to: '/', label: 'Inicio', icon: House, end: true },
  { to: '/subjects', label: 'Materias', icon: BookOpen },
  { to: '/library', label: 'Biblioteca', icon: Copy },
  { to: '/tutor', label: 'Profesor IA', icon: UserRound },
  { to: '/tasks', label: 'Mis tareas', icon: ClipboardList },
  { to: '/lab', label: 'Laboratorio 3D', icon: Box },
  { to: '/video', label: 'Estudio de Video', icon: Video },
  { to: '/exams', label: 'Exámenes', icon: FileText },
  { to: '/flashcards', label: 'Flashcards', icon: Layers },
  { to: '/calendar', label: 'Calendario', icon: Calendar },
  { to: '/stats', label: 'Estadísticas', icon: ChartColumn },
  { to: '/settings', label: 'Configuración', icon: Settings },
] as const;

export const NAV_TOOLS = [
  { to: '/board', label: 'Pizarra', icon: PenTool },
  { to: '/maps', label: 'Mapas conceptuales', icon: Network },
  { to: '/focus', label: 'Modo Focus', icon: Timer },
] as const;

export const NAV_MOBILE = ['/', '/subjects', '/tutor', '/tasks'] as const;
