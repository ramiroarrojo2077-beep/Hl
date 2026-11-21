# Estado del proyecto y reportes por fase

Fecha: 21/11/2026 · Rama: `ccr-3bafa18c-wee3mx`

## Resumen de verificación

| Verificación | Resultado |
|---|---|
| Tests del backend (PostgreSQL 16 + pgvector reales) | **69/69 aprobados** |
| Tests de la app (JVM + Robolectric, UI de punta a punta con capturas) | **13/13 aprobados** |
| Escenario obligatorio de punta a punta (PARTE 20) | aprobado con un doble HTTP de la Messages API (ver abajo) |
| Escenario con el worker interrumpido en plena misión | aprobado: sin duplicar efectos, intento `interrupted → succeeded` |
| Migraciones Alembic (upgrade/downgrade/check sin drift) | aprobado |
| API + worker reales levantados localmente (`/health`, `/ready`, misión real hasta bloqueo explicado sin modelo) | aprobado |
| APK debug y release (R8, firmada) | compilan; firma verificada con `apksigner` |
| `docker compose config` (desarrollo y producción) | válido |

## Fase 1 — Fundación ✅
- FastAPI, SQLAlchemy async, Alembic (3 migraciones), 36 tablas con FKs e índices, logs JSON, health/ready/metrics.
- Auth: argon2id, JWT de 15 min, refresh tokens opacos rotados por familia con detección de reutilización, sesiones
  revocables, rate limiting; secretos cifrados con Fernet (rotación).
- Tests: `test_auth.py` (7).

## Fase 2 — Motor multiagente ✅
- Seis agentes con identidad, instrucciones versionadas, permisos por herramienta, personaje (rasgos → prompt,
  apariencia, voz), estados reales emitidos por WebSocket; agentes personalizados; consultas entre agentes.
- Tests: `test_agents.py` (8), `test_policy.py` (6).

## Fase 3 — Multimodelo ✅
- Adaptadores Anthropic (con streaming SSE, `effort`, búsqueda web nativa), OpenAI, OpenAI-compatible, Gemini, Ollama.
- Router por capacidades/calidad/asignación/costo, fallback solo compatible, reintentos, consumo y costos, presupuestos,
  comparación de modelos con juez a ciegas.
- Tests: `test_providers.py` (8), `test_adapters.py` (8).

## Fase 4 — Memoria ✅
- pgvector HNSW (768), búsqueda híbrida léxico + semántico + full-text con RRF, ámbitos aislados (agente, compartida,
  usuario, proyecto), control de calidad (fuente, fecha, confianza, verificación, caducidad), deduplicación,
  indexado de PDF/DOCX/TXT/MD/código con versiones.
- Tests: `test_memory.py` (5).

## Fase 5 — Autonomía ✅
- Plan validado como DAG, ejecución paralela, revisión de ORACLE con rondas de corrección, auditoría de GUARDIAN con
  evidencia real, consolidación, aprendizajes; aprobaciones con reanudación exacta; reuniones con límites; chat con
  streaming; programador cron (misiones, reuniones, recordatorios); STOP ALL; cola durable con recuperación.
- Tests: `test_orchestrator.py` (5), `test_recovery.py` (2), `test_approvals_meetings.py` (5), `test_system.py` (7).

## Fase 6 — App Android ✅
- Todas las secciones (Home, Agents, Missions, Meetings, Memory, Activity, Projects, Settings + Chat, Aprobaciones,
  Notificaciones), diseño HUD propio, layout adaptativo, personajes dibujados por código con animaciones sincronizadas
  con el estado real (desactivables), editor de personaje y galería, voz (TTS por agente y dictado), Room, DataStore
  cifrado con Keystore, WebSocket con reconexión, WorkManager, FCM opcional.
- Tests: `ApiClientTest` (5), `LogicTest` (6), `UiIntegrationTest` y `TabletLayoutTest` (navegan la app real contra
  respuestas reales exportadas del backend por `test_contract_fixtures.py`). Capturas en `docs/screenshots/`.

## Fase 7 — Seguridad y estabilidad 🟡
- Hecho: auditoría completa, validación de permisos, control de gastos, recuperación de fallos, SSRF, sandbox,
  aislamiento por usuario, CI (GitHub Actions) para backend y Android.
