# Gravity NEXT · Estado de las funciones 272–371

✅ hecho y probado · 🟡 parcial (qué falta) · ⛔ falta · 🧪 experimental. Estado al 6/11/2026.
Las anteriores: `MEJORAS-170.md` y `MEJORAS-271.md`. Detalles técnicos: `PENDIENTE.md`.

## 26. Gravity Code 2.0 (`#/code`)
272. ✅ Swarm: equipo de programación de 3 a 60 agentes que trabajan a la vez en módulos distintos (panel «Equipo», `equipo-codigo.ts`).
273. ✅ Vision: «Desde una captura» en el chat del proyecto; la imagen queda en `.gravity/capturas/` y el compañero propone el código para reproducir o mejorar el diseño.
274. ✅ Repair: modo «Reparación», «Reparar con un compañero» desde un comando que falló y errores con enlace a archivo y línea.
275. ✅ Architect: modo «Arquitectura» (módulos, carpetas, contratos y tareas; queda en ARQUITECTURA.md y la memoria técnica) + rol de arquitecto en el equipo.
276. ✅ Mobile IDE: la pantalla se reacomoda en el celular (Archivos / Editor / Paneles), editor táctil y comparación unificada.
277. ✅ Live Preview: panel «Vista» con la página del proyecto que se recarga sola cada vez que alguien guarda.
278. ✅ Refactor: modo «Refactor» (pruebas antes, cambios en pasos chicos, pruebas después de cada paso).
279. ✅ Test Lab: modo «Generar pruebas», terminal con estado real y copias aisladas.
280. ✅ Git Manager (`git.ts`, isomorphic-git: anda en el celular sin git instalado): iniciar, ver cambios y diferencias contra el último commit, commit, ramas, unir, historial, remoto de GitHub, traer, subir y pull requests (subir y PR los confirma el usuario; usa el token de la conexión de GitHub). Los agentes tienen la herramienta `git` (estado, commit, ramas, historial; sin subir).
281. ✅ Build Center: «Compilar y correr» detecta los comandos del proyecto (scripts de npm, Gradle, Python, Make) y los corre en la terminal local, o en otro Gravity vinculado desde `#/cloud` (sube el proyecto, compila allá y trae el resultado, por ejemplo el APK).

## 34. Gravity Cloud y servidores (`#/cloud`, `cloud.ts`)
Vincula otros Gravity (una PC, un servidor propio, una VM en la nube) por dirección + clave (`BOTS_CLAVE` del otro lado). Probado con dos Gravity reales (uno por la IP de red, con clave).
352. ✅ Cloud Manager: vincular (solo se guarda si la conexión y la clave funcionan; la clave queda cifrada AES-256-GCM), elegir, revisar y desvincular.
353. ✅ Monitor: revisión cada 10 minutos y a pedido; tiempo de respuesta, compañeros, trabajando, CPU, memoria, gasto del día, historial de las últimas 100 revisiones y disponibilidad en %.
354. ✅ Tareas remotas: sube el proyecto de Gravity Code (zip), corre el comando allá con su salida real en vivo y trae archivos de vuelta a `codigo/<proyecto>/remoto/`.
355. ✅ Sincronización cifrada: copia completa cifrada (scrypt + AES-256-GCM, con la clave del servidor) que viaja y queda cifrada allá; se trae y se descifra para restaurarla desde Ajustes.
356. ✅ Cola distribuida: «Repartir trabajos» manda una lista de comandos al servidor más libre que responda (menos compañeros trabajando y menos CPU), en ronda; si uno falla al recibir, el comando pasa al siguiente.
357. 🟡 Recursos: límite de memoria y de CPU por trabajo (`ulimit -v`/`-t`), local y remoto. Falta: límite de almacenamiento por trabajo.
358. ✅ Copias remotas: «Enviar copia ahora» y lista de copias guardadas allá. (El respaldo automático local sigue en Ajustes.)
359. 🟡 Despliegues: «Preparar despliegue» genera Dockerfile, .dockerignore y DESPLIEGUE.md; se puede compilar/correr en un servidor vinculado. Falta publicar en un proveedor (Render, Fly, etc.): es un servicio externo con costo y queda para cuando el usuario lo conecte y lo apruebe.
360. 🟡 Recuperación: el monitor detecta caídas y vuelve a iniciar sesión solo si el servidor reinició; las copias cifradas permiten restaurar. Falta: reintentar automáticamente los trabajos cortados por una caída.
361. ✅ Costos: tabla de gasto del día de este dispositivo y de cada servidor (uso de modelos pagos). El costo del hosting depende del proveedor y se aclara en pantalla.

