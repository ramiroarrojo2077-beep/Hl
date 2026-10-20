# Recon: Grok Bot (xAI / Cursor)

Mapa del producto original para construir un clon propio. Se estudió qué hace y cómo se usa, solo desde fuentes públicas. No se copió código, assets, textos ni marca.

> Nota de método: el entorno donde se hizo este recon bloquea el acceso directo a `docs.x.ai`, `x.ai`, `cursor.com` y la mayoría de los blogs. La información sale de resúmenes de búsqueda web de esas páginas. Lo marcado como **(inferido)** no tiene una fuente directa.

## 1. Alcance

| | |
|---|---|
| App | Grok Bot: "compañeros" de IA persistentes, cada uno con un trabajo, memoria y una computadora en la nube |
| Plataformas del original | Escritorio (macOS, Windows, Linux), iOS. Android anunciado |
| Plataforma del clon | Web local (Node), responsive para usar desde el celular en la misma red |
| Porción a clonar | El ciclo principal: crear un bot con un trabajo, chatear y que trabaje en su computadora (terminal y archivos), aprobar acciones riesgosas, memoria, rutinas programadas y habilidades |
| Para quién | Uso personal, un solo usuario, sin cuentas ni pagos |

## 2. Fuentes

| Fuente | Qué aporta | URL |
|---|---|---|
| Docs oficiales: empezar | instalación, login, "Meet a future teammate", crear bot | https://docs.x.ai/grok-bot/get-started |
| Docs: bots | crear y administrar bots | https://docs.x.ai/grok-bot/bots |
| Docs: chat y colaboración | grupos de 2 a 6 bots, @menciones, qué aparece en grupos | https://docs.x.ai/grok-bot/chat-and-collaboration |
| Docs: habilidades y rutinas | skill = instrucciones guardadas, routine = cuándo correrla | https://docs.x.ai/grok-bot/skills-routines-and-automations |
| Docs: aprobaciones y seguridad | Allow once / Always allow / Deny, Auto-review, tomar control | https://docs.x.ai/grok-bot/approvals-security-and-privacy |
| Docs: equipos | aislamiento, permisos por bot | https://docs.x.ai/grok-bot/teams-and-enterprises |
| Docs (copia en Cursor) | trabajar con Grok Bot, memoria, ejecución local | https://cursor.com/docs/grok-bot/work |
| Changelog oficial | modo "Watching", botón "Wake", llamadas de voz | https://x.ai/changelog/bot |
| Post de diseño | bots como objetos principales, nombre/avatar/título, vista de la computadora | https://x.ai/news/designing-grok-bot |
| Anuncio de planes | planes incluidos, fechas | https://x.ai/news/grok-bot-more-plans |
| Análisis a fondo | límites (50 bots + grupos, 50 rutinas), impresiones | https://flaviocopes.com/grok-bot/ |
| Glosario no oficial | computadora compartida, /workspace, plugins | https://www.grokbotwiki.com/guides/grok-bot-glossary |
| Guía de uso | layout tipo iMessage, fijar y agrupar bots | https://www.aibuilderclub.com/blog/grok-bot-guide |
| Reseñas | vista de la computadora, tomar el mouse para loguearse | https://thecreatorsai.com/p/i-gave-grok-bot-a-real-job-realistic , https://natesnewsletter.substack.com/p/grok-bot-review , https://www.eesel.ai/blog/grok-bot-review |
| Foro de Cursor | quejas: no se puede ver ni editar la memoria | https://forum.cursor.com/t/grok-bot-desktop-ios-memory-management/168066 |
| Rutinas: límites | 50 rutinas por bot, últimas 20 ejecuciones | https://www.grokbotwiki.com/guides/grok-bot-routines-not-running |

## 3. Pantallas

