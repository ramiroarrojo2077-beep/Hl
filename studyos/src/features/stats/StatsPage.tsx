import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartColumn } from 'lucide-react';
import { db } from '@/lib/db';
import { addDays, fmtDate, fmtMinutes, startOfDay } from '@/lib/format';
import { MASTERY_LABEL, masteryLevel } from '@/lib/mastery';
import { computeStreak, activeDays, studyMinutesByDay } from '@/lib/stats';
import { Badge, EmptyState, PageHeader, Panel, ProgressBar, Segmented, Stat } from '@/components/ui';

const tooltipStyle = { background: '#121b3a', border: '1px solid rgba(120,140,255,.3)', borderRadius: 10, fontSize: 12, color: '#eef2ff' };

export default function StatsPage() {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [minutes, setMinutes] = useState<{ day: string; min: number }[]>([]);
  const [streak, setStreak] = useState(0);
  const exams = useLiveQuery(() => db.examAttempts.where('status').equals('graded').sortBy('startedAt'), []) ?? [];
  const taskAttempts = useLiveQuery(() => db.taskAttempts.where('status').equals('graded').sortBy('submittedAt'), []) ?? [];
  const reviews = useLiveQuery(() => db.reviews.toArray(), []) ?? [];
  const mastery = useLiveQuery(() => db.mastery.toArray(), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const activity = useLiveQuery(() => db.activity.orderBy('at').reverse().limit(30).toArray(), []) ?? [];
  const tick = exams.length + taskAttempts.length + reviews.length;
  useEffect(() => {
    const today = startOfDay();
    const from = addDays(today, -(range - 1));
    studyMinutesByDay(from, addDays(today, 1)).then((m) => setMinutes(Array.from({ length: range }, (_, i) => ({ day: fmtDate(addDays(from, i), range > 30 ? { day: 'numeric', month: 'numeric' } : { day: 'numeric', month: 'short' }), min: Math.round(m.get(addDays(from, i)) ?? 0) }))));
    activeDays(addDays(today, -400)).then((d) => setStreak(computeStreak(d)));
  }, [range, tick]);
  const scores = useMemo(
    () =>
      [
        ...exams.map((a) => ({ at: a.finishedAt ?? a.startedAt, pct: a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0, kind: 'Examen' })),
        ...taskAttempts.map((a) => ({ at: a.submittedAt ?? a.updatedAt, pct: a.maxScore ? Math.round(((a.score ?? 0) / a.maxScore) * 100) : 0, kind: 'Tarea' })),
      ]
        .sort((a, b) => a.at - b.at)
        .slice(-30)
        .map((x) => ({ ...x, label: fmtDate(x.at) })),
    [exams, taskAttempts],
  );
  const recall = reviews.length ? reviews.filter((r) => r.grade >= 3).length / reviews.length : null;
  const withData = mastery.filter((m) => m.attempts > 0);
  const total = minutes.reduce((s, x) => s + x.min, 0);
  const subjName = (id?: string) => subjects.find((s) => s.id === id)?.name ?? 'General';
  const hasAny = total > 0 || scores.length > 0 || reviews.length > 0 || withData.length > 0;
  return (
    <div>
      <PageHeader title="Estadísticas" subtitle="Calculadas solo con lo que registraste en el dispositivo. Son indicadores de estudio, no evaluaciones de tu capacidad." icon={<ChartColumn className="size-5" />} actions={<Segmented size="sm" value={range} onChange={setRange} options={[{ value: 7, label: '7 días' }, { value: 30, label: '30 días' }, { value: 90, label: '90 días' }]} />} />
      {!hasAny ? (
        <EmptyState icon={<ChartColumn className="size-6" />} title="Todavía no hay datos" text="Hacé una sesión Focus, repasá flashcards o entregá una tarea o examen para ver tus estadísticas." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label={`Tiempo registrado (${range} d)`} value={fmtMinutes(total)} hint="Focus + exámenes + tareas + flashcards" />
            <Stat label="Racha" value={`${streak} días`} />
            <Stat label="Aciertos en flashcards" value={recall === null ? '—' : `${Math.round(recall * 100)}%`} hint={`${reviews.length} repasos`} />
            <Stat label="Conceptos dominados" value={`${withData.filter((m) => masteryLevel(m) === 'mastered').length}/${withData.length}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="p-4">
              <h3 className="font-display font-semibold text-sm mb-3">Minutos de estudio por día</h3>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={minutes}>
                    <CartesianGrid stroke="rgba(150,165,220,.1)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: '#8590b5', fontSize: 10 }} interval={range > 7 ? Math.ceil(range / 8) : 0} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: '#8590b5', fontSize: 10 }} width={30} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(120,140,255,.08)' }} formatter={(v) => [`${v} min`, 'Estudio']} />
                    <Bar dataKey="min" fill="#5b7bff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel className="p-4">
              <h3 className="font-display font-semibold text-sm mb-3">Resultados de exámenes y tareas</h3>
              {scores.length === 0 ? (
                <p className="text-sm text-muted">Sin entregas corregidas.</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <LineChart data={scores}>
                      <CartesianGrid stroke="rgba(150,165,220,.1)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: '#8590b5', fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#8590b5', fontSize: 10 }} width={30} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, p) => [`${v}%`, (p.payload as { kind: string }).kind]} />
                      <Line type="monotone" dataKey="pct" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3, fill: '#22d3ee' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
          </div>
          <Panel className="p-4">
            <h3 className="font-display font-semibold text-sm mb-3">Dominio por concepto</h3>
            {withData.length === 0 ? (
              <p className="text-sm text-muted">Se calcula con tus respuestas en tareas, exámenes y flashcards con concepto asociado.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
                {withData
                  .sort((a, b) => a.score - b.score)
                  .slice(0, 30)
                  .map((m) => {
                    const lv = masteryLevel(m);
                    return (
                      <div key={m.id}>
                        <div className="flex items-center justify-between gap-2 text-sm mb-1">
                          <span className="truncate">
                            {m.concept} <span className="text-[11px] text-faint">· {subjName(m.subjectId)}</span>
                          </span>
                          <Badge tone={lv === 'mastered' ? 'ok' : lv === 'weak' ? 'bad' : 'warn'}>{MASTERY_LABEL[lv]}</Badge>
                        </div>
                        <ProgressBar value={m.score} tone={lv === 'mastered' ? 'ok' : lv === 'weak' ? 'bad' : 'warn'} />
                      </div>
                    );
                  })}
              </div>
            )}
          </Panel>
          <Panel className="p-4">
            <h3 className="font-display font-semibold text-sm mb-2">Actividad reciente</h3>
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id} className="py-2 flex justify-between gap-3 text-sm">
                  <span className="truncate">{a.title}</span>
                  <span className="text-xs text-muted shrink-0">{fmtDate(a.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}