Pruebas: `pruebas/cloud.test.mjs` (cifrado, sesión con reintento, clave mala, límite de CPU, cola distribuida con un servidor caído) y e2e en el navegador con dos Gravity.

## 33. Gravity Knowledge (`#/conocimiento`, `conocimiento.ts`)
Cada cuaderno es una carpeta real `conocimiento/<nombre>/` con sus documentos y un `.cuaderno.json` (notas, fichas, mapa, línea de tiempo, con quién se comparte). Lo que usa IA usa el modelo configurado (gratis o pago, se suma al gasto) y lo dice en pantalla.
342. ✅ Biblioteca universal: todos los documentos de la computadora (PDF, Word, ODT, PowerPoint, texto, CSV, JSON, HTML; sin código ni dependencias), en qué cuaderno están, y las fuentes web de Investigación; con búsqueda.
343. ✅ Cuadernos por tema: crear, subir documentos o agregarlos desde la computadora (se copian, el original queda), notas, búsqueda sin IA dentro del cuaderno, borrar.
344. ✅ Preguntas sobre documentos: busca los fragmentos más relevantes (puntaje tipo BM25, sin tildes) y la IA responde solo con eso.
345. ✅ Mapa conceptual: la IA propone conceptos y relaciones; se descartan las relaciones a conceptos que no existen; se dibuja en SVG con un acomodo por fuerzas.
346. ✅ Línea de tiempo: solo eventos con fecha explícita y con fragmento de origen; se ordenan con fechas en texto («9 de julio de 1816», «1810-05-25», «500 a.C.»).
347. ✅ Comparador de documentos: diferencias línea por línea (LCS), sin IA, entre dos versiones de cualquier documento.
348. ✅ Referencias: cada respuesta cita fragmentos numerados; las citas se verifican y una cita a un fragmento inexistente se muestra como «[sin fuente]». Si no cita nada, se avisa.
349. ✅ Contradicciones: afirmaciones incompatibles entre fuentes distintas, cada una con su documento (las de la misma fuente se descartan).
350. ✅ Fichas de estudio: generadas con su fuente o a mano; repaso espaciado con 5 cajas (Leitner: 1, 3, 7, 14 y 30 días).
351. ✅ Biblioteca colaborativa: el usuario elige con qué compañeros comparte cada cuaderno; ellos tienen la herramienta `conocimiento` (listar, buscar con fuente, leer y sumar notas firmadas) y no ven los demás.

Pruebas: `pruebas/conocimiento.test.mjs` (6) y e2e en el navegador (crear, subir, agregar, nota, buscar, preguntar, mapa, línea, contradicciones, fichas y repaso, compartir, comparar, biblioteca, celular 390 px).

