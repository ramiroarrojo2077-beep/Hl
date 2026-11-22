# Estado del proyecto y reportes por fase

Rama: `ccr-3bafa18c-wee3mx`

# NEXUS 2.1 — Modo local (sin servidor)

Fecha: 22/11/2026. A pedido del usuario (sin presupuesto para un servidor), la app incluye un backend completo que
corre en el teléfono. Guía: [setup/LOCAL_MODE.md](setup/LOCAL_MODE.md).

**Cómo está hecho**
- La app sigue usando la misma API v1. En modo local, un interceptor de OkHttp atiende esas llamadas dentro del
  teléfono (`android/app/src/main/java/ai/nexus/app/local/`), así que las pantallas no cambiaron.
- Los datos se guardan en SQLite local.
- Los modelos de IA se llaman directo desde el teléfono con streaming. Proveedores soportados: Gemini, Groq,
  OpenRouter, OpenAI, Anthropic, compatibles con OpenAI y Ollama en la red local. Hay respaldo automático entre modelos.
- Los eventos en tiempo real salen del propio teléfono, sin WebSocket.
- Se portaron desde el backend el clasificador de intenciones, el intérprete de fechas, el Action Registry, las
  respuestas de JARVIS, el orquestador de misiones, las reuniones, las rutinas con límites y anti-bucle, la memoria y
  STOP ALL.
- Los datos fijos se exportan del backend Python a `assets/local/seed.json`: agentes, personalidades, catálogo de
  acciones y eventos.

**Verificación**

| Prueba | Resultado |
|---|---|
| Equivalencia del clasificador Kotlin con el de Python (45 frases y respuestas pendientes; vectores generados por el backend en `shared/intent_vectors.json`) | ✅ idéntico |
| Backend local de punta a punta con la API real de la app (equipo, recordatorio verificado, WhatsApp con número cifrado y «todavía no está enviado», sin modelo lo dice, STOP ALL) | ✅ |
| Respuesta de modelo con streaming real (SSE), tokens, traza, colaboración real de ATLAS | ✅ (proveedor emulado con MockWebServer) |
| Misión completa (plan → 2 tareas con dependencia → revisión de ORACLE → consolidación), reunión con acta, chat con CIPHER | ✅ |
| Rutina diaria (cron, confirmación obligatoria, ejecución con límites) y recordatorio que se dispara una sola vez | ✅ |
| Protocolos de Gemini y Anthropic (SSE, roles, encabezados, razonamiento oculto, error 429 transitorio) | ✅ |
| UI real sin servidor: «Empezar en este teléfono» → Home en «MODO LOCAL» → recordatorio → aviso de falta de modelo → pantalla de proveedores gratuitos | ✅ con capturas |
| Suite completa de la app | **35/35** |

**Pendiente / no verificado**
- No se probó con claves reales de Gemini o Groq: no hay claves en este entorno. Los adaptadores se probaron con
  servidores que reproducen el formato exacto de cada API.
- No se probó en un teléfono físico. En particular falta verificar el trabajo en segundo plano con la app cerrada: los
  recordatorios dependen de WorkManager y Android puede demorarlos con ahorro de batería.
- En modo local no hay búsqueda web, sandbox de código, WhatsApp Business ni comparador de modelos (requieren servidor).

---

# NEXUS 2.0 — JARVIS EVOLUTION

Fecha: 22/11/2026. Base: NEXUS AI 1.0 (`e783d48`), auditada y ampliada sin reconstruir
([auditoría](AUDIT_2.0.md)).

## Verificación

| Verificación | Resultado |
|---|---|
| Tests del backend (PostgreSQL 16 + pgvector reales) | **96/96 aprobados** (69 de la 1.0 + 27 nuevos) |
| Tests de la app (JVM + Robolectric, UI de punta a punta con capturas) | **28/28 aprobados** (13 de la 1.0 + 15 nuevos) |
| Flujo WhatsApp de 10 pasos (pedido → contacto → número → vista previa → confirmación → apertura → «todavía no enviado») | aprobado en backend (`test_whatsapp_flow_never_claims_sent`) y en la app (`homeWhatsappActionsMoreAndVoiceSettings`) |
| Migraciones 0004 y 0005 (upgrade/downgrade, `alembic check` sin drift) | aprobado |
| Prueba de carga (1.800 solicitudes, concurrencia 16, 4 workers) | 313 req/s, 0 errores, p95 global 126 ms ([informe](PERFORMANCE_2.0.md)) |
| APK 2.0.0 debug y release | compilan; release firmada (v2) verificada con `apksigner`; permisos verificados con `aapt2` |

## Fases

