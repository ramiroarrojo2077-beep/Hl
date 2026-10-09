import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { Artwork } from '../components/Artwork'
import { ProjectCard } from '../components/ProjectCard'
import { LabField } from '../components/LabField'
import { Arrow, ButtonLink, Eyebrow, Status } from '../components/ui'
import { projects, TYPE_LABEL } from '../data/projects'
import type { Project } from '../data/types'
import { useReveal, useScrollProgress } from '../hooks/motion'

/* Manifiesto: las palabras se iluminan según el scroll real. */
const MANIFESTO =
  'Cada proyecto empieza como una pregunta: ¿qué se siente estar ahí? La respuesta se construye pieza a pieza, con luz, sonido, ritmo y código.'

export function Manifesto() {
  const ref = useScrollProgress<HTMLElement>('sticky')
  const words = MANIFESTO.split(' ')
  return (
    <section id="manifiesto" className="manifesto" ref={ref} style={{ ['--n' as string]: words.length }}>
      <div className="manifesto__sticky wrap">
        <p className="eyebrow">Manifiesto</p>
        <p className="manifesto__text">
          {words.map((w, i) => (
            <span key={i} style={{ ['--i' as string]: i }}>
              {w}{' '}
            </span>
          ))}
        </p>
      </div>
    </section>
  )
}

/* Proyecto destacado a pantalla completa: la imagen se expande y el título entra desde un lado. */
function Feature({ project: p, index }: { project: Project; index: number }) {
  const ref = useScrollProgress<HTMLElement>('through')
  const rev = useReveal<HTMLDivElement>()
  return (
    <section className={`feature feature--${index % 2 ? 'right' : 'left'}`} ref={ref} style={{ ['--accent' as string]: p.accent }} aria-labelledby={`f-${p.slug}`}>
      <div className="feature__media">
        <Artwork project={p} decorative />
      </div>
      <div className="feature__content wrap" ref={rev}>
        <p className="eyebrow" data-reveal>
          {String(index + 1).padStart(2, '0')} — {p.genre ?? TYPE_LABEL[p.type]}
        </p>
        <h2 id={`f-${p.slug}`} className="feature__title">{p.name}</h2>
        <p className="feature__tag" data-reveal style={{ ['--d' as string]: 1 }}>{p.tagline}</p>
        <div className="feature__meta" data-reveal style={{ ['--d' as string]: 2 }}>
          <Status project={p} />
          {p.engine && <span className="muted">{p.engine}</span>}
          {p.demo && <span className="demo-tag">Ejemplo</span>}
        </div>
        <div data-reveal style={{ ['--d' as string]: 3 }}>
          <ButtonLink to={`/proyectos/${p.slug}`}>Descubrir proyecto</ButtonLink>
        </div>
      </div>
    </section>
  )
}

export function Featured() {
  const featured = projects.filter((p) => p.featured)
  return (
    <div className="featured" aria-label="Proyectos destacados">
      {featured.map((p, i) => (
        <Feature key={p.id} project={p} index={i} />
      ))}
    </div>
  )
}

/* Narrativa sticky en tres escenas: concepto → desarrollo → resultado. */
const STEPS = [
  { k: 'Concepto', t: 'Todo empieza con un boceto.', d: 'Una idea, una sensación y unas pocas líneas. Antes de escribir código, definimos qué debe sentir quien juega.', mode: 'sketch' },
  { k: 'Desarrollo', t: 'Después llega la estructura.', d: 'Greyboxing, sistemas y mecánicas. El mundo se vuelve jugable aunque todavía no sea bello.', mode: 'wire' },
  { k: 'Resultado', t: 'Y por fin, la atmósfera.', d: 'Luz, color, sonido y detalle. El momento en que un prototipo se convierte en un lugar.', mode: 'final' },
] as const

export function Narrative() {
  const p = projects.find((x) => x.slug === 'neon-austral') ?? projects[0]
  const [step, setStep] = useState(0)
  const stepRef = useRef(0)
  const ref = useScrollProgress<HTMLElement>('sticky', (v) => {
    const s = Math.min(2, Math.floor(v * 3))
    if (s !== stepRef.current) {
      stepRef.current = s
      setStep(s)
    }
  })
  return (
    <section className="narrative" ref={ref} aria-label={`Proceso de ${p.name}`} style={{ ['--accent' as string]: p.accent }}>
      <div className="narrative__sticky">
        <div className="narrative__art">
          {STEPS.map((s, i) => (
            <div key={s.k} className={`narrative__layer ${i <= step ? 'is-on' : ''}`}>
              <Artwork project={p} mode={s.mode} decorative />
            </div>
          ))}
        </div>
        <div className="narrative__ui wrap">
          <p className="eyebrow">Proceso · {p.name}</p>
          <ol className="narrative__steps">
            {STEPS.map((s, i) => (
              <li key={s.k} className={i === step ? 'is-active' : ''} aria-current={i === step ? 'step' : undefined}>
                <span className="narrative__k">0{i + 1} {s.k}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </li>
            ))}
          </ol>
          <div className="narrative__bar" aria-hidden="true">
            <span />
          </div>
        </div>
      </div>
    </section>
  )
}

