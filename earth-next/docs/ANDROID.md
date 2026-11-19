# App Android (APK)

EARTH NEXT se empaqueta como app nativa de Android con [Capacitor 8](https://capacitorjs.com): la misma aplicación web corre dentro del WebView del sistema (Chromium, WebGL 2) con acceso a funciones nativas.

## Instalar el APK

1. Copiá `EARTH-NEXT-0.2.0.apk` al teléfono.
2. Abrilo y permití "Instalar apps de origen desconocido" para el gestor de archivos o el navegador.
3. Requisitos: Android 7.0 o superior (API 24) con OpenGL ES 3 / WebGL 2 (prácticamente todos los equipos desde 2017). Se recomienda Android System WebView / Chrome actualizado.

## Qué cambia respecto de la versión web

| Función | En Android |
|---|---|
| Capturas, videos, GeoJSON/KML/KMZ, CSV | Se guardan y se abre el menú **Compartir** (Galería, Drive, WhatsApp, Archivos…) |
| Narrador de recorridos y asistente | Voz nativa del sistema (Text-to-Speech) |
| Botón "atrás" | Cierra, en orden: calle, herramienta activa, recorrido, información, asistente, panel; si no hay nada abierto, minimiza la app |
| Estaciones METAR | Consulta directa a NOAA (sin proxy: la app nativa no tiene restricción CORS) |
| Mi ubicación | Permiso de ubicación de Android, pedido sólo al tocar el botón |
| Pantallas con muesca / barras del sistema | Respeta las áreas seguras (`--safe-area-inset-*`) |
| Calidad gráfica | Detecta la GPU: gama alta (Adreno 7xx, Mali-G7x+, Immortalis) arranca en "Alta"; el resto en "Media" o "Baja", y se ajusta según los FPS |
| Asistente con IA | Requiere un servidor de EARTH NEXT (Ajustes → "Servidor de EARTH NEXT"); sin servidor funciona el **modo básico**. La clave de Anthropic nunca se incluye en el APK |
| Dictado por voz | No disponible en el WebView de Android (el botón de micrófono se oculta) |
| Service worker | Desactivado: los archivos de la app ya están en el dispositivo; las teselas usan la caché del WebView e IndexedDB |

## Compilar

Requisitos: Node 22.18+, JDK 21 y Android SDK (plataforma 36, build-tools 35/36).

```bash
cd earth-next
npm install
npm run android:assets     # íconos y pantallas de inicio (opcional, ya están generados)
npm run android:build      # build web + sincronización + APK release
```

El APK queda en `android/app/build/outputs/apk/release/app-release.apk`.

### Firma

La versión release se firma con los datos de `android/keystore.properties` (no se versiona):

```properties
storeFile=earthnext-release.jks
storePassword=…
keyAlias=earthnext
keyPassword=…
```

Para generar una clave nueva:

```bash
keytool -genkeypair -keystore android/earthnext-release.jks -alias earthnext -keyalg RSA -keysize 4096 -validity 10000
```

Guardá el `.jks` y sus contraseñas: Android sólo instala actualizaciones firmadas con la misma clave. Sin `keystore.properties` se genera un APK release sin firmar (o usá `./gradlew assembleDebug` para uno de depuración).

### Servidor para la IA en el teléfono

```bash
ANTHROPIC_API_KEY=… CORS_ORIGINS=https://localhost,capacitor://localhost npm start
```

Luego, en la app: Ajustes → "Servidor de EARTH NEXT" → `https://tu-servidor` (debe ser HTTPS).
