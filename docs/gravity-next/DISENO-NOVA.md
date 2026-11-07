# Nova: sistema de diseño de Gravity

Nova es el estilo predeterminado desde noviembre de 2026. **Clásico** y **Cristal** siguen disponibles en
Ajustes › Estilo (no se borró nada). Nova respeta el tema elegido (como el sistema, claro u oscuro); Cristal
es siempre oscuro. Todo vive en `bots/public/index.html`, en la capa `:root[data-estilo="nova"]`.

## Auditoría previa (estilo Clásico)
| Categoría | Encontrado | Qué hace Nova |
|---|---|---|
| Colores | 192 valores hex sueltos en el CSS | Tokens semánticos (`--s1..s3`, `--tx..tx3`, `--ion`, `--sig`, `--ok`) en claro y oscuro |
| Tipografía | 19 tamaños distintos | Escala `--fs-xs` 12 · `sm` 13 · `base` 14.5 · `md` 16 · `lg` 20 · `xl` 26 · `2xl` 32 |
| Radios | 8, 9, 10, 12, 14, 16 px mezclados | `--r-sm` 8 · `md` 12 · `lg` 18 · `xl` 24 · `pill` |
| Espacios | valores sueltos | Escala de 4 px: `--sp-1` 4 … `--sp-8` 32 |
| Elevación | una sola sombra | `--e1` (reposo), `--e2` (hover/flotante), `--e3` (diálogos) |
| Foco | solo en campos | Anillo `--foco` en todo lo enfocable con teclado (`:focus-visible`) |
| Estilos inline | 606 en las plantillas | Se mantienen (cambiarlos es una migración aparte); Nova los respeta |

## Tokens
- **Acento** (`--ion` → `--ion2`): índigo a violeta. Botón principal, pestaña y navegación activas, foco y barras de progreso.
- **Señal** (`--sig`): coral. Avisos, aprobaciones y acciones que requieren atención.
- **Éxito** (`--ok`): verde.
- **Superficies**: oscuro grafito (`#0D0E13` fondo, `#14161D` tarjetas); claro papel cálido (`#F6F4EF` fondo, `#FFFFFF` tarjetas).
- **Movimiento**: `--dur-1` 120 ms, `--dur-2` 200 ms, `--ease` cubic-bezier(.2,.8,.2,1). Con «reducir movimiento» no hay animaciones.

## Componentes
| Componente | Variantes | Estados |
|---|---|---|
| Botón `.btn` | `pri` (degradé de acento), `out`, `ghost`, `sig`; tamaño `sm` | hover (sube 1 px, sombra), presionado (baja), deshabilitado (50 %), ocupado (`aria-busy`), foco |
| Chip / pestaña `.chip` | normal; activo con `aria-pressed=true` (tinta sólida) | hover, activo, foco |
| Tarjeta `.card` | métricas `.ops-k` con línea de acento arriba | interactivas (`.proy`, `.reu`, `.ops-b`) suben en hover |
| Campo `.inp` | `sm` | hover, foco (borde de acento + anillo), deshabilitado |
| Navegación lateral `.rl` | — | activo: píldora de acento detrás del icono; hover: píldora neutra |
| Barra inferior (celular) `.mnav` | — | translúcida con desenfoque; activo con píldora de acento |
| Compositor del chat `.cmp-bar` | — | el foco se marca en el borde del compositor, no en el campo |
| Diálogo `dialog.dlg` | `chico`, `alto` | fondo con desenfoque |
| Aviso `.toast` | `err`, `sig` | — |
| Etiqueta `.tag` | `ion`, `sig`, `ok`, `fac` | — |

## Accesibilidad
- Contraste de texto principal y secundario ≥ 4.5:1 en ambos temas; el terciario se usa solo en textos de apoyo.
- Foco visible en todo elemento interactivo con teclado.
- Áreas táctiles de 40 px en el celular (botones de 40, chips de 32).
- La cabecera del chat pasa a botones de solo icono (con `aria-label`) cuando la columna es angosta, así el nombre nunca queda tapado (también se corrigió en Clásico).

## Cómo extender
Usar siempre tokens (`var(--…)`) y no valores sueltos. Un componente nuevo define primero su versión base y,
si necesita algo distinto en Nova, lo agrega bajo `:root[data-estilo="nova"]`.
