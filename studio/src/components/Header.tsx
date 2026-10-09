import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { NAV } from '../data/site'
import { useScrolled } from '../hooks/motion'
import { Logo } from './ui'

export function Header() {
  const scrolled = useScrolled()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const btn = useRef<HTMLButtonElement>(null)

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    document.documentElement.classList.toggle('menu-open', open)
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className={`header ${scrolled || open ? 'is-solid' : ''}`}>
      <button className="skip" onClick={() => document.getElementById('main')?.focus()}>
        Saltar al contenido
      </button>
      <div className="header__inner">
        <Link to="/" className="header__logo" aria-label="Horizonte, inicio">
          <Logo />
        </Link>
        <nav className="nav" aria-label="Principal">
          {NAV.slice(1).map((n) => (
            <NavLink key={n.to} to={n.to} className="nav__link">
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          ref={btn}
          className={`burger ${open ? 'is-open' : ''}`}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
        </button>
      </div>
      <div id="mobile-menu" className={`mmenu ${open ? 'is-open' : ''}`} hidden={!open}>
        <nav aria-label="Menú móvil">
          {NAV.map((n, i) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="mmenu__link" style={{ ['--i' as string]: i }}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  )
}
