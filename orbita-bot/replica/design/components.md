# Componentes y accesibilidad

Tokens CSS usados en `public/styles.css`; copia JSON en `tokens.json`. Se usa CSS nativo: no hay Tailwind ni mapeo necesario.

- Navegación: sidebar de bots y áreas, estado activo y búsqueda por nombre/rol.
- Conversación: historial, estado vacío, tarea activa, cancelación y error con reintento.
- Composer: textarea etiquetado, Enter/Shift+Enter, adjuntos y botón con nombre accesible.
- Diálogo nativo: formularios de bot, skill, rutina y carga, validación y error inline.
- Aprobación: operación y argumentos exactos, aceptar/rechazar, plazo visible.
- Botones: foco visible, estado disabled, iconos con aria-label.
- Archivos: descargar y eliminar; contenido escapado antes de mostrarlo.
- Ordenador: disponibilidad explicada y captura solicitada explícitamente.

Breakpoints: 700px y 1150px. Reduce movimiento con prefers-reduced-motion. Diálogos usan showModal y labels explícitos. El contraste de tokens se calcula separadamente; no equivale a una auditoría completa de accesibilidad ni sustituye la inspección real de móvil/teclado.
