# Arquitectura

```
ANDROID (Kotlin + Compose)
   │  HTTPS (REST /api/v1)          WebSocket /api/v1/ws (eventos en tiempo real)
   ▼
API (FastAPI) ── auth · usuarios · permisos · notificaciones · rate limiting · auditoría
   │
   ├── PostgreSQL + pgvector ── estado, memoria, embeddings, cola durable (tabla jobs), auditoría
   ├── Redis ── pub/sub de eventos entre procesos, despertar de workers, rate limiting
   │
WORKERS (python -m app.worker, escalables horizontalmente)
   ├── Orquestador de misiones (plan → DAG → ejecución → revisión → auditoría → consolidación)
   ├── Agent Runtime (identidad + memoria selectiva + herramientas + políticas)
   ├── Motor de reuniones · chat con streaming · indexado de documentos · programador cron
   └── AI Provider Gateway ── Anthropic · OpenAI · OpenAI-compatible · Gemini · Ollama
```

## Módulos del backend (`backend/app/`)

| Módulo | Responsabilidad |
|---|---|
| `core/` | configuración, base de datos, seguridad (argon2, JWT), cifrado Fernet, eventos, Redis, rate limit, logs JSON |
| `models/` | esquema relacional normalizado (36 tablas + 3 migraciones Alembic) |
| `auth/` | registro, login, rotación de refresh tokens con detección de reutilización, sesiones |
| `agents/` | equipo inicial, personajes, runtime de agentes, API de agentes y permisos |
| `providers/` | adaptadores, router, gateway con fallback, presupuestos, comparación de modelos |
| `memory/` | embeddings, búsqueda híbrida, extracción de documentos, API de memoria |
| `tools/` | registro de herramientas, ejecutor con políticas e idempotencia, web segura, sandbox |
| `security/` | motor de políticas (GUARDIAN determinista), aprobaciones, STOP ALL |
| `orchestrator/` | planificador, motor de misiones, revisión y consolidación |
| `jobs/` | cola durable, handlers, programador de tareas recurrentes |
| `meetings/`, `chat/`, `missions/`, `projects/`, `notifications/`, `monitoring/`, `settings/` | dominio y API |

## Ciclo autónomo de una misión

1. **Recibir objetivo** (`POST /missions` o la herramienta `missions.create` desde el chat). Se guarda la misión
   y, en la misma transacción, el trabajo `mission.plan` (outbox transaccional).
2. **Analizar y planificar**: NEXUS recibe el objetivo, el equipo disponible y memoria relevante, y devuelve un
   plan JSON (análisis, complejidad, necesidad de investigación, estrategia, riesgos y tareas). El plan se valida:
   claves únicas, agentes existentes, dependencias existentes, sin ciclos (orden topológico) y tope de tareas. Si es
   inválido, se le devuelve el error a NEXUS para que lo corrija una vez.
3. **Dividir y asignar**: se crean `mission_tasks` y `task_dependencies`. En modo manual, el plan espera aprobación.
4. **Comprobar permisos y ejecutar**: las tareas sin dependencias pendientes se encolan; varios workers (y varias
   tareas por worker) las ejecutan en paralelo, con límite de concurrencia por usuario y por proveedor.
5. **Registrar resultados**: cada intento (`task_attempts`) guarda pasos, modelo, tokens y costo; cada llamada a un
   modelo genera un `usage_record`; cada acción, un `audit_log`; cada cambio, un evento por WebSocket.
6. **Revisar calidad**: ORACLE evalúa el conjunto (veredicto, puntaje, problemas). Si pide correcciones con severidad
   media/alta, se crean tareas de revisión para el agente original y se vuelve a revisar (rondas configurables).
7. **Auditar seguridad**: GUARDIAN recibe evidencia real del registro (ejecuciones, bloqueos, comunicaciones externas,
   modificaciones, aprobaciones) y los resultados. Un hallazgo crítico bloquea la misión hasta que el usuario decida.
8. **Consolidar e informar**: NEXUS integra todo en un informe final y propone aprendizajes, que se guardan como
   memoria **no verificada** (el usuario puede verificarla, corregirla o borrarla). Se notifica al usuario.

## Cola durable y recuperación

