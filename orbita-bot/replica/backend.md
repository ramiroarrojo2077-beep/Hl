# Backend y verificación

Motor Node 24, SQLite, servidor de loopback y herramientas propias. Integraciones oficiales: xAI Responses API y Ollama Chat API. Esquema en `schema.sql`.

Verificado mediante 16 pruebas: persistencia, contexto de bots, creación de archivos tras aprobación, rechazo, expiración, cancelación, exclusión por bot, rutinas sin duplicados, delegación, recuperación conservadora, validación de HTTP y formato de los adaptadores.

El transporte HTTP en los tests usa el manejador real con streams en memoria. No se ha verificado un socket HTTP, una inferencia remota/local real, Docker, Chromium o Electron en este entorno.

Autenticación: solo proceso local, filtro Host/Origin y token CSRF aleatorio; no es autenticación multiusuario. La API no debe exponerse públicamente. El acceso de otros procesos del mismo usuario no es una frontera de seguridad. Datos en SQLite sin cifrado de aplicación.

La aplicación no tiene pagos, correo ni conectores OAuth. No se incluyen claves ni se configura ninguna cuenta externa. `.env.example` contiene únicamente valores de ejemplo.
