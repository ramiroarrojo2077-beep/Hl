# Errores y comprobaciones pendientes

## BUG-001 — Adjuntar podía enviar el formulario accidentalmente
- Severidad: S3.
- Detectado por revisión del HTML generado: un botón de icono sin `type` dentro de un formulario actúa como submit.
- Corrección: botones de icono declaran `type="button"`.
- Comprobación visual pendiente por restricciones de Chromium.

## BUG-002 — Un cuerpo JSON null generaba error de servidor
- Severidad: S3.
- Corrección: el parser exige un objeto JSON y rechaza arrays/null con HTTP 400.
- Regresión ejecutada en la prueba de validación de API.

## Por verificar
- Instalación y empaquetado de dependencias Electron y Playwright.
- Renderizado, accesibilidad y teclado en Chromium/Electron real.
- Funciones del ordenador con Docker y Playwright instalados.
- Respuesta y calidad de modelos reales, fallos de red y límites del proveedor.
- Múltiples ventanas del sistema operativo, sesiones largas y recuperación de disco lleno.

No se afirma ausencia de errores S1/S2 en las integraciones sin validar.