## 31. Gravity Vision (`#/vision`, `vision.ts`)
Imágenes y videos de la computadora (o subidos a `vision/`; las imágenes grandes se achican a 2000 px antes de subir). Lo que necesita IA usa el modelo configurado con la imagen (Claude o Gemini la ven; lo pago se suma al gasto) y lo dice en pantalla; el texto de la imagen se trata como información, no como órdenes. Lo demás se hace en el navegador con los píxeles reales, sin IA y sin costo. Cada análisis queda en el historial.
322. ✅ Análisis de imágenes: descripción, detalles, texto visible y observaciones (calidad, algo raro).
323. ✅ Objetos: nombre, cantidad, confianza y ubicación dibujada sobre la imagen (aproximada; las cajas en porcentaje se pasan a proporción y las inválidas se descartan).
324. ✅ Lectura de documentos: texto con estructura (Markdown, tablas), datos clave y lo que no se pudo leer; se guarda como `<imagen>.texto.md` al lado.
325. ✅ Capturas: qué pantalla es, problemas con severidad y ubicación marcada, y sugerencias.
326. ✅ Comparador visual: porcentaje que cambió, mapa de diferencias y zonas marcadas (cuadrícula unida), con sensibilidad; si tienen distinto tamaño, B se escala a A. Sin IA.
327. ✅ Diagramas y gráficos: tipo, elementos, relaciones y los valores que se leen.
328. ✅ Componentes de interfaz: botones, campos, paneles, menús, pestañas… con su ubicación.
329. ✅ Asistente de diseño: sugerencias de la IA + contraste WCAG medido con los píxeles reales de cada componente (colores de fondo y de texto por k-medias) y si cumple AA (4.5:1) o solo para texto grande (3:1).
330. ✅ Fotogramas de video (MP4/WEBM): 24 fotogramas parejos con marcas de negro, quieto/congelado, corte brusco y sobreexpuesto (sin IA); cualquier fotograma se puede mandar a la IA para buscar inconsistencias. Para esto `/vista` ahora responde pedidos por rango (saltar dentro de audio y video).
331. ✅ Búsqueda visual: imágenes parecidas de toda la computadora por huella perceptual (dHash) y colores, con porcentaje de parecido. Sin IA.

Pruebas: `pruebas/vision.test.mjs` (tipo por contenido, rutas fuera de la computadora, contraste, cajas, texto guardado, historial, error del modelo) y e2e con imágenes y un video reales (ffmpeg): captura con contraste, documento, comparar, fotogramas, parecidas, historial y celular 390 px.

## 32. Gravity Audio Studio (`#/audio`, `audio.ts`)
Editar, limpiar y analizar se hace en el navegador con Web Audio (sin IA, sin costo, anda en el celular) y el resultado vuelve como WAV real a `audio/`; el original no se toca. Transcribir usa Gemini (gratis con su clave; sin ella se muestra el requisito y esa parte queda deshabilitada). Traducir usa el modelo configurado.
332. ✅ Editor: forma de onda con selección táctil, escuchar el tramo, dejar solo la selección, borrar, silenciar, fundidos de entrada y salida, normalizar, unir otro audio al final, deshacer (15 pasos) y guardar como WAV.
333. ✅ Limpieza de voz: filtro de graves (85 Hz) y agudos (9 kHz) y una compuerta con ataque rápido y liberación suave que baja el ruido entre frases y las respiraciones suaves; si el audio no tiene pausas claras, solo filtra (no destruye voz continua ni música). Muestra el ruido de fondo antes y después.
334. ✅ Transcripción: Gemini escucha el archivo (se reusa la subida de «analizar videos») y devuelve segmentos con tiempos; se ordenan, se corrigen solapamientos y se guardan `.transcripcion.md`.
335. 🟡 Hablantes: los separa Gemini al transcribir (se le puede decir cuántos son) y se renombran («Hablante 1» → «Ana») regenerando los archivos. Es la separación del modelo, no una diarización acústica propia.
336. ✅ Subtítulos `.srt` y `.vtt` sincronizados: bloques de hasta 2 líneas de 42 caracteres y 7 segundos, con el hablante.
337. ✅ Voces de compañeros: voz del dispositivo, velocidad y tono (los que usan las llamadas) y voz y estilo de Gemini para narrar; «Probar» y «Narrar con Gemini». El perfil del compañero conserva estos datos.
338. ✅ Grabador de reuniones: exige escribir los participantes y confirmar que todos aceptan; usa el micrófono con el permiso de Android; guarda en `audio/reuniones/` con el consentimiento registrado (el servidor rechaza una grabación de reunión sin consentimiento) y lleva directo a transcribir.
339. ✅ Traductor de voz: grabaciones (frase por frase con los mismos tiempos → `.<idioma>.srt/.vtt`) y conversación (hablás o escribís una frase, se traduce y se lee en voz alta en el otro idioma).
340. ✅ Análisis: forma de onda, espectrograma (FFT, hasta 8 kHz, 80 dB de rango), duración, frecuencia de muestreo, canales, pico, nivel medio, ruido de fondo, % de silencio, muestras saturadas y tono aproximado, con avisos.
341. ✅ Biblioteca de sonidos: todos los audios de la computadora con etiquetas, categoría (voz, reunión, música, efecto, ambiente), favoritos, nota, búsqueda y reproducción.

