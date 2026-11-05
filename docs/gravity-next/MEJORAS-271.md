# Gravity NEXT · Estado de las funciones 171–271

✅ hecho y probado · 🟡 parcial (qué falta) · ⛔ falta · 🧪 experimental (se marca así también en la app). Estado al 5/11/2026.
Las de la lista 1–170 siguen en `MEJORAS-170.md`; detalles técnicos en `PENDIENTE.md`.

## 16. Inteligencia multiagente
171. ✅ Mentores: Perfil > Mentor. Cuando el aprendiz termina una tarea, el mentor la recibe para revisarla y le manda una devolución con la herramienta `ensenar`; el aprendiz la guarda en sus lecciones. Respeta el tope de gasto del mentor (`talento.ts`).
172. ✅ Jerarquías: managers que reportan a managers (directores), managers (supervisores) y miembros (especialistas y asistentes), hasta varios niveles.
173. ✅ Equipos temporales: Architect y la herramienta `equipo_nuevo` crean equipos con especialistas temporales que se archivan al terminar.
174. ✅ Delegación inteligente: el manager puede delegar a «auto» y Gravity elige según afinidad con el encargo (puesto y descripción), carga abierta, confianza y tope de gasto; el motivo queda en el resultado.
175. ✅ Agentes de respaldo (Ajustes > Agentes de respaldo, apagado de fábrica): si una tarea falla o se vence, otro miembro del equipo la retoma una vez con el mismo presupuesto y se avisa al manager.
176. ✅ Confianza: puntaje 0–100 con los resultados reales (tareas del equipo y de proyectos), visible en el Perfil y en Operaciones; se usa para delegar.
177. ⛔ Competencia de soluciones (hoy: Laboratorio compara modelos y personalidades, no agentes con tareas).
178. ✅ Colaboración simultánea: proyectos con tareas en paralelo y dependencias; los equipos trabajan a la vez.
179. 🟡 Conflictos: la auditoría detecta cuando dos compañeros cambian el mismo archivo con menos de 30 min de diferencia (posible pisada) y lleva a las versiones. Falta detectar decisiones contradictorias en texto.
180. ✅ Biblioteca de estrategias: habilidades guardadas + mercado de habilidades + lecciones por compañero.

## 17. Gravity Universe 3D
181. ✅ Centro de operaciones 3D (`#/universo`). 184. ✅ Animaciones de trabajo (teclean, levantan la mano al esperar). 186. ✅ Cámara libre (arrastrar, pellizcar, rueda). 188. ✅ Hologramas con información real.
182. 🟡 Personalización por dispositivo: escenario, color de acento e intensidad de la luz (se guardan en el celular). Falta mover muebles a mano.
183. ✅ Robots que caminan: cuando un manager reparte una tarea, su robot va hasta la estación de quien la recibe y vuelve; los que entran a una reunión caminan a la sala del centro y se quedan mirando la mesa hasta que termina.
185. 🟡 Salas: sala de reuniones en el centro (mesa holográfica) y ambientaciones de laboratorio (tubos de ensayo) y biblioteca (estantes con libros). Falta separar oficinas por equipo.
187. ✅ Eventos visuales: festejo con salto, brazos arriba y partículas cuando un compañero completa una tarea; columna de luz naranja mientras espera tu aprobación.
189. ✅ Modo observador: tocá una estación (o elegí en «Observar») y la cámara lo sigue de cerca, con un panel de lo que hace, su carga, su confianza y sus últimas tareas, y accesos a su chat y a Aprobar.
190. ✅ Escenarios: estación espacial (estrellas, planeta con anillo), laboratorio futurista y oficina con biblioteca.

## 18. Robots 3D
191–200. 🟡 El robot de las llamadas ya tiene gestos (saludo, asentir), ojos LED con expresión, levitación y personalidad; falta el resto.

## 19. Creative Studio (201–210) · 20. Investigación (211–220) · 21. Asistente personal (221–230)
Ver detalle en la próxima actualización. Ya existen: búsqueda y lectura web (211 🟡), correo con aprobación (224 ✅), recordatorios (225 ✅), calendario por Microsoft 365 (221 🟡).

## 22. Data Lab (231–240)
⛔ (en curso).

## 23. Developer Pro (241–250)
241. ✅ Terminal de desarrollo con entorno aislado (Gravity Code y `probar_aislado`). 248. 🟡 Comparador de versiones de archivos (sin commits de Git). El resto, ver Gravity Code.

## 24. Comunicación (251–260)
252. ✅ Mensajes internos estructurados (delegar, tareas, resultados). 254. ✅ Archivos compartidos con versiones. 256. ✅ Bandeja de aprobaciones. 255, 259, 260. 🟡 (reuniones programadas, actas, novedades). 251, 253, 257, 258. ⛔

## 25. Experimentales
261. ✅ Simulador de decisiones (Laboratorio). 262. 🟡 Mapa de proyectos y dependencias. 266. ✅ Recomendaciones (sugerencias de la auditoría). 268. ✅ Laboratorio. 269. 🟡 Centro de operaciones. 263, 264, 265, 267, 270. ⛔/🟡

## 271. Gravity Code
✅ Hecho y probado (`#/code`, `bots/src/codigo.ts`):
- Proyectos en `codigo/` de la computadora: plantillas (vacío, web, Node, Python) e importación de repositorios de GitHub (públicos, o privados con la conexión de GitHub).
- Editor profesional (CodeMirror 6 empaquetado en la app, sin internet): resaltado para JS/TS, HTML, CSS, Python, JSON, Markdown, Java, Kotlin, C/C++, C#, Dart, Go, Rust, SQL, XML, YAML y shell; autocompletado de palabras y del lenguaje; buscar y reemplazar; pestañas con marca de «sin guardar»; no pisa cambios de un compañero.
- Explorador de archivos con carpetas, archivo y carpeta nuevos.
- Buscar y reemplazar en todo el proyecto (texto o expresión regular), guardando la versión anterior de cada archivo.
- Comparar cambios (lado a lado, o unificado en el celular) contra lo guardado o la última versión; historial de versiones y restaurar.
- Terminal del proyecto: comandos reales en la carpeta o en una copia aislada (sin claves, sin red donde se puede), con estado (corriendo/OK/error/cortado), código de salida, salida real y botón Detener.
- Vista previa de páginas HTML (marco aislado). Exportar el proyecto a .zip.
- Memoria técnica por proyecto (`.gravity/memoria.md`): arquitectura, dependencias, decisiones, convenciones, errores y soluciones, pendientes e historial. Los compañeros la leen y la actualizan.
- Compañeros en el proyecto con modos Chat, Editor, Agente, Equipo, Autónomo supervisado y Reparación (desde un comando que falló: «Reparar con un compañero»), selector de modelo, y «Equipo de desarrollo» (coordinador, arquitecto, programador, diseñador, tester, debugger y revisor) de un toque.

🟡 Falta: operaciones de Git (commit, ramas, push) dentro de la app; autocompletado con IA en el editor; compilar Android y emuladores (necesitan Gravity Code Cloud, un servidor remoto); el robot 3D como asistente dentro del editor.
