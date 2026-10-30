import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, PenTool } from 'lucide-react';
import { LAB_SIMS } from '@/lib/items';
import { cx } from './ui';

// Markdown con fórmulas (KaTeX), tablas, citas al material ([p. N] abre la página
// original) y marcadores del tutor ([[lab:ID]] y [[pizarra: ...]]).

function preprocess(src: string) {
  return src
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, f) => `$$${f}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, f) => `$${f}$`)
    .replace(/\[\[lab:\s*([a-z-]+)\s*\]\]/gi, (_m, id) => ((LAB_SIMS as readonly string[]).includes(id) ? `[Abrir simulación](#lab-${id})` : ''))
    .replace(/\[\[pizarra:\s*([^\]]+)\]\]/gi, (_m, p) => `[Resolver en la pizarra](#board-${encodeURIComponent(p.trim())})`)
    .replace(/\[((?:p|pág|diap|sec)\.?\s*(\d+)(?:\s*[-–]\s*\d+)?)\](?!\()/gi, (_m, label, n) => `[${label}](#cite-${n})`);
}

function MarkdownImpl({ children, className, onCite }: { children: string; className?: string; onCite?: (page: number) => void }) {
  const nav = useNavigate();
  return (
    <div className={cx('prose-study', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a({ href, children: kids }) {
            if (href?.startsWith('#cite-')) {
              const page = Number(href.slice(6));
              return (
                <button
                  type="button"
                  onClick={() => onCite?.(page)}
                  disabled={!onCite}
                  title={onCite ? 'Ver en el documento original' : undefined}
                  className="mx-0.5 inline-flex items-center rounded-md border border-cyan/30 bg-cyan/10 px-1.5 text-[11px] font-medium text-cyan no-underline align-[1px] hover:bg-cyan/20 disabled:cursor-default"
                >
                  {kids}
                </button>
              );
            }
            if (href?.startsWith('#lab-')) {
              return (
                <button type="button" onClick={() => nav(`/lab?sim=${href.slice(5)}`)} className="my-1 inline-flex items-center gap-1.5 rounded-lg border border-violet/40 bg-violet/15 px-2.5 py-1 text-xs font-medium text-[#d6c8ff] hover:bg-violet/25">
                  <FlaskConical className="size-3.5" /> {kids}
                </button>
              );
            }
            if (href?.startsWith('#board-')) {
              return (
                <button type="button" onClick={() => nav(`/board?problem=${href.slice(7)}`)} className="my-1 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-2.5 py-1 text-xs font-medium text-[#c3cdff] hover:bg-primary/25">
                  <PenTool className="size-3.5" /> {kids}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {kids}
              </a>
            );
          },
        }}
      >
        {preprocess(children)}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