/* Bloque horizontal con todos los proyectos. */
export function Strip() {
  const rail = useRef<HTMLDivElement>(null)
  const rev = useReveal<HTMLElement>()
  const move = (dir: number) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section className="strip section" ref={rev} aria-labelledby="strip-title">
      <div className="wrap strip__head">
        <div>
          <Eyebrow>Catálogo</Eyebrow>
          <h2 id="strip-title" className="h2" data-reveal>Todo lo que estamos construyendo.</h2>
        </div>
        <div className="strip__ctrl">
          <button className="iconbtn" onClick={() => move(-1)} aria-label="Anteriores"><Arrow dir="left" /></button>
          <button className="iconbtn" onClick={() => move(1)} aria-label="Siguientes"><Arrow dir="right" /></button>
        </div>
      </div>
      <div className="strip__rail" ref={rail} tabIndex={0} aria-label="Lista de proyectos, desplázate horizontalmente">
        {projects.map((p, i) => (
          <ProjectCard key={p.id} project={p} size="sm" index={i} />
        ))}
      </div>
      <div className="wrap">
        <ButtonLink to="/proyectos" variant="ghost">Ver catálogo completo</ButtonLink>
      </div>
    </section>
  )
}

export function LabPreview() {
  const rev = useReveal<HTMLElement>()
  const lab = projects.filter((p) => p.lab).slice(0, 4)
  return (
    <section className="labprev section" ref={rev} aria-labelledby="lab-title">
      <div className="wrap labprev__grid">
        <div className="labprev__intro">
          <Eyebrow>Laboratorio</Eyebrow>
          <h2 id="lab-title" className="h2" data-reveal>Ideas en estado salvaje.</h2>
          <p className="lead" data-reveal style={{ ['--d' as string]: 1 }}>
            Prototipos, herramientas y experimentos. Algunos crecerán hasta ser juegos; otros existen solo para aprender.
          </p>
          <div className="labprev__field" data-reveal style={{ ['--d' as string]: 2 }}>
            <LabField />
          </div>
        </div>
        <ul className="lablist">
          {lab.map((p, i) => (
            <li key={p.id} data-reveal style={{ ['--d' as string]: i, ['--accent' as string]: p.accent }}>
              <Link to={`/proyectos/${p.slug}`} className="lablist__item">
                <span className="lablist__n">L-{String(i + 1).padStart(2, '0')}</span>
                <span className="lablist__name">{p.name}</span>
                <span className="lablist__desc">{p.tagline}</span>
                <Status project={p} />
                <Arrow />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function AboutTeaser() {
  const rev = useReveal<HTMLElement>()
  return (
    <section className="about-teaser section" ref={rev}>
      <div className="wrap">
        <Eyebrow>El estudio</Eyebrow>
        <h2 className="display" data-reveal>
          No esperamos al futuro.
          <br />
          <span className="dim">Lo construimos.</span>
        </h2>
        <p className="lead about-teaser__p" data-reveal style={{ ['--d' as string]: 1 }}>
          Un espacio creativo dedicado a imaginar, diseñar y desarrollar videojuegos, aplicaciones y experiencias digitales. Cada proyecto es una oportunidad para experimentar, aprender y convertir una idea en algo real.
        </p>
        <div data-reveal style={{ ['--d' as string]: 2 }}>
          <ButtonLink to="/sobre-mi" variant="ghost">Conocer el estudio</ButtonLink>
        </div>
      </div>
    </section>
  )
}

/* Cierre cinematográfico: amanece mientras bajas hacia el footer. */
export function Closing() {
  const ref = useScrollProgress<HTMLElement>('sticky')
  return (
    <section className="closing" ref={ref} aria-label="Cierre">
      <div className="closing__sticky">
        <div className="closing__sun" aria-hidden="true" />
        <div className="closing__line" aria-hidden="true" />
        <p className="closing__text">
          El próximo mundo
          <br />
          ya está en construcción.
        </p>
      </div>
    </section>
  )
}
