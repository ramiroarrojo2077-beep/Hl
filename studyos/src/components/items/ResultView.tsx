import { useState } from 'react';
import { CircleCheck, CircleX, Gauge, Pencil } from 'lucide-react';
import { correctAnswerText, type Item } from '@/lib/items';
import type { ItemResult } from '@/lib/db';
import { Badge, Button, cx } from '../ui';
import { Markdown } from '../Markdown';

/** Corrección de un ítem: puntaje, criterios, solución y revisión manual. */
export function ResultView({ item, result, onOverride }: { item: Item; result: ItemResult; onOverride?: (r: ItemResult) => void }) {
  const [edit, setEdit] = useState(false);
  const [crit, setCrit] = useState(result.criteria?.map((c) => c.awarded) ?? []);
  const [score, setScore] = useState(result.score);
  const good = result.correct === true || result.score >= result.max * 0.999;
  const bad = result.correct === false || result.score === 0;
  return (
    <div className={cx('rounded-xl border p-3.5 space-y-2.5 text-sm', good ? 'border-ok/40 bg-ok/[.06]' : bad ? 'border-bad/40 bg-bad/[.06]' : 'border-warn/40 bg-warn/[.06]')}>
      <div className="flex flex-wrap items-center gap-2">
        {good ? <CircleCheck className="size-4 text-ok" /> : bad ? <CircleX className="size-4 text-bad" /> : <Gauge className="size-4 text-warn" />}
        <span className="font-medium">
          {result.score} / {result.max} pts
        </span>
        <Badge tone={result.gradedBy === 'auto' ? 'neutral' : result.gradedBy === 'ai' ? 'violet' : result.gradedBy === 'manual' ? 'primary' : 'warn'}>
          {result.gradedBy === 'auto' ? 'Corrección automática' : result.gradedBy === 'ai' ? `Corregido por IA · confianza ${result.confidence ?? 'media'}` : result.gradedBy === 'manual' ? 'Revisado manualmente' : 'Pendiente de revisión'}
        </Badge>
      </div>
      {result.feedback && <Markdown className="!text-sm">{result.feedback}</Markdown>}
      {result.criteria && result.criteria.length > 0 && (
        <ul className="space-y-1.5">
          {result.criteria.map((c, i) => (
            <li key={c.id} className="flex items-start gap-2">
              <span className="font-mono text-xs mt-0.5 shrink-0 w-16">
                {edit ? (
                  <input type="number" min={0} max={c.points} step={0.5} value={crit[i]} onChange={(e) => setCrit((v) => v.map((x, j) => (j === i ? Math.max(0, Math.min(c.points, Number(e.target.value))) : x)))} className="w-14 h-7 rounded bg-[#0a102a] border border-line px-1" aria-label={`Puntos del criterio ${i + 1}`} />
                ) : (
                  `${c.awarded}/${c.points}`
                )}
              </span>
              <span>
                {c.description}
                {c.comment && <span className="block text-xs text-muted">{c.comment}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(!good || item.type === 'essay' || item.type === 'problem') && (
        <div className="rounded-lg bg-black/20 p-3 space-y-1.5">
          <div className="text-xs text-muted">Respuesta esperada</div>
          <Markdown className="!text-sm">{correctAnswerText(item)}</Markdown>
          {item.solutionSteps.length > 0 && (
            <ol className="list-decimal pl-5 space-y-1 text-[13px] text-[#d4dbef]">
              {item.solutionSteps.map((s, i) => (
                <li key={i}>
                  <Markdown className="!text-[13px]">{s}</Markdown>
                </li>
              ))}
            </ol>
          )}
          {item.explanation && <Markdown className="!text-[13px] text-muted">{item.explanation}</Markdown>}
        </div>
      )}
      {onOverride && (result.gradedBy !== 'auto' || item.type === 'short') && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {edit ? (
            <>
              {!result.criteria?.length && (
                <label className="text-xs flex items-center gap-1.5">
                  Puntos
                  <input type="number" min={0} max={result.max} step={0.5} value={score} onChange={(e) => setScore(Math.max(0, Math.min(result.max, Number(e.target.value))))} className="w-16 h-8 rounded bg-[#0a102a] border border-line px-1.5" />
                </label>
              )}
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const criteria = result.criteria?.map((c, i) => ({ ...c, awarded: crit[i] }));
                  const total = criteria ? criteria.reduce((s, c) => s + c.points, 0) || 1 : 1;
                  const sc = criteria ? Math.round((criteria.reduce((s, c) => s + c.awarded, 0) / total) * result.max * 100) / 100 : score;
                  onOverride({ ...result, criteria, score: sc, correct: sc >= result.max * 0.999 ? true : sc === 0 ? false : null, gradedBy: 'manual', disputed: true });
                  setEdit(false);
                }}
              >
                Guardar revisión
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <button className="inline-flex items-center gap-1.5 text-xs text-[#8ea2ff]" onClick={() => setEdit(true)}>
              <Pencil className="size-3.5" /> {result.gradedBy === 'pending' ? 'Corregir manualmente' : 'La corrección no es justa: revisarla'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