`/vista` responde pedidos por rango (para saltar dentro del audio). Pruebas: `pruebas/audio.test.mjs` (5: tipos, subtítulos, biblioteca, transcripción/hablantes/traducción con modelo simulado, consentimiento) y e2e con audios hechos con ffmpeg y micrófono simulado (editar y verificar con ffprobe, limpieza, análisis, requisito de Gemini, traducción de frase, grabación con consentimiento, voces, celular).

## 30. Gravity Browser (`#/navegador`, `navegador.ts`)
El motor trae las páginas (nunca de la red privada, hasta 5 redirecciones y 3 MB) y la app las arma solo con elementos permitidos: sin scripts, estilos, iframes ni formularios de la página; las imágenes pasan por `/api/navegador/imagen` y los enlaces navegan adentro. Lo que usa IA usa el modelo configurado; buscar, leer, extraer tablas y las fuentes académicas no usan IA.
312. ✅ Navegador: barra de dirección o búsqueda, atrás/adelante, enlaces internos, «Abrir afuera». La búsqueda usa DuckDuckGo (HTML, sin clave).
313. ✅ Asistente de lectura: resumen, tipo de página, minutos de lectura y puntos clave con el párrafo de donde sale cada uno (se descartan los que citan párrafos inexistentes).
314. ✅ Comparador de páginas (2 a 4): coincidencias y diferencias con lo que dice cada fuente (números de fuente verificados) y conclusión.
315. ✅ Extractor: tablas de la página a CSV sin IA, o campos a pedido con IA (por ejemplo «producto, precio») a `datos/*.csv` para Data Lab. Solo si robots.txt lo permite.
316. ✅ Marcadores por proyecto (los proyectos de Gravity), con etiquetas; también quedan como fuentes en Investigación; exportar referencias.
317. ✅ Fuentes académicas: Crossref, OpenAlex y arXiv a la vez (gratis, sin clave), sin repetidos (mismo DOI o título), ordenadas por citas, con PDF abierto cuando hay; si una falla, siguen las otras. Los compañeros tienen la herramienta `papers`.
318. ✅ Modo lectura: solo el contenido principal (sin menús, publicidad ni pie), letra serif ajustable y tiempo de lectura.
319. ✅ Traducción contextual: traduce bloque por bloque (títulos, párrafos, ítems, celdas) y, si un bloque tiene enlaces o formato, cada tramo de texto, así la página conserva su estructura y sus enlaces.
320. 🧪 Automatización de formularios: lista los formularios de la página con sus campos; antes de enviar muestra método, destino y cada valor y pide confirmación; nunca completa contraseñas, claves ni tarjetas; respeta robots.txt; el envío queda en el historial. Experimental: los sitios que dependen de JavaScript no funcionan.
321. ✅ Historial de investigación: visitas, envíos y extracciones con fecha y detalle, búsqueda, borrar y exportar como referencias Markdown a `investigacion/`.

Este entorno de desarrollo no tiene salida a internet: las pruebas usan un sitio local que imita páginas, robots.txt, el buscador y los formatos reales de Crossref, OpenAlex y arXiv (`pruebas/navegador.test.mjs`, 7, y e2e en el navegador con resultado verificado del lado del sitio). La variable `GRAVITY_PRUEBAS_RED_LOCAL` solo existe para esas pruebas.

