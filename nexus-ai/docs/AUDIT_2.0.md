# Auditoría de partida — NEXUS 2.0 (Fase 0)

Fecha: 21/11/2026 · Base auditada: commit `e783d48` (NEXUS AI 1.0) y `NEXUS-AI-1.0.0-debug.apk`.

## 1. Correspondencia APK ↔ código fuente

Se extrajeron los `classes*.dex` del APK 1.0 de depuración y se listaron las clases del paquete `ai.nexus.app`:

| Paquete | Clases en el APK | Archivos en el código |
|---|---|---|
| `data.model` (DTOs del contrato) | 84 | `Dtos.kt` |
| `features.*` (pantallas y ViewModels) | 60 | 15 archivos |
| `core.*` (diseño, red, sesión, realtime, avatar) | 25 | 11 archivos |
| `voice`, `push`, raíz | 9 | 5 archivos |
| **Total (clases de primer nivel)** | **178** | **31 archivos · 7.872 líneas** |

Conclusión: el APK corresponde al código del repositorio (mismos paquetes, mismas pantallas y DTOs); no había
código fuera del repo ni funcionalidades solo en el binario.

## 2. Inventario de módulos 1.0 (conservados en 2.0)

**Backend** (11.500 líneas, FastAPI + PostgreSQL/pgvector + Redis): autenticación con rotación de refresh tokens;
agentes con identidad, instrucciones versionadas, permisos y personaje; gateway multimodelo (Anthropic, OpenAI,
OpenAI-compatible, Gemini, Ollama) con router, fallback y presupuestos; orquestador de misiones (DAG, revisión de
ORACLE, auditoría de GUARDIAN, consolidación); cola durable con recuperación; memoria híbrida con pgvector;
reuniones; herramientas con políticas y aprobaciones; STOP ALL; notificaciones y push FCM; auditoría; exportación.

**App Android** (Kotlin + Compose): dashboard tipo command center, agentes con personajes 2D dibujados por código,
editor de personaje, misiones (lista y flujo), reuniones, memoria, actividad, proyectos, chat con streaming y voz
por intent del sistema, aprobaciones, notificaciones y ajustes.

## 3. Contratos del backend verificados

`tests/test_contract_fixtures.py` corre un escenario real y exporta las respuestas JSON de la API como fixtures
de la app; las pruebas de UI de Android navegan la app real contra esas respuestas. En 2.0 se amplió con los
endpoints nuevos (JARVIS, acciones, rutinas, voz, WhatsApp, privacidad, calidad). Ningún contrato 1.0 se rompió:
los campos nuevos son aditivos (p. ej. `voice_settings`, `jarvis_settings`, `privacy_settings` en `/settings`;
`category` y `last_verified_at` en memoria).

## 4. Hallazgos de la auditoría (y qué se hizo en 2.0)

| Hallazgo en 1.0 | Resolución en 2.0 |
|---|---|
| Al abrir la app el usuario veía un panel técnico (agentes, gráficos), no a su asistente | Home 2.0 centrado en NEXUS; el dashboard 1.0 sigue como «Command Center» en Más |
| La voz dependía del diálogo del sistema (sin barge-in ni modo continuo) | Voice Engine propio en la app (ver docs/setup/PERMISSIONS.md) |
| No había acciones del teléfono ni WhatsApp | Action Registry + Phone Control con intents oficiales + WhatsApp Click to Chat / Business |
| No había automatizaciones por evento | Rutinas programadas, por fecha y por evento con límites y anti-bucle |
| El router elegía solo por nivel declarado del modelo | Puntajes de calidad medidos por tarea alimentan el router |
| Memoria sin categorías de privacidad ni vigencia | Categorías desactivables, procedencia, vigencia, borrado por categoría |
| Personajes planos (2D) | Personajes 3D reales (motor propio, ver PERFORMANCE_2.0.md) |
| Sin prueba de carga | Hecha: p95 global 126 ms (PERFORMANCE_2.0.md) |
| Sincronización del catálogo de herramientas no atómica (fallaba con varios procesos) | Upsert atómico (detectado en la prueba de carga) |

## 5. Funciones existentes que se conservaron sin cambios de contrato

Todas las rutas de navegación 1.0 (`agents`, `agent/{id}`, `missions`, `mission/{id}`, `meetings`, `memory`,
`activity`, `projects`, `chat`, `approvals`, `notifications`, `settings/*`) siguen disponibles desde «Más» o la
navegación lateral en tablet. Las 69 pruebas del backend y las 13 de la app de la 1.0 siguen pasando (las de UI se
adaptaron solo en los pasos de navegación, sin quitar verificaciones).
