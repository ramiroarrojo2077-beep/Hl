import { Link } from 'react-router'
import { NAV, SITE } from '../data/site'
import { projects } from '../data/projects'
import { useReveal } from '../hooks/motion'
import { Arrow, Logo } from './ui'

export function Footer() {
  const ref = useReveal<HTMLElement>()
  const toTop = () => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  return (
    <footer className="footer" ref={ref}>
      <div className="wrap">
        <h2 className="footer__title" data-reveal>
          Esto es solo
          <br />
          <span className="dim">el comienzo.</span>
        </h2>
        <div className="footer__grid">
          <div data-reveal>
            <Logo />
            <p className="muted footer__lead">{SITE.tagline}</p>
          </div>
          <nav aria-label="Pie de página" data-reveal style={{ ['--d' as string]: 1 }}>
            <h3 className="footer__h">Explorar</h3>
            {NAV.map((n) => (
              <Link key={n.to} to={n.to}>{n.label}</Link>
            ))}
          </nav>
          <div data-reveal style={{ ['--d' as string]: 2 }}>
            <h3 className="footer__h">Proyectos</h3>
            {projects.slice(0, 5).map((p) => (
              <Link key={p.id} to={`/proyectos/${p.slug}`}>{p.name}</Link>
            ))}
          </div>
          <div data-reveal style={{ ['--d' as string]: 3 }}>
            <h3 className="footer__h">Contacto</h3>
            <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
            {SITE.socials.map((s) => (
              <a key={s.href} href={s.href} target="_blank" rel="noreferrer">
                {s.label} <Arrow />
              </a>
            ))}
          </div>
        </div>
        <div className="footer__bottom">
          <p>© {new Date().getFullYear()} {SITE.name}. Todos los derechos reservados.</p>
          <button className="totop" onClick={toTop}>
            Volver arriba <Arrow dir="up" />
          </button>
        </div>
      </div>
    </footer>
  )
}
