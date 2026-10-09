import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Hero } from '../sections/Hero'
import { AboutTeaser, Closing, Featured, LabPreview, Manifesto, Narrative, Strip } from '../sections/HomeSections'
import { Artwork } from '../components/Artwork'
import { LabField } from '../components/LabField'
import { Arrow, ButtonLink, Eyebrow, Status } from '../components/ui'
import { projects, STATUS_LABEL, TYPE_LABEL } from '../data/projects'
import { GOALS, INTERESTS, PHILOSOPHY, SITE, TOOLS } from '../data/site'
import { useMeta, useReveal } from '../hooks/motion'

export function Home() {
  useMeta('Horizonte — Creamos mundos. Construimos experiencias.', SITE.tagline)
  return (
    <>
      <Hero />
      <Manifesto />
      <Featured />
      <Narrative />
      <Strip />
      <LabPreview />
      <AboutTeaser />
      <Closing />
    </>
  )
}

export function Lab() {
  useMeta('Laboratorio — Horizonte', 'Prototipos, ideas y experimentos tecnológicos en desarrollo.')
  const ref = useReveal<HTMLDivElement>()
  const lab = projects.filter((p) => p.lab || p.type !== 'game')
  return (
    <div className="page lab" ref={ref}>
      <header className="pagehead wrap lab__head">
        <div>
          <p className="eyebrow hero__in">Laboratorio</p>
          <h1 className="display hero__in" style={{ ['--d' as string]: 1 }}>Experimentos.</h1>
          <p className="lead hero__in" style={{ ['--d' as string]: 2 }}>
            El lugar donde las ideas se prueban antes de convertirse en algo más. Mueve el cursor sobre el campo.
          </p>
        </div>
        <div className="lab__field hero__in" style={{ ['--d' as string]: 3 }}><LabField /></div>
      </header>
      <div className="wrap labgrid">
        {lab.map((p, i) => (
          <Link key={p.id} to={`/proyectos/${p.slug}`} className={`labcard ${i % 3 === 0 ? 'labcard--tall' : ''}`} data-reveal style={{ ['--d' as string]: i % 3, ['--accent' as string]: p.accent }}>
            <div className="labcard__media mask"><Artwork project={p} mode={i % 2 ? 'wire' : 'final'} decorative /></div>
            <div className="labcard__body">
              <span className="lablist__n">L-{String(i + 1).padStart(2, '0')} · {TYPE_LABEL[p.type]}</span>
              <h2 className="h3">{p.name}</h2>
              <p className="muted">{p.description}</p>
              <div className="labcard__foot"><Status project={p} /><Arrow /></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function About() {
  useMeta('Sobre mí — Horizonte', 'La visión, filosofía y herramientas detrás del estudio.')
  const ref = useReveal<HTMLDivElement>()
  const timeline = [...projects].sort((a, b) => a.date.localeCompare(b.date))
  const stats = [
    { n: projects.length, l: 'proyectos en el catálogo' },
    { n: projects.filter((p) => p.type === 'game').length, l: 'videojuegos en marcha' },
    { n: projects.filter((p) => p.status === 'in-development').length, l: 'en desarrollo activo' },
    { n: new Set(projects.flatMap((p) => p.tech)).size, l: 'tecnologías utilizadas' },
  ]
  return (
    <div className="page about" ref={ref}>
      <header className="pagehead wrap">
        <p className="eyebrow hero__in">Sobre mí</p>
        <h1 className="display hero__in" style={{ ['--d' as string]: 1 }}>
          No esperamos al futuro.
          <br />
          <span className="dim">Lo construimos.</span>
        </h1>
        <p className="lead hero__in" style={{ ['--d' as string]: 2 }}>
          Un espacio creativo dedicado a imaginar, diseñar y desarrollar videojuegos, aplicaciones y experiencias digitales. Cada proyecto es una oportunidad para experimentar, aprender y convertir una idea en algo real.
        </p>
        <p className="muted hero__in" style={{ ['--d' as string]: 3 }}>
          {SITE.name} es, hoy, un estudio personal: lo dirige {SITE.author}, de la idea al último píxel.
        </p>
      </header>

      <section className="section wrap">
        <Eyebrow>Filosofía</Eyebrow>
        <div className="features">
          {PHILOSOPHY.map((f, i) => (
            <div className="fcard" key={f.title} data-reveal style={{ ['--d' as string]: i }}>
              <span className="fcard__n">0{i + 1}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section wrap stats" aria-label="Estadísticas del catálogo">
        {stats.map((s, i) => (
          <div key={s.l} data-reveal style={{ ['--d' as string]: i }}>
            <strong>{s.n}</strong>
            <span>{s.l}</span>
          </div>
        ))}
        <p className="muted small stats__note">Calculado automáticamente a partir del catálogo de proyectos.</p>
      </section>

      <section className="section wrap split">
        <div>
          <Eyebrow>Objetivos</Eyebrow>
          <ul className="checklist">{GOALS.map((g) => <li key={g} data-reveal>{g}</li>)}</ul>
        </div>
        <div>
          <Eyebrow>Intereses creativos</Eyebrow>
          <ul className="tags tags--lg" data-reveal>{INTERESTS.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </section>

      <section className="section wrap">
        <Eyebrow>Tecnologías y herramientas</Eyebrow>
        <div className="toolgrid">
          {Object.entries(TOOLS).map(([k, v], i) => (
            <div key={k} data-reveal style={{ ['--d' as string]: i }}>
              <h3 className="footer__h">{k}</h3>
              <ul>{v.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="section wrap">
        <Eyebrow>Línea de tiempo</Eyebrow>
        <ol className="timeline">
          {timeline.map((p) => (
            <li key={p.id} data-reveal style={{ ['--accent' as string]: p.accent }}>
              <time>{p.date.slice(0, 7)}</time>
              <Link to={`/proyectos/${p.slug}`}>
                <strong>{p.name}</strong>
                <span className="muted">{TYPE_LABEL[p.type]} · {STATUS_LABEL[p.status]}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

export function Contact() {
  useMeta('Contacto — Horizonte', 'Escríbenos para colaborar, probar un prototipo o simplemente saludar.')
  const ref = useReveal<HTMLDivElement>()
  const [sent, setSent] = useState(false)
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const subject = encodeURIComponent(`[${f.get('topic')}] ${f.get('name')}`)
    const body = encodeURIComponent(`${f.get('message')}\n\n— ${f.get('name')} (${f.get('email')})`)
    window.location.href = `mailto:${SITE.email}?subject=${subject}&body=${body}`
    setSent(true)
  }
  return (
    <div className="page contact" ref={ref}>
      <header className="pagehead wrap">
        <p className="eyebrow hero__in">Contacto</p>
        <h1 className="display hero__in" style={{ ['--d' as string]: 1 }}>Hablemos.</h1>
        <p className="lead hero__in" style={{ ['--d' as string]: 2 }}>
          Colaboraciones, pruebas de prototipos, ideas o simplemente un saludo.
        </p>
      </header>
      <div className="wrap split">
        <form className="form" onSubmit={submit} data-reveal>
          <label>Nombre<input name="name" required autoComplete="name" /></label>
          <label>Correo<input name="email" type="email" required autoComplete="email" /></label>
          <label>Motivo
            <select name="topic" defaultValue="Colaboración">
              <option>Colaboración</option><option>Probar un prototipo</option><option>Prensa</option><option>Otro</option>
            </select>
          </label>
          <label>Mensaje<textarea name="message" rows={5} required /></label>
          <button className="btn btn--primary" type="submit">Enviar mensaje <Arrow /></button>
          <p className="muted small" aria-live="polite">
            {sent ? 'Se abrió tu aplicación de correo con el mensaje listo para enviar.' : 'Al enviar se abrirá tu aplicación de correo.'}
          </p>
        </form>
        <aside className="contact__aside" data-reveal style={{ ['--d' as string]: 1 }}>
          <h2 className="footer__h">Correo</h2>
          <a className="h3 link" href={`mailto:${SITE.email}`}>{SITE.email}</a>
          <h2 className="footer__h">Redes</h2>
          {SITE.socials.map((s) => <a key={s.href} className="link" href={s.href} target="_blank" rel="noreferrer">{s.label} <Arrow /></a>)}
        </aside>
      </div>
    </div>
  )
}

export function NotFound() {
  useMeta('Página no encontrada — Horizonte')
  const p = projects[0]
  return (
    <div className="page notfound">
      <div className="notfound__art"><Artwork project={{ ...p, slug: 'lost', art: { scene: 'terrain', palette: ['#030409', '#10131c', '#929298'] } }} decorative /></div>
      <div className="wrap notfound__c">
        <p className="eyebrow hero__in">Error 404</p>
        <h1 className="display hero__in" style={{ ['--d' as string]: 1 }}>Este mundo<br /><span className="dim">aún no existe.</span></h1>
        <p className="lead hero__in" style={{ ['--d' as string]: 2 }}>La página que buscas no está aquí. Quizá todavía no la hemos construido.</p>
        <div className="hero__ctas hero__in" style={{ ['--d' as string]: 3 }}>
          <ButtonLink to="/">Volver al inicio</ButtonLink>
          <ButtonLink to="/proyectos" variant="ghost">Ver proyectos</ButtonLink>
        </div>
      </div>
    </div>
  )
}
