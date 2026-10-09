import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes, useLocation } from 'react-router'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { About, Contact, Home, Lab, NotFound } from './pages/Pages'
import { Games, Projects } from './pages/Projects'
import { ProjectDetail } from './pages/ProjectDetail'
import './styles/global.css'

/** Barra de progreso de scroll y reinicio de scroll al cambiar de página. */
function Chrome() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  useEffect(() => {
    const bar = document.getElementById('progress')
    let raf = 0
    const on = () => {
      raf ||= requestAnimationFrame(() => {
        raf = 0
        const max = document.documentElement.scrollHeight - innerHeight
        bar?.style.setProperty('--s', String(max > 0 ? scrollY / max : 0))
      })
    }
    on()
    addEventListener('scroll', on, { passive: true })
    addEventListener('resize', on)
    return () => {
      removeEventListener('scroll', on)
      removeEventListener('resize', on)
    }
  }, [pathname])
  return <div id="progress" className="progress" aria-hidden="true" />
}

function App() {
  const { pathname } = useLocation()
  return (
    <>
      <Chrome />
      <Header />
      <main id="main" key={pathname} className="route" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/videojuegos" element={<Games />} />
          <Route path="/proyectos" element={<Projects />} />
          <Route path="/proyectos/:slug" element={<ProjectDetail />} />
          <Route path="/laboratorio" element={<Lab />} />
          <Route path="/sobre-mi" element={<About />} />
          <Route path="/contacto" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