## 35. Gravity Labs — experimental (`#/labs`, `labs.ts`) 🧪
Todo el bloque está marcado como experimental en la pantalla. Trabaja sobre los datos reales (proyectos, tareas, compañeros, automatizaciones, rutinas, habilidades, cuadernos, conexiones). Lo que propone la IA vuelve como propuesta editable y se crea con las rutas de siempre.
362. 🧪 Mission Control: misiones activas con progreso, salud, bloqueadas, vencidas, qué se está haciendo y quién; compañeros trabajando, aprobaciones y gasto; accesos al gemelo, al Doctor y al proyecto.
363. 🧪 Agent Arena: 2 a 4 compañeros resuelven el mismo desafío (con su personalidad, sin herramientas); un juez ciego (no ve nombres) puntúa con tus criterios; tabla acumulada de ganadas y promedio. Si uno falla, siguen los demás.
364. 🧪 Gemelo digital: el proyecto como grafo de tareas por dependencias, color por estado, bloqueadas y camino crítico (la cadena más larga sin terminar) en rojo. Sin IA.
365. 🧪 Simulation Lab: Monte Carlo con distribución PERT (mínimo, probable, máximo), dependencias reales y cantidad de personas en paralelo; P50/P80/P95, histograma y criticidad de cada tarea. Detecta ciclos y datos inválidos. Sin IA.
366. 🧪 Workflow Generator: describís en palabras → automatización (por evento) o rutina (por horario) con compañero, instrucciones y horario; avisa lo que no quedó claro; la revisás y se crea.
367. 🧪 Skills Builder: diseña la habilidad (instrucciones en pasos, cuándo usarla, ejemplo), la probás con un compañero y la guardás para todo el equipo.
368. 🧪 Quality Inspector: archivo de la computadora o texto; revisión automática sin IA (TODO, secciones vacías, enlaces rotos, palabras repetidas, oraciones larguísimas) + evaluación por criterios, problemas con sugerencias y veredicto.
369. 🧪 Project Doctor: salud 0–100 con hallazgos reales (fallidas, vencidas, sin responsable, quietas, sin criterio, sin coordinador, sin movimiento) y plan de recuperación con IA; elegís qué pasos se agregan como tareas (con responsable reconocido).
370. 🧪 Learning Center: 7 actividades prácticas que se marcan solas cuando las hacés de verdad (compañero, proyecto con tareas, rutina, habilidad, cuaderno con documento, proyecto de código, automatización).
371. 🧪 Nexus: grafo de todo lo conectado (compañeros, a quién reportan, proyectos que coordinan o donde trabajan, rutinas y sus habilidades, automatizaciones, cuadernos compartidos, conexiones) con búsqueda y acceso a cada cosa.

Pruebas: `pruebas/labs.test.mjs` (7) y e2e en el navegador con el modelo simulado (misión, gemelo, simulación, Doctor aplicando el plan, Arena, crear una automatización desde texto, probar y guardar una habilidad, inspección, aprendizaje, Nexus y celular).

