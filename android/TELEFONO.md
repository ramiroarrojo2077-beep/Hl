# Gravity Phone: contrato del puente `GravityTelefono`

`TelefonoPuente.kt` se expone a la página como `window.GravityTelefono`. Cada método recibe primero el
token de la página: la app lo inyecta solo en el marco principal (`window.__gravityTelefono`) cuando la
página es la del motor local (`http://127.0.0.1:38471`), y avisa con el evento `gravity-telefono`. Las
vistas de proyectos (`/vista/...`) van en iframes aislados y no pueden leerlo. Los resultados vuelven con
`window.gravityTelefono.evento(json)`.

| Método | Qué hace | Evento |
|---|---|---|
| `info(t)` | JSON con batería, memoria, almacenamiento, estado térmico, red/CPU/espacio de Gravity, permisos y carpetas | (devuelve el JSON) |
| `accion(t, nombre, json)` | `linterna {prender}`, `vibrar {ms}`, `temporizador {segundos, mensaje}`, `alarma {hora, minutos, mensaje}`, `volumen {subir}`, `compartir {texto}`, `camara`, `ajuste {cual}` (lista fija) | `accion {nombre, ok, error}` |
| `elegirCarpeta(t)` / `soltarCarpeta(t, uri)` | Selector de carpetas del sistema (SAF) con permiso persistente / quitarlo | `carpetas {carpetas}` |
| `buscar(t, carpeta, consulta, id)` | Busca por nombre o tipo (hasta 20 000 archivos, 300 resultados) | `resultados {id, items}` |
| `analizar(t, carpeta, id)` | 30 más grandes y duplicados (mismo tamaño y SHA-256) | `analisis {id, total, bytes, grandes, duplicados}` |
| `copiarAGravity(t, uri, id)` | Copia a `computadora/compartidos/` (hasta 500 MB) | `copiado {id, ruta, bytes}` |
| `borrar(t, uri, id)` | Borra (la página confirma antes) | `borrado {id, uri, ok}` |
| `abrirArchivo(t, uri, mime)` | Abre con la app que corresponda | — |

Permisos nuevos (normales, sin diálogo): `VIBRATE` y `SET_ALARM`. No se usa el servicio de accesibilidad.
Las notificaciones para el resumen las manda `Escucha.kt` a `POST /api/telefono/notificaciones`, solo de las
apps que el usuario autoriza en Gravity (lista que lee de `GET /api/mensajeria/estado` → `resumir`).
