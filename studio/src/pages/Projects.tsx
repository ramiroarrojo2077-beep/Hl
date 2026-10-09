import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { ProjectCard } from '../components/ProjectCard'
import { projects, STATUS_LABEL, TYPE_PLURAL } from '../data/projects'
import type { Project, ProjectStatus, ProjectType } from '../data/types'
import { useMeta, useReveal } from '../hooks/motion'

const SORTS = {
  recent: { label: 'Más recientes', fn: (a: Project, b: Project) => b.date.localeCompare(a.date) },
  oldest: { label: 'Más antiguos', fn: (a: Project, b: Project) => a.date.localeCompare(b.date) },
  az: { label: 'Nombre A–Z', fn: (a: Project, b: Project) => a.name.localeCompare(b.name, 'es') },
  status: { label: 'Más avanzados', fn: (a: Project, b: Project) => ORDER.indexOf(b.status) - ORDER.indexOf(a.status) },
}
const ORDER: ProjectStatus[] = ['concept', 'paused', 'prototype', 'in-development', 'finished']
const SIZES = ['xl', 'md', 'md', 'wide', 'sm', 'sm', 'sm'] as const

export function Catalog({ fixedType, title, intro }: { fixedType?: ProjectType; title: string; intro: string }) {
  const [params, setParams] = useSearchParams()
  const type = (fixedType ?? params.get('tipo') ?? 'all') as ProjectType | 'all'
  const status = (params.get('estado') ?? 'all') as ProjectStatus | 'all'
  const q = params.get('q') ?? ''
  const sort = (params.get('orden') ?? 'recent') as keyof typeof SORTS

  const set = (k: string, v: string, def: string) => {
    const next = new URLSearchParams(params)
    if (v === def || !v) next.delete(k)
    else next.set(k, v)
    setParams(next, { replace: true, preventScrollReset: true })
  }

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return projects
      .filter((p) => type === 'all' || p.type === type)
      .filter((p) => status === 'all' || p.status === status)
      .filter((p) => !term || `${p.name} ${p.description} ${p.tech.join(' ')}`.toLowerCase().includes(term))
      .sort((SORTS[sort] ?? SORTS.recent).fn)
  }, [type, status, q, sort])

  const key = `${type}|${status}|${q}|${sort}`
  const ref = useReveal<HTMLDivElement>([key])
  const presentStatuses = ORDER.filter((s) => projects.some((p) => p.status === s && (fixedType ? p.type === fixedType : true)))

  return (
    <div className="page catalog">
      <header className="pagehead wrap">
        <p className="eyebrow hero__in">{fixedType ? 'Videojuegos' : 'Catálogo'}</p>
        <h1 className="display hero__in" style={{ ['--d' as string]: 1 }}>{title}</h1>
        <p className="lead hero__in" style={{ ['--d' as string]: 2 }}>{intro}</p>
      </header>

      <div className="filters wrap" role="search">
        {!fixedType && (
          <div className="chips" role="group" aria-label="Filtrar por categoría">
            {(['all', 'game', 'prototype', 'app', 'ai', 'experiment'] as const).map((t) => (
              <button key={t} className="chip" aria-pressed={type === t} onClick={() => set('tipo', t, 'all')}>
                {t === 'all' ? 'Todos' : TYPE_PLURAL[t]}
              </button>
            ))}
          </div>
        )}
        <div className="chips" role="group" aria-label="Filtrar por estado">
          {(['all', ...presentStatuses] as const).map((s) => (
            <button key={s} className="chip chip--soft" aria-pressed={status === s} onClick={() => set('estado', s, 'all')}>
              {s === 'all' ? 'Cualquier estado' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="filters__row">
          <label className="field">
            <span className="sr">Buscar por nombre</span>
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <input type="search" placeholder="Buscar proyecto o tecnología" value={q} onChange={(e) => set('q', e.target.value, '')} />
          </label>
          <label className="field field--select">
            <span className="sr">Ordenar</span>
            <select value={sort} onChange={(e) => set('orden', e.target.value, 'recent')}>
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>
          <p className="filters__count" aria-live="polite">
            <strong key={list.length}>{list.length}</strong> {list.length === 1 ? 'proyecto' : 'proyectos'}
          </p>
        </div>
      </div>

      <div className="wrap">
        {list.length ? (
          <div className="grid" ref={ref} key={key}>
            {list.map((p, i) => (
              <ProjectCard key={p.id} project={p} size={list.length < 3 ? 'wide' : SIZES[i % SIZES.length]} index={i} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <p className="h3">Nada por aquí todavía.</p>
            <p className="muted">Ningún proyecto coincide con esos filtros.</p>
            <button className="btn btn--ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Limpiar filtros
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function Projects() {
  useMeta('Proyectos — Horizonte', 'Videojuegos, prototipos, aplicaciones, IA y experimentos tecnológicos.')
  return <Catalog title="Proyectos." intro="Videojuegos, prototipos, aplicaciones, inteligencia artificial y experimentos. Filtra, busca y ordena." />
}

export function Games() {
  useMeta('Videojuegos — Horizonte', 'Los videojuegos del estudio: en concepto, prototipo y desarrollo.')
  return <Catalog fixedType="game" title="Videojuegos." intro="Mundos en construcción. Cada uno con su propia atmósfera, su propio ritmo y su propia pregunta." />
}