## 28. Gravity Robot Lab (`#/robot`, `robotlab.ts`)
El mismo robot 3D de las llamadas (Three.js, materiales PBR, esqueleto con gestos animados, ojos LED, holograma y calidad adaptable) montado en un estudio. Nada es una imagen estática.
292. ✅ Editor: color de acento, color del cuerpo, material (plástico brillante, mate, metal, cerámica) y accesorio; se ve en vivo y se guarda en el compañero (llamadas y Universe usan lo mismo; el perfil conserva estos datos).
293. ✅ Biblioteca de movimientos por categoría: saludo, conversación, trabajo (estado nuevo «trabajando»: antebrazos al frente y dedos que teclean), descanso (estado nuevo «descansando» con respiración lenta y ojos tenues, y gesto nuevo «estirarse»), estados y expresiones.
294. ✅ Gestos inteligentes: escribís una frase y el robot la dice eligiendo gesto, expresión y holograma por el sentido (preguntas, cifras, pasos, «yo/vos», festejos) y el ritmo de la voz. Se corrigió que los pasos con tilde («después», «por último») no se detectaban.
295. ✅ Robot presentador: guion por partes (lo que dice, puntos para el holograma y gesto) a partir de un tema o de un texto; presenta con la voz del dispositivo, subtítulos, pausa y reanudar.
296. ✅ Robot profesor: el mismo guion en modo enseñar + preguntas de repaso al final, con reacción (pulgar/feliz o apenado), explicación y resultado.
297. ✅ Robot programador: «En vivo» refleja a un compañero real: teclea mientras trabaja (por ejemplo en Gravity Code), piensa al planificar o revisar, y el holograma muestra su acción.
298. ✅ Robot investigador: el panel holográmico muestra imágenes de la computadora o resultados; con un cuaderno, investiga en Gravity Knowledge y cuenta la respuesta con sus fuentes en el panel.
299. ✅ Robot multitarea: cada cambio de actividad tiene su animación (trabajar, pensar, esperar, festejar al terminar, descansar si está quieto, estirarse al volver) y queda un registro.
300. ✅ Iluminación: ajustes Estudio, Día, Atardecer, Neón y Noche, más luz principal, bordes, colores de borde y exposición, en vivo; se guarda por compañero.
301. ✅ Animación adaptable: 5 niveles (resolución, sombras y detalle del modelo) que bajan solos si no llega a ~50 cuadros por segundo; robot 2D si no hay WebGL2; «Medir 5 segundos» muestra fps, nivel y resolución.

Pruebas: `pruebas/robotlab.test.mjs` y e2e con WebGL por software (editor guardado, estados y gestos nuevos, frase, presentación + quiz, panel e investigación, luces guardadas, en vivo, medición, celular).

## 27. Gravity Game Studio (`#/juegos`, `juegos.ts`, `public/vendor/juego/motor.js`)
Cada juego es un proyecto real de Gravity Code (`codigo/<nombre>/`) con `juego.json`, el motor de Gravity y un `index.html`. El motor es propio y sin dependencias: la misma lógica corre en el navegador (canvas 2D o Three.js en 3D) y en Node para el probador.
282. ✅ Generador: describís el juego y el modelo arma mapa, personajes con IA, ítems, físicas, historia e interfaz; se valida con el esquema, se prueba y, si falla, se le pide que corrija con los errores (un reintento). Sin descripción, arranca de un ejemplo jugable. Plataformas o aventura (vista de arriba), en 2D o 3D.
283. ✅ Editor de escenarios: pintás el mapa tocando o arrastrando (aire, sólido, plataforma, bloque, pinchos, agua, moneda, meta, inicio, puerta), agregás o quitás filas y columnas, y ubicás personajes.
284. ✅ Diseñador de personajes: nombre, rol (jugador, NPC, enemigo), forma (bloque, blob, robot, caballero), color, velocidad, salto, vida y diálogo.
285. ✅ Historia: sinopsis, misiones (recolectar, llegar, hablar, derrotar) y diálogos generados con IA usando solo los personajes e ítems que existen (descarta las misiones que no se pueden cumplir y sugiere personajes nuevos aparte); también editable a mano. Queda en `HISTORIA.md`.
286. ✅ IA de NPC: quieto, patrullar (sin tirarse de los bordes), perseguir y huir con rango, y camino por puntos.
287. ✅ Animaciones: caminar (ritmo y rebote de piernas) y salto (estirar y aplastar) por personaje, en 2D y en 3D.
288. ✅ Físicas: gravedad, fricción, rebote y caída máxima; colisiones por tile eje por eje; en plataformas, caerle encima a un enemigo lo derrota y caer por un pozo hace perder.
289. ✅ Interfaz del juego: menú de inicio, HUD (vida, puntos, misiones), pausa con reiniciar, inventario, configuración (volumen, guardada en el dispositivo), diálogos, pantalla final y controles táctiles en el celular.
290. ✅ Probador: valida los datos (inicio único, personajes e ítems referidos, misiones posibles), calcula si la meta y los ítems son alcanzables con ese salto y esa gravedad (sin atravesar paredes) y juega 4 partidas con el motor real buscando errores, valores inválidos o atascos. Sin IA.
291. ✅ Exportador: HTML único (se abre sin servidor ni internet, 2D), .zip web (2D y 3D) y mapa en formato Tiled (.tmj), que abren Tiled y los importadores de Godot, Unity, Phaser y Defold.

