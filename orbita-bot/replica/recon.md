# Reconocimiento de Grok Bot

Fecha: 2026-10-19. Objetivo del usuario: replicar Grok Bot como producto de agentes persistentes; una web de chat no satisface el encargo. Implementación independiente, identidad provisional Órbita.

## Fuentes públicas consultadas

- https://docs.x.ai/grok-bot/overview — bots persistentes y ordenador compartido.
- https://docs.x.ai/grok-bot/bots — perfiles, memoria, duplicación y borrado.
- https://docs.x.ai/grok-bot/chat-and-collaboration — tareas, herramientas, grupos, delegación y aprobaciones.
- https://docs.x.ai/grok-bot/computer-and-apps — navegador, terminal, archivos y conectores.
- https://docs.x.ai/grok-bot/skills-routines-and-automations — instrucciones reutilizables y horarios.
- https://docs.x.ai/grok-bot/approvals-security-and-privacy — revisión de acciones y límites de acceso.
- https://docs.x.ai/developers/model-capabilities/text/generate-text — API oficial de generación.
- https://docs.x.ai/developers/tools/function-calling — llamadas a herramientas.

No se inspeccionó código, tráfico privado ni una cuenta del producto. Los estados visuales originales no se han observado: no se afirmará paridad de píxeles.

## Pantallas propuestas (no observaciones del original)

| ID | Pantalla | Propósito | Estados |
|---|---|---|---|
| S01 | Espacio de bots | Crear y seleccionar agentes | Vacío, lista, búsqueda |
| S02 | Conversación y actividad | Asignar tareas y revisar resultados | Inactivo, ejecutando, aprobación, error, cancelado |
| S03 | Perfil y memoria | Definir rol y contexto duradero | Crear, editar, borrar |
| S04 | Rutinas | Programar trabajos | Activa, pausada, ejecución manual |
| S05 | Archivos | Contexto y resultados compartidos | Vacío, cargar, descargar, borrar |
| S06 | Skills | Procesos reutilizables | Crear, consultar, eliminar |
| S07 | Ordenador | Ver navegador y disponibilidad de terminal | Disponible, no configurado, error |
| S08 | Ajustes | Capacidades y conexión | Demo, proveedor configurado |

## Flujos

- F01: crear bot → asignar tarea → ejecutar herramientas → obtener resultado.
- F02: revisar operación y argumentos → permitir una vez o rechazar → continuar.
- F03: guardar memoria/skill → iniciar otra tarea → reutilizar contexto.
- F04: crear rutina → ejecutar a su hora → guardar resultado; pausar y eliminar.
- F05: escribir/leer archivos → compartir contexto → descargar resultado.
- F06: bot propietario → enviar tarea a especialista → registrar el traspaso.
- F07: cerrar ventana → continuar en proceso de escritorio; salir del proceso → detener y marcar tareas interrumpidas.

Entidades propias inferidas, confianza alta en su necesidad funcional, sin afirmar correspondencia con el esquema privado: Bot, Message, Job, ToolCall/Approval, Routine, Skill, File.

## Alcance y riesgos

El producto completo es XL: aplicaciones móviles, flota cloud, aislamiento multiusuario, conectores OAuth, voz y marketplace requieren infraestructura e integraciones adicionales. Esta entrega debe implementar y probar el núcleo de agentes de escritorio, y enumerar las brechas sin llamar réplica completa a un prototipo.

Tres riesgos principales: autorización de herramientas, fiabilidad de trabajos persistentes y disponibilidad del proveedor de modelos. No se dispone de clave xAI configurada. Docker requiere verificación del acceso al daemon. No se compran servicios ni se publica.
