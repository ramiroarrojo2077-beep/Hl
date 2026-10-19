# Órbita 0.2 — motor de bots y cliente Android

Versión corregida y adaptada para generar APK con Capacitor. Incluye conexión autenticada, diagnóstico del modelo, recuperación de sesión, teclado móvil, botón Atrás y exportación nativa de archivos.

**La APK es el cliente. El motor Node/SQLite y las herramientas se ejecutan en un PC o servidor.** Node, Ollama y Docker no se ejecutan dentro del APK.

## Arrancar el motor

Instala **Node.js 24 o superior**, descomprime el proyecto y abre una terminal en su carpeta:

```sh
npm start
```

No necesitas instalar dependencias para arrancar el motor. Abre `http://localhost:3000` en ese mismo equipo. No abras `public/index.html` haciendo doble clic.

Copia `.env.example` a `.env`: `Copy-Item .env.example .env` en PowerShell o `cp .env.example .env` en macOS/Linux. Para cambiar el puerto edita `PORT`; reinicia después de cualquier cambio.

Para responder, el motor necesita un modelo:

- **Ollama local:** instala y abre [Ollama](https://ollama.com/download), ejecuta `ollama pull qwen3:8b` y conserva `MODEL_PROVIDER=ollama` y `OLLAMA_MODEL=qwen3:8b` en `.env`.
- **xAI:** configura `MODEL_PROVIDER=xai`, `XAI_API_KEY` y un `XAI_MODEL` disponible en tu cuenta. La API puede cobrar por uso. La clave permanece en el servidor.

La interfaz indica si el proveedor está apagado o falta el modelo. No hay respuestas demo.

## Conectar la APK

Genera una clave aleatoria en tu terminal:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Configura el `.env` del motor:

```dotenv
HOST=0.0.0.0
PORT=3000
ORBITA_ACCESS_TOKEN=pega_aqui_la_clave_aleatoria_generada
ALLOWED_HOSTS=bots.tudominio.com
APP_ORIGINS=https://localhost,capacitor://localhost
```

Para producción usa una URL HTTPS que llegue al motor mediante un proxy con certificado válido. Conserva el Host original en el proxy y añade ese host exacto a `ALLOWED_HOSTS`. Esta entrega no incluye un dominio ni hosting.

En la APK introduce la URL del servidor y la clave `ORBITA_ACCESS_TOKEN`. **No es la clave de xAI.** La dirección se recuerda y la clave se guarda solo durante la sesión del WebView. Si Android recrea la sesión, puede pedirla otra vez.

Para un APK **debug**, en una red de confianza, puedes marcar «Permitir HTTP de desarrollo»:

- Emulador Android: `http://10.0.2.2:3000`; añade `10.0.2.2:3000` a `ALLOWED_HOSTS`.
- Teléfono y PC en la misma Wi-Fi: usa la IP del PC, por ejemplo `http://192.168.1.20:3000`; añade `192.168.1.20:3000` a `ALLOWED_HOSTS` y permite ese puerto en el firewall.

`localhost` en el teléfono apunta al teléfono. HTTP no cifra la clave: úsalo solo para desarrollo en una red de confianza. El build **release exige HTTPS**.

## Generar APK

Instala Android Studio con su JDK/SDK compatibles con Capacitor 8. Desde la raíz del proyecto:

```sh
npm run mobile:install
npm run android:apk
```

Esto construye el cliente, genera y sincroniza el proyecto Android y ejecuta Gradle. Salida esperada:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Si prefieres Android Studio, después de instalar dependencias ejecuta `npm run android:prepare` y `npm run android:open`. Para distribuir un release, genera el APK firmado con tu clave desde Android Studio. No se incluye firma de producción ni publicación en tiendas.

Referencias: [entorno de Capacitor](https://capacitorjs.com/docs/getting-started/environment-setup) y [Android](https://capacitorjs.com/docs/android).

## Opcionales

```sh
# Cliente de escritorio
npm run desktop:install
npm run desktop

# Navegador de los bots
npm run browser:install
npm --prefix runtime exec -- playwright install chromium

# Terminal: requiere Docker iniciado
npm run computer:build
```

El navegador requiere `BROWSER_ALLOWED_HOSTS` en `.env`. El terminal usa un contenedor sin red y un volumen dedicado, separado de los adjuntos SQLite. Los archivos y skills son compartidos; la memoria y la conversación pertenecen a cada bot. Las aprobaciones se consumen una sola vez y caducan tras diez minutos.

Cerrar la APK no detiene tareas ni rutinas si el motor sigue encendido. Apagar/suspender el equipo del motor sí las detiene. No hay ordenador cloud administrado, voz, conectores OAuth, grupos ni marketplace.

## Verificación y límites

**23 pruebas aprobadas:** motor, persistencia, aprobaciones, rutinas, delegación, CORS, autenticación del cliente Android, URL, renovación de sesión, diagnóstico y configuración de arranque. También se comprobó la sintaxis de los módulos y scripts Android.

Las pruebas del protocolo móvil usan el cliente real y el manejador HTTP del motor en memoria, SQLite real y un proveedor de inferencia controlado. No equivalen a una prueba de Android WebView.

**Pendiente aquí:** socket HTTP real, inferencia real, Chromium, Electron, Docker y compilación/instalación APK. El sandbox bloqueó sockets y la instalación con permisos adicionales fue interrumpida. Se entrega el proyecto para compilar, no un APK ya generado ni validado en un dispositivo.

```sh
npm test
npm run check
```

El motor guarda datos en `data/`; escritorio usa el directorio de usuario de Electron. Haz backup con el proceso cerrado. No se incluyen claves, modelos ni datos privados en el ZIP.