La vista aislada (`/vista`) ahora permite que los módulos JS del proyecto se carguen con `import` (CORS solo para .js/.mjs). Pruebas: `pruebas/juegos.test.mjs` (7: motor, IA de NPC, pozos, probador con errores reales, guardar y exportar, generar con reintento) y e2e (jugar con teclado dentro de la vista, editar mapa arrastrando, IA de un personaje, historia, probador, exportar y abrir el HTML único, juego 3D con WebGL, celular).

## 29. Gravity Phone (`#/telefono`, `telefono.ts`, `android/.../TelefonoPuente.kt`, contrato en `android/TELEFONO.md`)
Todo con APIs y permisos normales de Android (sin servicio de accesibilidad ni permisos especiales). El puente nativo exige un token que solo recibe la página principal: las vistas de proyectos no pueden usarlo. En el navegador (sin la app) lo nativo aparece marcado como «solo en la app de Android».
302. ✅ Panel de acciones: linterna, vibrar, volumen, cámara, temporizador y alarma (los pone la app de reloj, que deja revisarlos) y compartir texto. Nada se hace sin tocarlo.
303. ✅ Asistente de notificaciones: el usuario autoriza app por app; `Escucha.kt` manda solo título y texto de esas apps; se guardan 72 h, agrupadas, y se resumen con IA marcando las que necesitan atención (tratadas como contenido de terceros). Quitar el permiso borra lo guardado.
304. ✅ Buscador de archivos en las carpetas que el usuario elige con el selector de Android (permiso persistente que se puede quitar): buscar, abrir y copiar a la computadora de Gravity.
305. ✅ Organizador de almacenamiento: los más grandes y los duplicados reales (mismo tamaño y mismo SHA-256); borrar pide confirmación.
306. ✅ Asistente de configuración: catálogo de 20 pantallas de Ajustes con explicación y búsqueda; la IA explica cómo hacer algo y sugiere solo pantallas que existen; se abren desde Gravity.
307. ✅ Accesibilidad: letra más grande y más contraste en toda la app; comandos por voz con permiso del micrófono («abrir chats», «leer pantalla», «volver», «buscar …») o escritos; acceso directo a TalkBack.
308. ✅ Rendimiento: memoria, almacenamiento, núcleos, estado térmico del sistema y CPU/memoria del motor, con diagnóstico y sugerencias.
309. 🟡 Batería: nivel, temperatura, consumo actual, ahorro y optimización; lo que usa Gravity (red, CPU de la pantalla, espacio) y sugerencias con la configuración real (rutinas muy frecuentes, robot en calidad alta). Android no da el % de batería por app sin permisos de sistema: se explica en pantalla.
310. ✅ Descargas de Gravity: lo recibido de otras apps, juegos exportados, investigaciones, datos, creativo, audio, vision, copias y lo traído de otros Gravity, por categoría; guardar en el teléfono o borrar (solo dentro de esa lista).
311. ✅ Centro de permisos: permisos de Android (micrófono, notificaciones, leer notificaciones, segundo plano, alarmas exactas) con acceso para darlos o quitarlos, carpetas permitidas (quitar), y los accesos de cada módulo de Gravity: herramientas apagadas por compañero, aprobación automática, conexiones, cuadernos compartidos, otros Gravity vinculados y apps del resumen.

Pruebas: `pruebas/telefono.test.mjs` (5) y e2e en el navegador con el puente nativo simulado con el mismo contrato (y sin él). El Kotlin lo compila el CI del APK; probarlo en un teléfono real queda pendiente (ver PENDIENTE.md).