| Fase | Estado | Qué quedó |
|---|---|---|
| 0 — Auditoría | ✅ | Correspondencia APK ↔ código (178 clases), inventario, hallazgos ([AUDIT_2.0.md](AUDIT_2.0.md)) |
| 1 — JARVIS CORE | ✅ | Pipeline de 10 etapas con traza real, clasificador de intenciones en español rioplatense, horarios y datos faltantes en varios pasos, personalidad, respuestas de largo adaptativo, estados reales (`jarvis.state`) |
| 2 — Home 2.0 | ✅ | Zonas A–E, navegación HOME/CHAT/ACCIONES/MÁS, núcleo holográfico con 9 estados reales, diseño fiel a las referencias JARVIS/NOVA |
| 3 — Voz | ✅ en código y pruebas · 🟡 en dispositivo | STT/TTS en el teléfono, barge-in, modo continuo, palabra de activación local opcional con consentimiento, ajustes de voz, STT remoto opcional |
| 4 — WhatsApp | ✅ · 🟡 Business sin credenciales | Click to Chat con vista previa obligatoria y normalización argentina; Business Platform oficial con webhooks firmados ([guía](setup/WHATSAPP.md)) |
| 5 — Phone Control | ✅ · 🟡 en dispositivo | Action Registry con clases de riesgo, intents oficiales, resultado real reportado por el teléfono ([permisos](setup/PERMISSIONS.md)) |
| 6 — Inteligencia | ✅ | Multiagente invisible con vista avanzada, memoria con categorías de privacidad, puntajes de calidad por modelo y tarea en el router, rutinas con límites y anti-bucle, STOP ALL ampliado |
| 7 — UI premium y accesibilidad | ✅ | Personajes 3D reales, tipografías Rajdhani/Orbitron, paneles HUD, objetivos táctiles ≥ 48 dp, descripciones para lectores de pantalla, movimiento reducido |
| 8 — Estabilidad y rendimiento | ✅ | Prueba de carga, costo de render 3D, tamaño de APK, deduplicación de eventos tras reconexión, reportes de fallos con consentimiento |
| 9 — Entrega | ✅ | APK, código, migraciones, documentación, capturas |

Nota de diseño: la paleta verde de la especificación 2.0 se reemplazó, a pedido del usuario, por la estética cian
holográfica de las referencias JARVIS/NOVA.

## Errores encontrados y corregidos (2.0)
1. Esquema de la base de pruebas desactualizado tras cambiar modelos → se recrea antes de migrar.
2. La etiqueta de contacto de WhatsApp podía contener el número → solo el alias, con el número enmascarado.
3. La traza del pipeline no se guardaba (la lista se mutaba después del flush) → se asigna una copia al cerrar la última etapa.
4. «¿» y «¡» iniciales rompían la detección de intenciones → se quitan antes de clasificar.
5. Las capacidades `stt`/`tts` no existían en el enum de capacidades → agregadas.
6. La búsqueda de puntajes de calidad usaba `/` en vez de `:` en la etiqueta del modelo.
7. Pruebas JVM puras fallaban con `org.json` (stub de Android) → `kotlinx.serialization`.
8. Texto hablado con espacios antes de la puntuación → corregido.
9. El reporte de una acción del teléfono podía perderse si la pantalla se cerraba → efectos por `Channel` con buffer.
10. Volver a tocar «Más» restauraba una sub-pantalla → vuelve a la raíz de la pestaña.
11. Botón «Confirmar» de WhatsApp truncado → fila de ancho completo.
12. Frase «el mañana a las…» en confirmaciones → fechas con formato correcto.
13. Motor 3D: índices fuera de rango, culling invertido y artefactos del algoritmo del pintor → z-buffer y baricéntricas corregidas.
14. Con varios procesos de API, la sincronización de herramientas chocaba (clave duplicada) → upsert atómico.
15. **Historial con pregunta y respuesta invertidas**: se guardaban en la misma transacción con la misma marca de
    tiempo → `clock_timestamp()` (migración 0005) + prueba de regresión que falla sin el arreglo.
16. **Estado «ejecutando» colgado** si el teléfono nunca reportaba una acción → las acciones vencidas no cuentan + prueba.
17. **Los avisos tapaban el botón Enviar y el micrófono** durante unos segundos → avisos con estilo HUD arriba.
18. **La respuesta nueva quedaba fuera de pantalla** en la Home → la vista sigue al último mensaje y a la confirmación más reciente.
19. Pruebas de UI dependientes de la hora (saludo «Buenas tardes») → leen el saludo exportado por el backend.
20. La prueba de conversación pasaba aunque el mensaje no se enviara (la respuesta ya estaba en el historial) →
    ahora exige la solicitud al servidor, simula el streaming real por WebSocket y verifica que la respuesta esté visible.

## Pendiente / no verificado en este entorno
- **Modelo real**: probado con dobles HTTP fieles a cada API. Falta una corrida con API key real (primer fragmento
  del streaming, calidad real de respuestas).
