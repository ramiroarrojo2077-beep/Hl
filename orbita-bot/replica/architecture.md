# Arquitectura independiente

Cliente de escritorio Electron → servicio personal en loopback → SQLite → bucle de agente → herramientas y proveedor oficial xAI.

- Electron permite reutilizar una interfaz local en macOS/Windows/Linux. La ventana no es el motor: los trabajos viven en el servicio y siguen al cerrar la ventana mientras el proceso esté activo.
- Node 24 y SQLite evitan dependencias de una base de datos remota. Un espacio personal por proceso/directorio; no se presenta como SaaS multiusuario.
- El agente itera llamadas de función del modelo, guarda actividad y pide aprobación para mutaciones y acciones de navegador/terminal. Cada aprobación corresponde a argumentos inmutables, caduca y solo se consume una vez.
- Archivos de texto compartidos en SQLite, memoria por bot y biblioteca común de skills. Terminal en contenedor Docker con volumen propio, sin montar el disco del usuario ni el socket Docker dentro del contenedor. Navegador en perfil dedicado; no usa las sesiones personales del navegador habitual.
- Una tarea activa por bot, máximo tres bots simultáneos, límite de pasos y profundidad de delegación. Recuperación conservadora: una tarea interrumpida se marca como error; nunca se repiten automáticamente efectos tras un reinicio.
- Rutinas almacenadas en UTC; la interfaz muestra hora local. Se ejecutan cuando está activo el servidor. El scheduler omite repeticiones atrasadas y evita duplicar tareas.

## API local

GET /api/config, /api/state; POST/PATCH/DELETE /api/bots; GET /api/bots/:id/messages; POST /api/bots/:id/tasks; POST /api/jobs/:id/cancel; CRUD /api/routines, /api/files, /api/skills; POST /api/approvals/:id; GET /api/computer.

Solo loopback, validación Host/Origin, token anti-CSRF por proceso, CSP y validación del servidor. No se permite exponer el servicio directamente a internet. Las claves solo residen en configuración del proceso.

## Límites de infraestructura

El modo local no equivale al ordenador cloud del original: suspender/apagar el equipo detiene trabajos. Una instalación en servidor permanente accesible por túnel privado es posible, pero el aprovisionamiento cloud y el acceso remoto autenticado no están implementados en esta versión. No se reutiliza ningún servicio privado de Grok Bot.
