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