- Tabla `jobs` con `status`, `lease_owner`, `lease_expires_at`, `attempts`, `run_after`.
- Los workers reclaman con `FOR UPDATE SKIP LOCKED` y renuevan el lease con heartbeats.
- Si un worker muere, el lease vence y `recover_expired` devuelve el trabajo a la cola (o lo marca fallido si agotó
  intentos, con efectos explícitos: tarea fallida, misión bloqueada, notificación).
- Índice único parcial: como máximo un trabajo **activo** por clave lógica (`task.run:<id>`), lo que evita
  duplicados concurrentes y permite re-encolar al reanudar.
- Todos los handlers son idempotentes respecto del estado (una tarea completada no se re-ejecuta; una ronda de
  reunión no repite intervenciones ya registradas; un chat no responde dos veces).
- Las herramientas con efectos usan `idempotency_key` (tarea + herramienta + argumentos): si el worker murió después
  de ejecutarla, el reintento reutiliza el resultado registrado en lugar de repetir el efecto. Esto está cubierto por
  `tests/test_recovery.py`, que cancela un worker en plena tarea, vence el lease y verifica que la misión termine sin
  duplicar la operación.
- Apagado ordenado (SIGTERM): el worker deja de reclamar, espera a los trabajos en curso y libera los que no
  terminaron para que otro worker los tome de inmediato.

## Memoria

- `memory_items` (contenido, ámbito, tipo, fuente, fecha, confianza, verificación, caducidad, agente/proyecto/misión)
  y `memory_embeddings` (vector(768) por modelo, índice HNSW coseno).
- Siempre se calcula un embedding **léxico** local (feature hashing de unigramas y bigramas, normalizado) y, si hay un
  modelo de embeddings configurado, uno **semántico**. La búsqueda fusiona ambos con full-text (`tsvector`) mediante
  Reciprocal Rank Fusion, pondera por confianza y verificación y descarta coincidencias lejanas.
- Aislamiento: un agente ve su memoria individual, la compartida, la del usuario y **solo** la del proyecto en curso.
- Recuperación selectiva: cada ejecución recibe los `memory_top_k` recuerdos más relevantes, con su procedencia.

## Seguridad

- Contraseñas con argon2id; access tokens JWT de 15 min; refresh tokens opacos (hash SHA-256 en base) rotados por
  familia; reutilizar un token rotado revoca la familia completa. Cada request verifica que la sesión siga activa.
- API keys de proveedores y configuración secreta de plugins cifradas con Fernet (MultiFernet para rotar claves);
  nunca se devuelven al cliente ni llegan a los agentes. Logs con redacción de secretos.
- Motor de políticas: STOP ALL → herramienta habilitada → permiso del agente (solo editable por el usuario) →
  plugin habilitado y permiso concedido → regla por clase de operación y modo de autonomía. Las operaciones
  irreversibles siempre requieren confirmación; la administración de cuenta está prohibida a los agentes.
- Contenido externo (web, documentos, resultados de herramientas) se envuelve como `<untrusted_data>` y las políticas
  del sistema indican no seguir instrucciones contenidas ahí.
- Lectura web con protección SSRF (solo destinos públicos, redirecciones verificadas, límites de tamaño y tiempo).
- Sandbox de código: contenedor efímero sin red, sistema de archivos de solo lectura, usuario sin privilegios, límites
  de CPU, memoria, procesos y tiempo.
- Aislamiento de datos por usuario en todas las consultas (cubierto por tests de aislamiento).

## App Android (`android/app/src/main/java/ai/nexus/app/`)

| Paquete | Contenido |
|---|---|
| `core/design` | tema HUD (paleta del producto), paneles, chips, sliders de rasgos, anillos, ondas |
| `core/avatar` | núcleo NEXUS animado y personajes de cuerpo completo dibujados por código |
| `core/network`, `core/realtime`, `core/session` | cliente HTTP con renovación de tokens, WebSocket con reconexión, sesión cifrada |
| `data` | DTOs del contrato, API tipada, caché Room |
| `navigation` | shell adaptativo (barra inferior en teléfono, panel lateral en tablet), STOP ALL global |
| `features/*` | dashboard, agentes y editor de personaje, chat, misiones, reuniones, memoria, actividad, proyectos, aprobaciones, ajustes |
| `push`, `voice` | FCM opcional + sincronización periódica; TTS por agente y dictado por voz |

Las animaciones de los avatares y del núcleo dependen del estado real recibido del backend y pueden desactivarse.
