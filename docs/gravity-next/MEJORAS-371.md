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