| ID | Pantalla | Cómo se llega | Propósito | Componentes clave | Estados |
|---|---|---|---|---|---|
| S01 | Bienvenida y login | primera apertura | entrar con cuenta Cursor | botón de login, aviso de plan | sin plan elegible, SSO |
| S02 | Preparando la computadora | después del login | crear la VM en segundo plano | progreso | colgado (hay que reiniciar la app) |
| S03 | Meet a future teammate | fin del setup, o "+" | elegir un compañero sugerido o crear uno | tarjetas de plantillas, "Create your own" | vacío |
| S04 | Crear tu propio bot | S03 → Create your own | nombre, título, descripción del trabajo | formulario | validación |
| S05 | Ventana principal | siempre | lista de bots a la izquierda, chat a la derecha | sidebar con avatares, fijar/agrupar, chat con hilos | sin bots, bot trabajando, no leído |
| S06 | Compositor | S05 abajo | escribir, adjuntar, voz, @mención en grupos | input, adjuntos, micrófono | deshabilitado mientras… (inferido) |
| S07 | Tarjeta de aprobación | en el chat cuando el bot pide permiso | aprobar o negar una acción | Allow once, Always allow, Deny | pendiente, resuelta |
| S08 | Panel de la computadora | al lado del chat | ver el escritorio del bot en vivo | vista previa, "Take over", "I'm done" | dormida (Wake), arrancando, despierta |
| S09 | Computadora a pantalla completa | desde S08 | mirar o tomar el control | modo Watching, Take control | mirando, controlando |
| S10 | Artifacts | panel | archivos que creó el bot | lista de archivos | vacío |
| S11 | Perfil del bot | clic en el bot | nombre, avatar, título, descripción | formulario, avatar animado | trabajando (el avatar se mueve) |
| S12 | Rutinas del bot | perfil → rutinas | programar trabajo | lista, editor (horario o evento, skill), prueba, historial de 20 | sin rutinas, error de ejecución |
| S13 | Habilidades | ajustes / chat | instrucciones reutilizables | lista, editor | vacío |
| S14 | Plugins | ajustes | conectar Gmail, Slack, Notion… por OAuth | lista, conectar | desconectado |
| S15 | Chat grupal | sidebar → nuevo grupo | 2 a 6 bots en un chat | @mención, quién responde | sin aprobaciones en grupo |
| S16 | Ajustes → Auto-review | ajustes | reglas Require Approval / Always Allow | lista de reglas | conflicto (gana Require Approval) |
| S17 | Ajustes generales | ajustes | cuenta, plan, política de ejecución local | toggles | |
| S18 | Llamada de voz | compositor → voz | hablar con el bot | controles de llamada | reconectando |
| S19 | Email del bot | pedirlo en el chat | dirección propia para mandar/recibir | borradores | elegir remitente |

## 4. Flujos

```
F01 Primer uso
    S01 login -> S02 setup -> S03 elegir plantilla o crear -> S04 -> S05 primer chat
    happy path: ~5 clics. borde: setup colgado, plan no elegible

F02 Pedirle un trabajo a un bot
    S05 escribir -> el bot trabaja (S08 muestra la computadora) -> S07 aprobación -> resultado en el chat / S10
    borde: el bot necesita un login, el usuario niega, el bot se queda sin contexto

F03 Login sensible
    el bot llega a un login -> pide Take over -> S09 el usuario se loguea -> I'm done -> el bot sigue

F04 Crear una rutina
    S11 -> S12 nueva -> horario o evento -> skill o instrucciones -> probar -> guardar
    también desde el chat: "todos los lunes a las 9 mandame…"
    borde: 50 rutinas por bot, la prueba hace trabajo real

F05 Rutina que se ejecuta sola
    programador -> el bot trabaja -> notificación -> historial (últimas 20)
    borde: la computadora está dormida, la rutina necesita aprobación

F06 Guardar una habilidad desde una conversación
F07 Chat grupal: crear grupo -> escribir -> los bots deciden quién responde / @mención
F08 Conectar un plugin (OAuth)
F09 Crear una regla de Auto-review
F10 Llamada de voz que despierta la computadora
```

## 5. Componentes

