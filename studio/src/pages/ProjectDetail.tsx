import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Artwork } from '../components/Artwork'
import { ProjectCard } from '../components/ProjectCard'
import { Arrow, ButtonLink, Loader, Status } from '../components/ui'
import { getProject, relatedProjects, STATUS_LABEL, TYPE_LABEL } from '../data/projects'
import type { Project } from '../data/types'
import { useMeta, useReveal, useScrollProgress } from '../hooks/motion'
import { NotFound } from './Pages'

function Trailer({ p }: { p: Project }) {
  const [play, setPlay] = useState(false)
  const [loading, setLoading] = useState(true)
  if (!p.trailer)
    return (
      <div className="trailer trailer--empty">
        <Artwork project={p} mode="wire" decorative />
        <p>
          <span className="eyebrow">Tráiler</span>
          En producción. Se publicará cuando haya algo digno de mostrar.
        </p>
      </div>
    )
  const isFile = /\.(mp4|webm)$/.test(p.trailer)
  return (
    <div className="trailer">
      {!play ? (
        <button className="trailer__poster" onClick={() => setPlay(true)} aria-label={`Reproducir tráiler de ${p.name}`}>
          <Artwork project={p} decorative />
          <span className="trailer__play" aria-hidden="true">▶</span>
        </button>
      ) : isFile ? (
        <video src={p.trailer} controls autoPlay playsInline preload="none" />
      ) : (
        <>
          {loading && <Loader />}
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${p.trailer}?autoplay=1`}
            title={`Tráiler de ${p.name}`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            onLoad={() => setLoading(false)}
          />
        </>
      )}
    </div>
  )
}

/** Galería con imágenes reales, o vistas del arte generativo cuando aún no hay capturas. */
function Gallery({ p }: { p: Project }) {
  const shots = p.gallery?.length
    ? p.gallery.map((g) => ({ key: g.src, alt: g.alt, node: <img src={g.src} srcSet={g.srcSet} alt={g.alt} loading="lazy" decoding="async" /> }))
    : (['final', 'wire', 'sketch'] as const).map((m) => ({
        key: m,
        alt: { final: 'Atmósfera final', wire: 'Greybox / estructura', sketch: 'Boceto inicial' }[m],
        node: <Artwork project={p} mode={m} decorative />,
      }))
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
      if (e.key === 'ArrowRight') setOpen((o) => (o === null ? o : (o + 1) % shots.length))
      if (e.key === 'ArrowLeft') setOpen((o) => (o === null ? o : (o - 1 + shots.length) % shots.length))
    }
    document.documentElement.classList.add('menu-open')
    window.addEventListener('keydown', onKey)
    return () => {
      document.documentElement.classList.remove('menu-open')
      window.removeEventListener('keydown', onKey)
    }
  }, [open, shots.length])
  return (
    <>
      <div className="gallery">
        {shots.map((s, i) => (
          <button key={s.key} className="gallery__item mask" data-reveal style={{ ['--d' as string]: i }} onClick={() => setOpen(i)} aria-label={`Ampliar: ${s.alt}`}>
            {s.node}
            <span className="gallery__cap">{s.alt}</span>
          </button>
        ))}
      </div>
      {!p.gallery?.length && <p className="muted small">Capturas provisionales generadas a partir del arte del proyecto.</p>}
      {open !== null && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={shots[open].alt} onClick={() => setOpen(null)}>
          <div className="lightbox__frame" onClick={(e) => e.stopPropagation()}>
            {shots[open].node}
            <p>{shots[open].alt} · {open + 1}/{shots.length}</p>
          </div>
          <button className="iconbtn lightbox__close" onClick={() => setOpen(null)} aria-label="Cerrar galería" autoFocus>✕</button>
          <button className="iconbtn lightbox__prev" onClick={(e) => { e.stopPropagation(); setOpen((open - 1 + shots.length) % shots.length) }} aria-label="Anterior"><Arrow dir="left" /></button>
          <button className="iconbtn lightbox__next" onClick={(e) => { e.stopPropagation(); setOpen((open + 1) % shots.length) }} aria-label="Siguiente"><Arrow dir="right" /></button>
        </div>
      )}
    </>
  )
}

const Block = ({ n, title, children }: { n: string; title: string; children: React.ReactNode }) => (
  <section className="dblock wrap">
    <header className="dblock__head" data-reveal>
      <span className="dblock__n">{n}</span>
      <h2 className="h2">{title}</h2>
    </header>
    <div className="dblock__body">{children}</div>
  </section>
)

export function ProjectDetail() {
  const { slug = '' } = useParams()
  const p = getProject(slug)
  if (!p) return <NotFound />
  return <Detail key={p.id} p={p} />
}

function Detail({ p }: { p: Project }) {
  useMeta(`${p.name} — Horizonte`, p.description)
  const hero = useScrollProgress<HTMLElement>('exit')
  const ref = useReveal<HTMLDivElement>([p.id])
  const d = p.detail
  const isGame = p.type === 'game'
  let n = 0
  const num = () => String(++n).padStart(2, '0')

  return (
    <div className={`page detail mood-${p.mood}`} style={{ ['--accent' as string]: p.accent }} ref={ref}>
      <section className="dhero" ref={hero}>
        <div className="dhero__art">
          <Artwork project={p} eager />
        </div>
        <div className="dhero__content wrap">
          <Link to={isGame ? '/videojuegos' : '/proyectos'} className="back hero__in">
            <Arrow dir="left" /> {isGame ? 'Videojuegos' : 'Proyectos'}
          </Link>
          <p className="eyebrow hero__in" style={{ ['--d' as string]: 1 }}>
            {p.genre ?? TYPE_LABEL[p.type]} · {p.year}
          </p>
          <h1 className="dhero__title hero__in" style={{ ['--d' as string]: 2 }}>{p.name}</h1>
          <p className="dhero__tag hero__in" style={{ ['--d' as string]: 3 }}>{p.tagline}</p>
          <div className="dhero__meta hero__in" style={{ ['--d' as string]: 4 }}>
            <Status project={p} />
            {p.demo && <span className="demo-tag">Proyecto de ejemplo</span>}
          </div>
        </div>
      </section>

      <section className="dintro wrap">
        <p className="dintro__lead" data-reveal>{p.description}</p>
        <dl className="specs" data-reveal style={{ ['--d' as string]: 1 }}>
          <div><dt>Categoría</dt><dd>{TYPE_LABEL[p.type]}</dd></div>
          <div><dt>Estado</dt><dd>{STATUS_LABEL[p.status]}</dd></div>
          {p.engine && <div><dt>Motor</dt><dd>{p.engine}</dd></div>}
          {p.platforms && <div><dt>Plataformas</dt><dd>{p.platforms.join(', ')} <small className="muted">(objetivo)</small></dd></div>}
          <div><dt>Inicio</dt><dd>{p.year}</dd></div>
        </dl>
      </section>

      {isGame && (
        <Block n={num()} title="Tráiler">
          <div data-reveal className="mask"><Trailer p={p} /></div>
        </Block>
      )}

      <Block n={num()} title={isGame ? 'Capturas' : 'Vistas'}>
        <Gallery p={p} />
      </Block>

      {d.story && (
        <Block n={num()} title={isGame ? 'Historia y concepto' : 'Concepto'}>
          <p className="prose" data-reveal>{d.story}</p>
        </Block>
      )}

      {d.mechanics?.length ? (
        <Block n={num()} title={isGame ? 'Mecánicas principales' : 'Cómo funciona'}>
          <div className="features">
            {d.mechanics.map((m, i) => (
              <div key={m.title} className="fcard" data-reveal style={{ ['--d' as string]: i }}>
                <span className="fcard__n">{String(i + 1).padStart(2, '0')}</span>
                <h3>{m.title}</h3>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      {d.world?.length ? (
        <Block n={num()} title="Mundo y personajes">
          <div className="world">
            {d.world.map((w, i) => (
              <div key={w.title} className="world__item" data-reveal style={{ ['--d' as string]: i }}>
                <div className="world__art mask"><Artwork project={{ ...p, slug: p.slug + w.title }} decorative /></div>
                <h3>{w.title}</h3>
                <p className="muted">{w.text}</p>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      {d.goals?.length ? (
        <Block n={num()} title="Objetivos">
          <ul className="checklist">
            {d.goals.map((g, i) => <li key={g} data-reveal style={{ ['--d' as string]: i }}>{g}</li>)}
          </ul>
        </Block>
      ) : null}

      <Block n={num()} title="Ficha técnica">
        <ul className="tags tags--lg" data-reveal>
          {p.tech.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </Block>

      {d.devlog?.length ? (
        <Block n={num()} title="Diario de desarrollo">
          <ol className="devlog">
            {d.devlog.map((e, i) => (
              <li key={e.title} data-reveal style={{ ['--d' as string]: i }}>
                <time>{e.date}</time>
                <div><h3>{e.title}</h3><p className="muted">{e.text}</p></div>
              </li>
            ))}
          </ol>
        </Block>
      ) : null}

      <Block n={num()} title={isGame ? 'Demos y plataformas' : 'Enlaces'}>
        {p.links.length ? (
          <div className="links" data-reveal>
            {p.links.map((l) => <ButtonLink key={l.href} to={l.href}>{l.label}</ButtonLink>)}
          </div>
        ) : (
          <p className="muted" data-reveal>
            Todavía no hay una versión pública. Estado actual: <strong className="fg">{STATUS_LABEL[p.status]}</strong>.
          </p>
        )}
      </Block>

      {d.credits?.length ? (
        <Block n={num()} title="Créditos y agradecimientos">
          <ul className="credits">{d.credits.map((c) => <li key={c} data-reveal>{c}</li>)}</ul>
        </Block>
      ) : null}

      <section className="related section">
        <div className="wrap">
          <h2 className="h2" data-reveal>Proyectos relacionados</h2>
          <div className="grid grid--3">
            {relatedProjects(p).map((r, i) => <ProjectCard key={r.id} project={r} size="sm" index={i} />)}
          </div>
        </div>
      </section>
    </div>
  )
}
