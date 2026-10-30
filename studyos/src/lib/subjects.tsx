import type { ReactNode } from 'react';
import { Atom, BookOpen, Calculator, Dna, FlaskConical, Globe, Landmark, Languages, Leaf, Monitor, Music, Palette, PenTool } from 'lucide-react';

// Paleta e íconos de materias (mismo lenguaje visual del dashboard).

export interface SubjectStyle {
  id: string;
  label: string;
  bg: string;
  border: string;
  bar: string;
  soft: string;
  text: string;
}

export const SUBJECT_STYLES: SubjectStyle[] = [
  { id: 'blue', label: 'Azul', bg: 'linear-gradient(160deg,#2a49e8 0%,#1a2a8c 100%)', border: 'rgba(140,165,255,.55)', bar: '#6ec1ff', soft: '#d8e0ff', text: '#8ea9ff' },
  { id: 'purple', label: 'Violeta', bg: 'linear-gradient(160deg,#6c35d9 0%,#3b1a85 100%)', border: 'rgba(190,150,255,.55)', bar: '#b98cff', soft: '#e6dcff', text: '#c4a6ff' },
  { id: 'teal', label: 'Turquesa', bg: 'linear-gradient(160deg,#0f8f7e 0%,#0a4f49 100%)', border: 'rgba(90,230,200,.45)', bar: '#4cf0c7', soft: '#d4fff5', text: '#4ee0c0' },
  { id: 'green', label: 'Verde', bg: 'linear-gradient(160deg,#1f8f4c 0%,#10502c 100%)', border: 'rgba(110,235,150,.45)', bar: '#6ff59b', soft: '#dcffe7', text: '#6ff59b' },
  { id: 'orange', label: 'Naranja', bg: 'linear-gradient(160deg,#b9541c 0%,#6b2a0c 100%)', border: 'rgba(255,170,100,.5)', bar: '#ffa24d', soft: '#ffe4cc', text: '#ffad66' },
  { id: 'pink', label: 'Rosa', bg: 'linear-gradient(160deg,#b82a6a 0%,#6a1340 100%)', border: 'rgba(255,140,190,.5)', bar: '#ff7ab3', soft: '#ffdbea', text: '#ff8fc0' },
  { id: 'cyan', label: 'Celeste', bg: 'linear-gradient(160deg,#0f6d93 0%,#0a3a5a 100%)', border: 'rgba(90,210,255,.5)', bar: '#45d5ff', soft: '#d6f6ff', text: '#5fdcff' },
  { id: 'slate', label: 'Grafito', bg: 'linear-gradient(160deg,#3b4669 0%,#1d243d 100%)', border: 'rgba(170,185,230,.4)', bar: '#c3cdea', soft: '#e3e8f7', text: '#c3cdea' },
];

export function subjectStyle(color: string | undefined): SubjectStyle {
  return SUBJECT_STYLES.find((s) => s.id === color) ?? SUBJECT_STYLES[0];
}

export const SUBJECT_ICONS = ['fx', 'atom', 'flask', 'leaf', 'landmark', 'book', 'monitor', 'globe', 'pen', 'languages', 'dna', 'calc', 'music', 'palette'] as const;
export type SubjectIcon = (typeof SUBJECT_ICONS)[number];

export function SubjectGlyph({ icon, className = 'size-6', color }: { icon: string; className?: string; color?: string }): ReactNode {
  const p = { className, style: color ? { color } : undefined, strokeWidth: 1.8 };
  switch (icon) {
    case 'fx':
      return (
        <span className={className} style={{ fontFamily: 'Poppins, sans-serif', fontStyle: 'italic', fontWeight: 600, lineHeight: 1, display: 'inline-grid', placeItems: 'center', fontSize: '1.15em', color }}>
          ƒx
        </span>
      );
    case 'atom': return <Atom {...p} />;
    case 'flask': return <FlaskConical {...p} />;
    case 'leaf': return <Leaf {...p} />;
    case 'landmark': return <Landmark {...p} />;
    case 'book': return <BookOpen {...p} />;
    case 'monitor': return <Monitor {...p} />;
    case 'globe': return <Globe {...p} />;
    case 'pen': return <PenTool {...p} />;
    case 'languages': return <Languages {...p} />;
    case 'dna': return <Dna {...p} />;
    case 'calc': return <Calculator {...p} />;
    case 'music': return <Music {...p} />;
    case 'palette': return <Palette {...p} />;
    default: return <BookOpen {...p} />;
  }
}

export const SUBJECT_PRESETS: { name: string; color: string; icon: SubjectIcon; category: string }[] = [
  { name: 'Matemática', color: 'blue', icon: 'fx', category: 'Ciencias exactas' },
  { name: 'Física', color: 'purple', icon: 'atom', category: 'Ciencias naturales' },
  { name: 'Química', color: 'teal', icon: 'flask', category: 'Ciencias naturales' },
  { name: 'Biología', color: 'green', icon: 'leaf', category: 'Ciencias naturales' },
  { name: 'Historia', color: 'orange', icon: 'landmark', category: 'Ciencias sociales' },
  { name: 'Geografía', color: 'cyan', icon: 'globe', category: 'Ciencias sociales' },
  { name: 'Literatura', color: 'pink', icon: 'pen', category: 'Lengua' },
  { name: 'Inglés', color: 'pink', icon: 'book', category: 'Idiomas' },
  { name: 'Informática', color: 'cyan', icon: 'monitor', category: 'Tecnología' },
];

/** Ícono de la materia sobre su gradiente (o neutro si no tiene materia). */
export function SubjectIconTile({ subject, className = 'size-10 rounded-xl', glyph = 'size-5', fallback = 'book' }: { subject?: { color: string; icon: string }; className?: string; glyph?: string; fallback?: string }) {
  const st = subjectStyle(subject?.color ?? 'slate');
  return (
    <span className={`grid place-items-center shrink-0 text-white ${className}`} style={{ background: st.bg, boxShadow: `inset 0 0 0 1px ${st.border}` }}>
      <SubjectGlyph icon={subject?.icon ?? fallback} className={glyph} color={subject?.icon === 'leaf' ? st.bar : undefined} />
    </span>
  );
}

/** Puntos de dificultad 1..5 */
export function DifficultyDots({ value, color = '#8ea2ff' }: { value: number; color?: string }) {
  const v = Math.max(1, Math.min(5, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label={`Dificultad ${v} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="size-[6px] rounded-full" style={{ background: i <= v ? color : 'rgba(150,165,220,.22)' }} />
      ))}
    </span>
  );
}
