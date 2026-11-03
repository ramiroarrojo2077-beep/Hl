# Gravity NEXT · Plan técnico por entregas

Basado en la auditoría (`AUDITORIA.md`). Regla de todas las entregas: **nada se borra ni se reemplaza sin migrar**, cada entrega cierra con pruebas automáticas y una APK compilada por la CI.

## Decisiones de arquitectura (y por qué)

| Tema | Decisión | Motivo |
|---|---|---|
| Capas | Se mantiene Android (Kotlin) + Node embebido + web en WebView. | Funciona, ya está probada y permite usar la misma interfaz en la compu y en el celular. Reescribir en otra tecnología rompería funciones que andan. |
| Interfaz | Sigue siendo HTML/JS sin frameworks, partida en módulos cuando crezca (ES modules locales). | React + Vite sumaría un paso de compilación y peso sin resolver ningún problema actual; se reevalúa si el archivo se vuelve inmanejable. |
| Persistencia | SQLite con `node:sqlite` (viene en Node 24 de nodejs-mobile, variante full) **en paralelo** a los JSON actuales, migrando por módulo (primero memoria con FTS5 y proyectos). Los JSON quedan como respaldo de la migración. | Búsqueda de texto completo y consultas sin cargar todo en memoria. Migración reversible. |
| Bus de eventos | Ya existe (`eventos.ts` + SSE). Se le agrega id, origen, fecha y validación cuando lo usen módulos nuevos. | Evitar reescribir lo que anda. |
| Modelos | `proveedores.ts` es el Model Router: se le agrega modelo por agente y por tarea, y registro de consumo real/estimado/desconocido. | Ya traduce Anthropic ↔ Gemini/Groq/Mistral con cambio por cupo. |
| Voz | Puente nativo Android (SpeechRecognizer + TextToSpeech) expuesto al WebView; en Chrome, Web Speech API. | El WebView de Android no trae la Web Speech API. |
| Avatar 3D | three.js local (sin internet), robot modelado por código con articulaciones, animación procedural + AnimationMixer, sincronizado con la envolvente real del audio. | Geometría 3D real, liviana, sin assets externos ni licencias de modelos. |
| WhatsApp | Se mantiene la vía por notificaciones (lo que el usuario usa hoy) y se conecta `whatsapp.ts` (API oficial de WhatsApp Cloud) como alternativa oficial para WhatsApp Business. | La API oficial necesita cuenta de Meta Business, número verificado y una URL pública para el webhook: en un celular solo, eso requiere un túnel o un servidor. Se documenta el costo. |

## Entregas

| # | Entrega | Contenido | Estado |
|---|---|---|---|
| 1 | Recuperación y diagnóstico | Auditoría del APK, arreglo del APK portado al código, plan, pruebas de regresión existentes (e2e interfaz 30 pasos, mensajería, videos, puestos). | ✅ hecha |
| 1b | Mensajería que no envía | Confirmación real del envío, acción fresca de la notificación, null en herramientas, reintentos. | 🟡 en código, falta probar en el celular |
| 6a | **Llamadas de voz + robot 3D** (adelantada por pedido explícito) | Puente de voz nativo, pantalla de llamada sobre el chat real, robot 3D con estados y gestos por audio, personalización por agente. | 🔨 en curso |
| 2 | Núcleo estable | Exportar/importar datos (zip), copias de seguridad, CSP en la interfaz, salud y diagnóstico en Ajustes, SQLite en paralelo. | pendiente |
| 3 | Agentes y memoria | Perfil completo del agente (personalidad, objetivos, restricciones, autonomía 0-3, modelo y herramientas permitidas aplicadas en el motor), memoria con búsqueda (FTS5), memoria compartida con permisos. | pendiente |
| 4 | Colaboración | Proyectos (objetivo, tareas con dependencias, Kanban/lista, archivos, historial), reuniones con pausa/reanudar y deliberación por fases. | pendiente |
| 5 | Integraciones | Router de modelos por agente/tarea con presupuestos, Telegram Bot API, Google Calendar/Drive, GitHub, webhooks; WhatsApp Cloud API conectada. | pendiente |
| 6b | Experiencia | Rediseño (paleta NEXT), dashboard de inicio, accesibilidad completa. | pendiente |
| 7 | Calidad y lanzamiento | Revisión de seguridad completa, pruebas en emulador/dispositivo, informe de rendimiento, firma release con clave privada. | pendiente |

## Lo que no se puede prometer

- **Ejecución de código aislada en el celular:** Android no deja ejecutar binarios descargados; los bots solo tienen el `sh` del sistema. Un sandbox real (con límites de CPU/memoria/red) necesita un servidor aparte.
- **Segundo plano ilimitado:** Android puede frenar o matar la app (sobre todo algunas marcas); para rutinas garantizadas hace falta un servidor.
- **Voz sin internet:** el reconocimiento usa el servicio de voz del celular (Google); según el equipo funciona sin conexión o no. La respuesta del agente necesita el modelo de IA (internet).
- **WhatsApp personal automatizado** no está permitido por WhatsApp; la vía por notificaciones funciona pero puede tener riesgo de bloqueo con uso intenso.
