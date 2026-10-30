import { addDays, startOfDay, daysBetween } from './format';

// Planificador determinístico: reparte temas entre hoy y el día anterior al
// examen, con una sesión de aprendizaje por tema, repasos espaciados (≈1 y 3
// días después) y un repaso general final. Respeta los minutos máximos por día
// y deja días libres si sobra tiempo. Todo es editable después.

export interface PlanInput {
  examDate: number;
  topics: string[];
  minutesPerDay: number;
  startDate?: number;
  sessionMinutes?: number;
  restDays?: number[]; // 0=domingo..6=sábado
  startHour?: number;
}

export interface PlannedSession {
  title: string;
  topic: string;
  kind: 'learn' | 'review' | 'final';
  day: number; // timestamp inicio de día
  start: number;
  minutes: number;
}

export interface PlanResult {
  sessions: PlannedSession[];
  warnings: string[];
}

export function buildPlan(input: PlanInput): PlanResult {
  const warnings: string[] = [];
  const today = startOfDay(input.startDate ?? Date.now());
  const exam = startOfDay(input.examDate);
  const topics = input.topics.map((t) => t.trim()).filter(Boolean);
  const sessionMin = input.sessionMinutes ?? Math.min(50, Math.max(25, Math.round(input.minutesPerDay / 2)));
  const startHour = input.startHour ?? 17;
  if (!topics.length) return { sessions: [], warnings: ['No hay temas para planificar.'] };
  const totalDays = daysBetween(today, exam); // días disponibles antes del examen
  if (totalDays <= 0) return { sessions: [], warnings: ['La fecha del examen tiene que ser posterior a hoy.'] };

  const rest = new Set(input.restDays ?? []);
  const days: number[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(today, i);
    if (!rest.has(new Date(d).getDay())) days.push(d);
  }
  if (!days.length) return { sessions: [], warnings: ['Todos los días disponibles están marcados como descanso.'] };

  const capacity = new Map<number, number>(days.map((d) => [d, input.minutesPerDay]));
  const sessions: PlannedSession[] = [];
  const place = (s: Omit<PlannedSession, 'start' | 'day'>, preferIdx: number): boolean => {
    for (let k = 0; k < days.length; k++) {
      // busca el día preferido y luego hacia adelante, después hacia atrás
      const idx = preferIdx + k < days.length ? preferIdx + k : preferIdx - (k - (days.length - 1 - preferIdx));
      if (idx < 0 || idx >= days.length) continue;
      const d = days[idx];
      const cap = capacity.get(d)!;
      if (cap >= s.minutes) {
        const used = input.minutesPerDay - cap;
        capacity.set(d, cap - s.minutes);
        sessions.push({ ...s, day: d, start: d + startHour * 3600_000 + used * 60_000 + (used ? 10 * 60_000 : 0) });
        return true;
      }
    }
    return false;
  };

  // Último día disponible reservado para el repaso final cuando hay más de 2 días.
  const finalIdx = days.length >= 3 ? days.length - 1 : -1;
  const learnDays = finalIdx >= 0 ? days.length - 1 : days.length;
  const step = learnDays / topics.length;

  topics.forEach((topic, i) => {
    const idx = Math.min(learnDays - 1, Math.floor(i * step));
    if (!place({ title: `Estudiar: ${topic}`, topic, kind: 'learn', minutes: sessionMin }, idx)) {
      warnings.push(`No entra una sesión para "${topic}" con ${input.minutesPerDay} min por día.`);
      return;
    }
    const placedIdx = days.indexOf(sessions[sessions.length - 1].day);
    for (const gap of [1, 3]) {
      const ri = placedIdx + gap;
      if (ri < learnDays) place({ title: `Repasar: ${topic}`, topic, kind: 'review', minutes: Math.max(15, Math.round(sessionMin / 2)) }, ri);
    }
  });

  if (finalIdx >= 0) {
    place({ title: 'Repaso general y simulacro', topic: topics.join(', '), kind: 'final', minutes: Math.min(input.minutesPerDay, Math.max(sessionMin, 45)) }, finalIdx);
  }

  const needed = topics.length * sessionMin;
  const available = days.length * input.minutesPerDay;
  if (needed > available) warnings.push('El tiempo disponible es menor al recomendado; considerá aumentar los minutos por día o priorizar temas.');
  if (topics.length > days.length * 2) warnings.push('Hay muchos temas para pocos días: el plan agrupa varios por día.');

  sessions.sort((a, b) => a.start - b.start);
  return { sessions, warnings };
}