- **Dispositivo físico** (no hay Android ni emulador acelerado aquí):
  - instalar el APK;
  - verificar el reconocimiento y la voz reales, el barge-in con eco del altavoz y la palabra de activación (consumo en 30 min);
  - medir el arranque en frío, los FPS y la batería;
  - comprobar que los intents oficiales abren las apps reales (WhatsApp, Reloj, Calendario, Ajustes, Mapas).
- **WhatsApp Business**: implementado con firma de webhooks; falta probar con credenciales reales de Meta.
- **Imágenes Docker**: Docker Hub devolvió 429 en este entorno; compose validado con `docker compose config`.
- **FCM**: requiere un proyecto Firebase propio.
- **STT/TTS remotos**: requieren un modelo con esas capacidades; sin él, la app usa la voz del teléfono (y lo dice).
- **Búsqueda web por plugin**: requiere API key de Brave o Tavily.

---

# NEXUS AI 1.0 (histórico)

### Resumen de verificación

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

### Fase 1 — Fundación ✅
- FastAPI, SQLAlchemy async, Alembic (3 migraciones), 36 tablas con FKs e índices, logs JSON, health/ready/metrics.
- Auth: argon2id, JWT de 15 min, refresh tokens opacos rotados por familia con detección de reutilización, sesiones
  revocables, rate limiting; secretos cifrados con Fernet (rotación).
- Tests: `test_auth.py` (7).

### Fase 2 — Motor multiagente ✅
- Seis agentes con identidad, instrucciones versionadas, permisos por herramienta, personaje (rasgos → prompt,
  apariencia, voz), estados reales emitidos por WebSocket; agentes personalizados; consultas entre agentes.
- Tests: `test_agents.py` (8), `test_policy.py` (6).

### Fase 3 — Multimodelo ✅
- Adaptadores Anthropic (con streaming SSE, `effort`, búsqueda web nativa), OpenAI, OpenAI-compatible, Gemini, Ollama.
- Router por capacidades/calidad/asignación/costo, fallback solo compatible, reintentos, consumo y costos, presupuestos,
  comparación de modelos con juez a ciegas.
- Tests: `test_providers.py` (8), `test_adapters.py` (8).

### Fase 4 — Memoria ✅
- pgvector HNSW (768), búsqueda híbrida léxico + semántico + full-text con RRF, ámbitos aislados (agente, compartida,
  usuario, proyecto), control de calidad (fuente, fecha, confianza, verificación, caducidad), deduplicación,
  indexado de PDF/DOCX/TXT/MD/código con versiones.
- Tests: `test_memory.py` (5).

### Fase 5 — Autonomía ✅
- Plan validado como DAG, ejecución paralela, revisión de ORACLE con rondas de corrección, auditoría de GUARDIAN con
  evidencia real, consolidación, aprendizajes; aprobaciones con reanudación exacta; reuniones con límites; chat con
  streaming; programador cron (misiones, reuniones, recordatorios); STOP ALL; cola durable con recuperación.
- Tests: `test_orchestrator.py` (5), `test_recovery.py` (2), `test_approvals_meetings.py` (5), `test_system.py` (7).

### Fase 6 — App Android ✅
- Todas las secciones (Home, Agents, Missions, Meetings, Memory, Activity, Projects, Settings + Chat, Aprobaciones,
  Notificaciones), diseño HUD propio, layout adaptativo, personajes dibujados por código con animaciones sincronizadas
  con el estado real (desactivables), editor de personaje y galería, voz (TTS por agente y dictado), Room, DataStore
  cifrado con Keystore, WebSocket con reconexión, WorkManager, FCM opcional.
- Tests: `ApiClientTest` (5), `LogicTest` (6), `UiIntegrationTest` y `TabletLayoutTest` (navegan la app real contra
  respuestas reales exportadas del backend por `test_contract_fixtures.py`). Capturas en `docs/screenshots/`.

### Fase 7 — Seguridad y estabilidad 🟡
- Hecho: auditoría completa, validación de permisos, control de gastos, recuperación de fallos, SSRF, sandbox,
  aislamiento por usuario, CI (GitHub Actions) para backend y Android.
- **Pendiente: pruebas de carga** (no ejecutadas).

### Fase 8 — Release 🟡
- Hecho: APK debug y release, Docker Compose de desarrollo y producción con HTTPS (Caddy), backups cifrados,
  Prometheus, documentación de instalación, proveedores y uso.
- **Pendiente** (ver lista abajo): instalación en un Android físico y prueba con un modelo real.

### Errores encontrados y corregidos durante el desarrollo
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

### Integraciones pendientes / no verificadas en este entorno
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

### Criterios de aceptación (PARTE 24)

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
