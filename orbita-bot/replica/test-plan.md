# Plan y evidencia de pruebas

Fecha: 2026-10-19. Entorno: Linux, Node 24.19.0, sin dependencias adicionales para el motor.

## Ejecutadas

`npm run check`: sintaxis de servidor, cliente, runtime y entrada Electron.

`npm test`: 16 pruebas, proveedor controlado, transporte HTTP en memoria, SQLite real:

1. F01 — tarea, contexto y respuesta persistida.
2. F02 — escritura pendiente sin efecto; aprobar exactamente una vez.
3. F02 — rechazo y caducidad bloquean escritura.
4. F02 — detener cancela aprobación pendiente.
5. F01 — exclusión de trabajos simultáneos por bot.
6. F03 — memoria por bot y catálogo común de skills.
7. F04 — disparo único de rutina, actualización de fecha y pausa.
8. F05 — validación de archivos, límite y conservación tras borrar el bot.
9. F06 — delegación aprobada al especialista.
10. API — Host, Origin, CSRF, JSON y tamaño de cuerpo.
11. Herramientas — nombres y argumentos fuera de contrato.
12. Navegador — allowlist exacta y bloqueo de esquemas no autorizados.
13. Adaptador xAI — payload, store:false y tool results.
14. Adaptador Ollama — formato y error explícito sin simulación.
15. Reinicio — persistencia sin reejecutar efectos pendientes.
16. Inicio — recursos locales, CSP y configuración sin secretos.

## Preparadas y pendientes

`tests/ui_test.py`: creación de bot, conversación, aprobación, descarga, skills, rutinas, cancelación y móvil. Capturas previstas a 1440×900 y 390×844. El intento de arrancar Chromium falló con `setsockopt: Operation not permitted`; la solicitud adicional de permiso fue interrumpida. No existen capturas verificadas.

No ejecutado: Electron empaquetado y bandeja, inferencia xAI/Ollama real, ejecución Docker, navegación y captura reales del ordenador, auditoría de dependencias instaladas, lector de pantalla y pruebas en Windows/macOS.

No se han realizado pruebas sobre servidores del producto original.
