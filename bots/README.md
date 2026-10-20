# Compas

Compañeros de IA persistentes, al estilo de Grok Bot. Cada compañero tiene un trabajo, memoria propia y acceso a una computadora compartida (terminal y archivos). Les escribís por chat, trabajan solos y te piden aprobación antes de hacer algo que modifique la máquina. También pueden trabajar con horario, mediante rutinas.

"Compas" es un nombre provisorio. El relevamiento del producto original está en [`../replica/recon.md`](../replica/recon.md) y la matriz de funcionalidades en [`../replica/features.csv`](../replica/features.csv).

## Uso

Requiere Node.js 22.18 o superior, Linux o macOS (en Windows, usá WSL) y una API key de Anthropic.

```bash
npm install
cp .env.example .env   # y completá ANTHROPIC_API_KEY
npm run bots
```

Abrí http://127.0.0.1:3001, sumá un compañero sugerido o creá el tuyo, y escribile.

## Qué hace

- **Compañeros**: nombre, puesto y una descripción del trabajo. Hay cinco sugeridos (investigación, precios y proveedores, programación, redacción y monitoreo). En la lista se ve quién está trabajando, quién espera tu aprobación y quién tiene novedades.
- **Chat**: la respuesta llega en vivo, con notas de progreso y cada búsqueda, comando o archivo que el compañero toca. Si le escribís mientras trabaja, el mensaje queda en cola. **Detener** corta lo que está haciendo.
- **Computadora**: una carpeta compartida por todos los compañeros (por defecto `~/compas/computadora`). Cada compañero tiene su propia terminal persistente ahí y herramientas para leer, escribir, editar y buscar archivos. La pestaña Computadora muestra los archivos y los últimos comandos.
- **Web**: búsqueda y lectura de páginas.
- **Aprobaciones**: ejecutar comandos, escribir o editar archivos y cambiar rutinas piden permiso con **Permitir una vez**, **Siempre permitir** o **Negar**. "Siempre permitir" para comandos se guarda por programa (por ejemplo, `ls`) y solo aplica a comandos sin operadores de shell (`;`, `&&`, `|`, `>`…). Las reglas se quitan desde Ajustes.
- **Memoria**: cada compañero guarda en su memoria preferencias, datos clave y resúmenes de lo que hizo. Desde la pestaña Memoria se ve y se corrige.
- **Rutinas**: trabajo que se ejecuta solo cada N minutos, todos los días o una vez por semana. Se crean desde la pestaña Rutinas o pidiéndolo en el chat ("todos los lunes a las 9…"). Se pueden ejecutar a mano y guardan las últimas 20 ejecuciones. Hasta 50 por compañero.
- **Habilidades**: procedimientos guardados que cualquier compañero puede seguir y que una rutina puede usar. Se editan en Ajustes o se guardan desde el chat.
- Contexto largo: cuando la conversación crece, la API resume lo viejo automáticamente.

## Configuración

| Variable | Default | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Obligatoria |
| `BOTS_PUERTO` | `3001` | Puerto |
| `BOTS_HOST` | `127.0.0.1` | Dirección donde escucha. Ver Seguridad antes de cambiarla |
| `BOTS_DATOS` | `~/compas` | Carpeta con los datos, las memorias y la computadora |
| `BOTS_MODELO` | `claude-opus-5-5` | Modelo de Claude |
| `BOTS_ESFUERZO` | `medium` | `low` es más rápido y barato; `high` hace trabajos más cuidados |

Las peticiones activan el fallback del lado del servidor: si el modelo rechaza un pedido, la API reintenta automáticamente con otro modelo.

## Seguridad

Los compañeros ejecutan comandos **en esta máquina**, con tu usuario. La terminal no está aislada: un comando puede leer o modificar cualquier cosa a la que tengas acceso. Por eso:

- Todo comando y toda escritura de archivos pide aprobación hasta que digas lo contrario. Leé lo que aprobás.
- Las herramientas de archivos sí están confinadas a la carpeta de la computadora.
- Las credenciales `ANTHROPIC_*` no llegan a la terminal de los bots.
- El servidor solo atiende desde esta máquina (`127.0.0.1`), rechaza pedidos de otros sitios y verifica el `Host` para evitar DNS rebinding. Si cambiás `BOTS_HOST` para usarlo desde el celular, cualquiera en esa red puede hablar con los bots y aprobar comandos: hacelo solo en una red de confianza.
- Para aislarlo de verdad, corré Compas dentro de un contenedor o una máquina virtual.

## Datos

En `BOTS_DATOS`:

- `estado.json`: compañeros, rutinas, habilidades y reglas.
- `conversaciones/<id>.json`: el historial de cada compañero.
- `memoria/<id>/memories/`: la memoria de cada compañero.
- `computadora/`: la carpeta compartida.

## Estructura

- `src/servidor.ts`: servidor HTTP, API y eventos en vivo (SSE).
- `src/agente.ts`: el bucle de cada compañero con Claude, la cola de mensajes y las aprobaciones.
- `src/herramientas.ts`: herramientas de los bots (terminal, archivos y memoria del SDK de Anthropic, más rutinas y habilidades) y qué requiere aprobación.
- `src/rutinas.ts`: horarios y el programador.
- `src/vista.ts`: convierte el historial en lo que muestra el chat.
- `src/almacen.ts`: persistencia en archivos JSON.
- `public/index.html`: la interfaz.

`npm run check` corre el chequeo de tipos.

## Lo que todavía no tiene

Comparado con el original: escritorio gráfico con navegador controlable ("tomar el control"), chats grupales, plugins (Gmail, Slack, Notion), email propio, voz, adjuntos y apps nativas. La lista completa está en `../replica/features.csv`.