| Componente | Variantes | Estados | Pantallas |
|---|---|---|---|
| Avatar de bot | grande, chico, en lista | quieto, trabajando (animado), con acción actual al pasar el mouse | S05, S11, S15 |
| Fila de bot en la lista | fijado, en grupo | seleccionado, no leído, trabajando, esperando aprobación | S05 |
| Burbuja de mensaje | usuario, bot, sistema | streaming, completa, con archivos | S05, S15 |
| Línea de actividad | búsqueda, lectura, comando, edición | en curso, terminada, error | S05 |
| Tarjeta de aprobación | comando, archivo, plugin, rutina | pendiente, aprobada, negada | S07 |
| Tarjeta de plantilla | | | S03 |
| Panel de la computadora | vista previa, pantalla completa | dormida, despierta, mirando, controlando | S08, S09 |
| Lista de archivos | | vacía | S10 |
| Editor de rutina | horario, evento | activa, pausada | S12 |
| Historial de ejecuciones | | ok, error, en curso | S12 |
| Modal / formulario | | validación | S04, S11, S13 |
| Toast / notificación | | | todas |

## 6. Modelo de datos inferido

```
Usuario      id, plan, cuenta Cursor
             evidencia: S01, docs de planes. confianza: alta

Computadora  id, usuario_id, estado (dormida | arrancando | despierta), /workspace
             una por usuario, compartida por todos sus bots
             evidencia: glosario, changelog (Wake), docs de seguridad. confianza: alta

Bot          id, nombre, titulo, descripcion, avatar, fijado, grupo, creado
             evidencia: S04, post de diseño. confianza: alta

Chat         id, tipo (1:1 | grupo), bots[] (2..6 en grupo)
Mensaje      id, chat_id, autor (usuario | bot), contenido, hilo_padre_id, adjuntos
             evidencia: S05, S15, docs de chat. confianza: alta

Accion       id, mensaje_id, tipo (shell | navegador | plugin | rutina), entrada, estado
Aprobacion   accion_id, decision (una vez | siempre | negar)
ReglaReview  id, tipo (require_approval | always_allow), patron
             evidencia: docs de seguridad. confianza: alta

Memoria      bot_id, archivos markdown en la computadora; además una memoria compartida del usuario
             evidencia: foro de Cursor. confianza: media

Habilidad    id, nombre, instrucciones
Rutina       id, bot_id, disparador (horario cron | evento), habilidad_id | instrucciones, activa
             máximo 50 por bot
Ejecucion    rutina_id, estado, inicio, fin, salida. se guardan las últimas 20
             evidencia: docs de rutinas, grokbotwiki. confianza: alta

Plugin       id, servicio, conexión OAuth (tokens fuera de la computadora), bots con permiso
             evidencia: glosario, codepick. confianza: media

EmailBot     direccion, bot_id | compartida
             evidencia: guías de terceros, changelog. confianza: baja
```

## 7. Matriz de funcionalidades

Ver `features.csv`.

## 8. Qué no se puede clonar

| Qué | Por qué |
|---|---|
| El modelo Grok 4.x | Es de xAI. El clon usa Claude por la API de Anthropic |
| La cuenta Cursor y los planes SuperGrok | Son del original. El clon es de uso personal, sin cuentas |
| La VM en la nube por usuario | Infraestructura propia del original. El clon usa una carpeta local como "computadora" (o un contenedor Docker si se quiere aislar) |
| Dominio de email `@mail.grokbot.com` | Es del original. Se podría hacer con un proveedor de email propio |
| Marca, nombre, logo y avatar | Marca registrada. El clon se llama **Gravity** y usa avatares propios |

## 9. Tamaño

- Pantallas a construir en el MVP: 7 (lista + chat, crear bot, computadora, rutinas, memoria, perfil, ajustes).
- Flujos: F01, F02, F04, F05, F06 (y F09 simplificado como reglas "siempre permitir").
- Entidades: Bot, Conversación, Aprobación, Regla, Habilidad, Rutina, Ejecución, Memoria.
- Lo difícil: (1) el bucle del agente con herramientas locales y aprobaciones que esperan al usuario, (2) correr comandos en la máquina sin que sea un agujero de seguridad, (3) la computadora con escritorio gráfico y navegador controlable (queda fuera del MVP).
- Tamaño: **M** para el MVP sin escritorio gráfico, plugins, grupos ni voz. **L** con todo eso.
