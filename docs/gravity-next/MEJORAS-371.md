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
281. 🟡 Build Center: «Compilar y correr» detecta los comandos del proyecto (scripts de npm, Gradle, Python, Make) y los corre en la terminal. Compilar en servidores remotos: ver 352–361.
