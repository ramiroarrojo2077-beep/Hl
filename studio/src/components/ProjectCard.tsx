import { Link } from 'react-router'
import type { Project } from '../data/types'
import { Artwork } from './Artwork'
import { Arrow, Meta, Status } from './ui'

interface Props {
  project: Project
  size?: 'xl' | 'md' | 'sm' | 'wide'
  index?: number
}

export function ProjectCard({ project: p, size = 'md', index = 0 }: Props) {
  return (
    <article className={`card card--${size}`} data-reveal style={{ ['--accent' as string]: p.accent, ['--d' as string]: index % 3 }}>
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
