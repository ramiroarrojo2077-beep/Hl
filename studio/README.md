# Horizonte — portfolio de estudio creativo

React + TypeScript + Vite. Sin librerías de animación: scroll con IntersectionObserver y variables CSS.

```bash
npm install
npm run dev           # desarrollo
npm run build         # sitio estático en dist/
npm run build:single  # además genera dist/horizonte.html (un solo archivo)
```

## Añadir o reemplazar proyectos
Todo sale de `src/data/projects.ts` (home, catálogo, filtros, línea de tiempo y páginas de detalle).
Los proyectos de ejemplo tienen `demo: true`: bórralos o reemplázalos.
- `cover` / `gallery`: imágenes reales (si no hay, se usa el arte generativo).
- `trailer`: ID de YouTube o URL `.mp4`.
- `links`: demos o tiendas; si está vacío se muestra "sin versión pública".

Nombre del estudio, correo y redes: `src/data/site.ts` (el correo es provisional).
