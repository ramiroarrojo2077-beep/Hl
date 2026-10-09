import type { PointerEvent } from 'react'
import { Link } from 'react-router'
import { prefersReducedMotion } from '../hooks/motion'
import type { Project } from '../data/types'
import { Artwork } from './Artwork'
import { Arrow, Meta, Status } from './ui'

interface Props {
  project: Project
  size?: 'xl' | 'md' | 'sm' | 'wide'
  index?: number
}

/** Inclinación 3D y reflejo que siguen al cursor (solo ratón y sin "reducir movimiento"). */
function tilt(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse' || prefersReducedMotion()) return
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  const y = (e.clientY - r.top) / r.height
  el.style.setProperty('--ry', `${(x - 0.5) * 8}deg`)
  el.style.setProperty('--rx', `${(0.5 - y) * 8}deg`)
  el.style.setProperty('--gx', `${x * 100}%`)
  el.style.setProperty('--gy', `${y * 100}%`)
}
function untilt(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  el.style.setProperty('--rx', '0deg')
  el.style.setProperty('--ry', '0deg')
}

export function ProjectCard({ project: p, size = 'md', index = 0 }: Props) {
  return (
    <article onPointerMove={tilt} onPointerLeave={untilt} className={`card card--${size}`} data-reveal style={{ ['--accent' as string]: p.accent, ['--d' as string]: index % 3 }}>
      <Link to={`/proyectos/${p.slug}`} className="card__link" aria-label={`Descubrir proyecto: ${p.name}`}>
        <div className="card__media mask">
          <Artwork project={p} decorative sizes={size === 'xl' || size === 'wide' ? '(max-width: 760px) 100vw, 66vw' : '(max-width: 760px) 100vw, 33vw'} />
        </div>
        <div className="card__body">
          <div className="card__top">
            <Meta project={p} />
            <Status project={p} />
          </div>
          <h3 className="card__title">{p.name}</h3>
          <p className="card__desc">{p.description}</p>
          <ul className="tags" aria-label="Tecnologías">
            {p.tech.slice(0, 3).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <span className="card__cta">
            Descubrir proyecto <Arrow dir="right" />
          </span>
        </div>
      </Link>
    </article>
  )
}
