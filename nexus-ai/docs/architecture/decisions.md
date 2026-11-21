# Decisiones de arquitectura

## ADR-001 · Cola durable en PostgreSQL en lugar de Temporal (por ahora)

**Contexto.** La especificación sugiere Temporal para workflows duraderos.
**Decisión.** Cola propia sobre PostgreSQL (`jobs` con leases y `SKIP LOCKED`) + Redis solo para despertar workers.
**Motivos.** Encolar en la misma transacción que el cambio de estado elimina trabajos huérfanos o perdidos; una pieza
menos de infraestructura para un producto autoalojado; la recuperación tras caídas está probada. Los handlers están
aislados (`jobs/handlers.py`): migrar a Temporal implica reemplazar la cola sin tocar el dominio.
**Consecuencias.** Escala bien a decenas de workers; para miles de trabajos por segundo convendría Temporal o una cola
dedicada.

## ADR-002 · Embeddings de 768 dimensiones y doble índice (léxico + semántico)

Los índices HNSW requieren dimensión fija. 768 es nativa en Gemini y nomic-embed y configurable en
`text-embedding-3-*`. Se guarda siempre un embedding léxico local para que la memoria funcione sin proveedor de
embeddings y para no perder recuperabilidad al cambiar de modelo. Los modelos con otra dimensión se rechazan con un
error explícito.

## ADR-003 · Políticas deterministas + GUARDIAN con modelo

Los permisos no pueden depender del criterio de un modelo. El motor de políticas (`security/policy.py`) decide cada
ejecución de forma determinista y auditable. GUARDIAN (modelo) audita a posteriori con evidencia del registro.

## ADR-004 · Herramientas ofrecidas por mínimo privilegio

A cada agente se le ofrecen solo las herramientas que tiene permitidas. Si un modelo pide una herramienta no
ofrecida, se bloquea y se registra. Las que requieren aprobación sí se ofrecen: la ejecución se suspende y la
conversación completa del agente se persiste para reanudarla exactamente donde quedó.

## ADR-005 · Personaje con efecto real

Los rasgos (0-100) se traducen en indicaciones de tono y enfoque dentro del prompt, nunca por encima de las políticas.
La apariencia se dibuja con Compose Canvas (sin assets binarios ni dependencias), y la voz usa el TTS del dispositivo
con tono, velocidad y acento por agente.

## ADR-006 · FCM opcional y sin `google-services.json` en el repo

Firebase se inicializa en código solo si el APK se compila con la configuración del proyecto Firebase. Sin ella, las
notificaciones llegan por WebSocket con la app abierta y por sincronización periódica (WorkManager) en segundo plano.

## ADR-007 · Un módulo Android con paquetes por capa

`core`, `data`, `domain` (implícito en los DTOs y ViewModels), `navigation` y `features/*` mantienen la separación de
responsabilidades sin el costo de compilación de multimódulo. Puede dividirse en módulos Gradle sin cambiar paquetes.

## ADR-008 · Sin precios de modelos inventados

Los precios por millón de tokens los configura el usuario. Sin precio, el costo no se estima (se muestra como tal) y el
tope de tokens por misión sigue protegiendo el gasto.
