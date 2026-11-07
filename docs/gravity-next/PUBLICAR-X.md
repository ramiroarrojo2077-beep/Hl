# Publicar en X

Pantalla `#/x` (Más › Publicar en X), conexión «X (Twitter)» en Conexiones y motor en `bots/src/x.ts`.

- **Cómo se conecta:** con la API oficial de X y las claves de una app de desarrollador del usuario (developer.x.com, permisos «Read and write»): API Key, API Key Secret, Access Token y Access Token Secret. Se firma con OAuth 1.0a (verificado con el vector oficial de la documentación de X). Las claves se guardan cifradas (AES-256-GCM) y nunca salen en la API de Gravity.
- **Costos y disponibilidad:** el plan gratuito de la API de X permite publicar con un límite mensual; X puede cambiar planes y precios. Los errores de X se explican en castellano (claves, permisos, límite con la hora en que se libera, sin crédito).
- **Publicar:** contador como el de X (enlaces 23, emojis y CJK 2), hilo automático si pasa de 280 (corta por párrafos, oraciones y palabras y numera 1/N), hasta 4 imágenes (PNG, JPG, WEBP, GIF, 5 MB) de la computadora o subidas, en la primera publicación. Siempre se confirma antes de publicar. Si una parte de un hilo falla, avisa qué partes salieron.
- **Programar:** fecha y hora; sale sola si Gravity está prendido (se revisa cada 30 s). Se puede cancelar. Si Gravity se corta mientras publicaba, no reintenta sola (para no duplicar) y queda marcada para revisar.
- **Historial:** lo publicado desde Gravity (por vos, programado o por un compañero) con enlaces a X; borrar pide confirmación.
- **Compañeros:** acciones `publicar` y `borrar` (de escritura: piden tu aprobación y solo para compañeros con «Puede enviar mensajes afuera») y `mis_publicaciones` (lectura, con métricas).
- **Pruebas:** `bots/pruebas/x.test.mjs` (7) y e2e en el navegador contra una API de X local. Este entorno no tiene salida a internet: falta probar contra la API real con una cuenta.
