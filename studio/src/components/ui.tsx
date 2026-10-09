import { Link } from 'react-router'
import type { ReactNode } from 'react'
import type { Project } from '../data/types'
import { STATUS_LABEL, TYPE_LABEL } from '../data/projects'
import { SITE } from '../data/site'

export const Logo = ({ withName = true }: { withName?: boolean }) => (
  <span className="logo">
    <svg viewBox="0 0 32 32" aria-hidden="true" className="logo__mark">
      <path d="M7 20a9 9 0 0 1 18 0z" fill="currentColor" />
      <rect x="4" y="22.5" width="24" height="1.6" rx=".8" fill="var(--accent)" />
    </svg>
    {withName && <span className="logo__name">{SITE.name}</span>}
  </span>
)

export const Arrow = ({ dir = 'ne' }: { dir?: 'ne' | 'right' | 'up' | 'left' }) => (
  <svg className={`arrow arrow--${dir}`} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const Status = ({ project }: { project: Project }) => (
  <span className={`status status--${project.status}`}>
    <i aria-hidden="true" />
    {STATUS_LABEL[project.status]}
  </span>
)

export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <p className="eyebrow" data-reveal>
    {children}
  </p>
)

export const ButtonLink = ({ to, children, variant = 'primary' }: { to: string; children: ReactNode; variant?: 'primary' | 'ghost' }) => {
  const external = /^(https?:|mailto:)/.test(to)
  const cls = `btn btn--${variant}`
  return external ? (
    <a className={cls} href={to} target={to.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
      {children} <Arrow />
    </a>
  ) : (
    <Link className={cls} to={to}>
      {children} <Arrow dir={variant === 'primary' ? 'ne' : 'right'} />
    </Link>
  )
}

export const Meta = ({ project }: { project: Project }) => (
  <p className="meta">
    {TYPE_LABEL[project.type]} <span aria-hidden="true">·</span> {project.year}
    {project.demo && (
      <>
        {' '}
        <span className="demo-tag" title="Contenido de demostración">Ejemplo</span>
      </>
    )}
  </p>
)

export const Loader = () => (
  <div className="loader" role="status" aria-label="Cargando">
    <span />
  </div>
)
