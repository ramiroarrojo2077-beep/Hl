import type { DocKind } from '@/lib/db';

const KIND: Record<DocKind, { label: string; color: string }> = {
  pdf: { label: 'PDF', color: '#e5484d' },
  docx: { label: 'DOC', color: '#2b6cf0' },
  pptx: { label: 'PPT', color: '#e0662b' },
  image: { label: 'IMG', color: '#1fa971' },
  txt: { label: 'TXT', color: '#5b6b95' },
  paste: { label: 'TXT', color: '#7a5af0' },
};

/** Ícono de archivo con esquina doblada y el color del formato. */
export function DocTypeIcon({ kind, size = 'md' }: { kind: DocKind; size?: 'sm' | 'md' }) {
  const k = KIND[kind] ?? KIND.txt;
  const [w, h] = size === 'sm' ? [26, 32] : [38, 46];
  return (
    <svg width={w} height={h} viewBox="0 0 38 46" className="shrink-0" role="img" aria-label={k.label}>
      <path d="M4 0h22l12 12v30a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill={k.color} />
      <path d="M26 0l12 12h-8a4 4 0 0 1-4-4z" fill="#fff" fillOpacity=".38" />
      <path d="M7 20h18M7 25h14" stroke="#fff" strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" />
      <text x="19" y="39" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#fff" fontFamily="Inter Variable, sans-serif">
        {k.label}
      </text>
    </svg>
  );
}