- **Pendiente: pruebas de carga** (no ejecutadas).

## Fase 8 — Release 🟡
- Hecho: APK debug y release, Docker Compose de desarrollo y producción con HTTPS (Caddy), backups cifrados,
  Prometheus, documentación de instalación, proveedores y uso.
- **Pendiente** (ver lista abajo): instalación en un Android físico y prueba con un modelo real.

## Errores encontrados y corregidos durante el desarrollo
1. `updated_at` calculado en el servidor quedaba expirado tras cada UPDATE y fallaba en modo async → `onupdate` en Python.
2. La clave de idempotencia permanente de los trabajos impedía re-encolar al reanudar una misión → índice único
   parcial solo para trabajos activos (migración 0003).
3. `GROUP BY` con parámetros enlazados distintos en el consumo diario y en el estado de workers → expresiones literales.
4. La exportación de datos devolvía el `MetaData` de SQLAlchemy por una columna llamada `metadata` → atributos del mapper.
5. Acceso a objetos expirados después de `rollback` en el ejecutor de tareas y en el chat → se capturan IDs y se recargan.
6. Precedencia de operadores al detectar tokens FCM inválidos.
7. Selección del personaje por defecto con precedencia ambigua.
8. Lint fatal por una versión vieja de Fragment traída por Firebase → versión fijada.
9. Pestañas del editor desbordadas y botones partidos en dos líneas → pestañas desplazables, botones de una línea.
10. El WebSocket no arrancaba si no se disparaba el ciclo de vida del proceso → también se inicia desde la actividad.

## Integraciones pendientes / no verificadas en este entorno
- **Modelo real**: el código de los adaptadores se probó contra dobles HTTP fieles a cada API (y el backend real
  contra la API de Anthropic devuelve 401 sin clave, como corresponde). Falta correr una misión con una API key real.
  Para hacerlo en una sesión en la nube, la clave de Anthropic solo puede cargarse como variable de entorno del
  entorno (no como secreto de red); con ella: Ajustes › Proveedores › Anthropic.
- **Imágenes Docker**: Docker Hub devolvió 429 (límite anónimo) en este entorno, así que no se construyeron las
  imágenes ni se ejecutó el sandbox de código. Los archivos compose se validaron con `docker compose config`; el CI
  los usa con imágenes reales.
- **Dispositivo físico**: no hay emulador con aceleración en este entorno; la UI se verificó con Robolectric
  (renderizado nativo) navegando la app real.
- **FCM**: requiere un proyecto Firebase propio (instrucciones en `docs/setup/installation.md`).
- **Búsqueda web por plugin**: requiere API key de Brave o Tavily.

## Criterios de aceptación (PARTE 24)

| Criterio | Estado |
|---|---|
| La app instala y abre | APK compila y firma verificada; UI verificada en Robolectric. Falta instalar en un dispositivo físico |
| Registro e inicio de sesión | ✅ (tests backend y app) |
| El APK se comunica con el backend real | ✅ cliente HTTP + WebSocket contra servidor (fixtures reales); falta en dispositivo |
| Los seis agentes existen | ✅ |
| Los agentes usan modelos reales configurados | Implementado y probado con dobles HTTP; **falta la corrida con una API key real** |
| Se pueden agregar proveedores | ✅ |
| Agentes personalizados | ✅ |
| NEXUS crea misiones / subtareas / trabajo simultáneo / comunicación entre agentes | ✅ |
| Reuniones | ✅ |
| Memoria persistente que sobrevive reinicios | ✅ (PostgreSQL) |
| Trabajo sin la app abierta | ✅ (worker independiente) |
| Estados reales en la app | ✅ (WebSocket + API) |
| Notificaciones | ✅ en la app y sincronización; push real requiere Firebase |
| Permisos, auditoría, presupuestos, operaciones sensibles con autorización | ✅ |
| Recuperación de tareas interrumpidas | ✅ (`test_recovery.py`) |
| Botones y controles conectados | ✅ (sin acciones de relleno) |
| Pruebas de punta a punta | ✅ con dobles HTTP del proveedor; pendiente con modelo real |
| Documentación de instalación y configuración | ✅ |
