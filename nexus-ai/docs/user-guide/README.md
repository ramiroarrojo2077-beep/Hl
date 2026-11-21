# Guía de uso

## Primeros pasos

1. Abrí la app, escribí la **URL de tu servidor** (podés tocar *Probar conexión*) y creá tu cuenta.
2. **Ajustes › Proveedores de IA › Agregar proveedor**: elegí el tipo, pegá la API key y tocá *Probar conexión*.
   Tocá los modelos que quieras habilitar.
3. **Ajustes › Modelos**: revisá capacidades, calidad y precios (sin precio no se puede estimar el gasto). Opcional:
   marcá un modelo de embeddings para memoria semántica.
4. **Ajustes › Presupuestos**: fijá límites diario/mensual y por misión.
5. **Ajustes › Autonomía**: elegí *manual*, *autónomo supervisado* o *autonomía programada*.

## Home (command center)

Núcleo NEXUS (gira más rápido cuantos más agentes trabajan; rojo con STOP ALL, ámbar sin tiempo real), resumen del
sistema, agentes activos con su actividad real, línea de tiempo de misiones, comandos rápidos, métricas reales del
servidor, memoria, estado de los proveedores, actividad reciente, alertas y consumo. **TALK TO NEXUS** dicta una
instrucción por voz y la envía al chat.

## Agentes y personajes

- **Agent Center**: cada agente con su personaje, rol, modelo, estado real, tarea actual y última actividad.
- **Perfil**: descripción, rasgos, instrucciones versionadas (podés restaurar versiones), herramientas y permisos
  (automático o con aprobación), modelos asignados en orden, historial de tareas, memoria individual, estadísticas y
  configuración (habilitar, memoria, reuniones, presupuesto diario).
- **Editor de personaje** (`Personaje`): pestañas Identidad, Apariencia (complexión, peinado, colores, vestimenta,
  accesorio, con vista previa), Personalidad y Emociones (sliders que cambian el tono del agente en su prompt) y Voz
  (altura, velocidad, timbre, acento y *Voice preview*). **Presets** abre la galería de personajes.
- **Nuevo agente**: mismo editor más herramientas y modelos iniciales.

## Chat con NEXUS

Respuestas en streaming. NEXUS puede responder directamente, consultar a otros agentes (se ve quién aportó), crear
misiones, convocar reuniones, buscar en la memoria o leer archivos de un proyecto. 🎤 dicta, 📎 adjunta archivos (se
guardan en el proyecto de la conversación), 🔊 lee la respuesta con la voz del agente.

## Misiones

Creá una misión con objetivo, proyecto, prioridad, autonomía y presupuesto. En el detalle: progreso real, tareas
(lista o **flujo** con dependencias), resultado final, conversación del equipo, revisión de ORACLE, auditoría de
GUARDIAN y el plan. Acciones: pausar, reanudar, cancelar, cambiar prioridad y, por tarea, reintentar, cancelar u
omitir. Cada tarea muestra sus intentos y pasos (modelos y herramientas usados).

## Aprobaciones

Las operaciones sensibles (modificar archivos con permiso de aprobación, comunicaciones externas en modo supervisado,
operaciones irreversibles, planes en modo manual) esperan tu decisión en **Aprobaciones**. Al aprobar, el agente
retoma exactamente donde estaba; al rechazar, continúa sin esa operación.

## Reuniones

Elegí tipo, tema, objetivo, participantes y límites. NEXUS modera; cada intervención es una ejecución real del modelo
del agente y lleva su etiqueta (propuesta, pregunta, objeción, acuerdo…). Al terminar: resumen, decisiones,
argumentos, desacuerdos, tareas derivadas con responsables y próximos pasos. *Convertir en misión* ejecuta las tareas.

## Memoria, actividad y proyectos

- **Memory Center**: búsqueda semántica y por ámbito; verificá, rechazá, corregí o eliminá recuerdos; agregá los tuyos.
- **Activity Center**: registro de auditoría filtrable por fecha, resultado, agente, misión y proyecto.
- **Projects**: espacios con objetivo, agentes asignados y su responsabilidad, archivos versionados (se indexan en la
  memoria del proyecto), misiones, memoria propia, documentación y chat del proyecto.

## STOP ALL AGENTS

Botón rojo de la barra superior. Detiene a todos tus agentes: no arrancan tareas nuevas, las que están en curso se
interrumpen en su próximo punto seguro y quedan pendientes, se invalidan permisos temporales y aprobaciones
pendientes, y todo queda registrado. *Reanudar* desactiva la detención y retoma las misiones pausadas por ella.
