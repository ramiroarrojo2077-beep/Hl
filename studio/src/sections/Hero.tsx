import { Link } from 'react-router'
import { Artwork, type ArtSource } from '../components/Artwork'
import { Object3D } from '../components/Object3D'
import { Arrow, ButtonLink, Status } from '../components/ui'
import { projects } from '../data/projects'
import { prefersReducedMotion, useScrollProgress } from '../hooks/motion'

const HORIZON: ArtSource = {
  slug: 'horizonte-hero',
  name: 'Horizonte',
  accent: '#5B8CFF',
  art: { scene: 'terrain', palette: ['#04060f', '#22356a', '#7FA6FF'] },
}

export function Hero() {
  const ref = useScrollProgress<HTMLElement>('exit')
  const flagship = projects.find((p) => p.featured) ?? projects[0]
  return (
    <section className="hero" ref={ref} aria-labelledby="hero-title">
      <div className="hero__art">
        <Artwork project={HORIZON} decorative eager />
      </div>
      <div className="hero__obj">
        <Object3D accent="#7FA6FF" />
      </div>
      <div className="hero__content wrap">
        <p className="eyebrow hero__in" style={{ ['--d' as string]: 0 }}>Estudio independiente · Videojuegos y tecnología</p>
        <h1 id="hero-title" className="hero__title">
          <span className="hero__line" style={{ ['--d' as string]: 1 }}>Creamos mundos.</span>
          <span className="hero__line dim" style={{ ['--d' as string]: 2 }}>Construimos</span>
          <span className="hero__line dim" style={{ ['--d' as string]: 3 }}>experiencias.</span>
        </h1>
        <div className="hero__foot">
          <p className="hero__sub hero__in" style={{ ['--d' as string]: 4 }}>
            Videojuegos, tecnología e ideas que transforman la imaginación en experiencias digitales.
          </p>
          <div className="hero__ctas hero__in" style={{ ['--d' as string]: 5 }}>
            <ButtonLink to="/proyectos">Explorar proyectos</ButtonLink>
            <ButtonLink to="/sobre-mi" variant="ghost">Conocer el estudio</ButtonLink>
          </div>
        </div>
      </div>
      <Link to={`/proyectos/${flagship.slug}`} className="hero__feature hero__in" style={{ ['--d' as string]: 6, ['--accent' as string]: flagship.accent }}>
        <span className="hero__thumb">
          <Artwork project={flagship} decorative eager />
        </span>
        <span>
          <span className="hero__ftag">Proyecto principal</span>
          <strong>{flagship.name}</strong>
          <Status project={flagship} />
        </span>
        <Arrow />
      </Link>
      <button
        className="scrollcue"
        aria-label="Desplázate para continuar"
        onClick={() => document.getElementById('manifiesto')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' })}
      >
        <span />
      </button>
    </section>
  )
}
