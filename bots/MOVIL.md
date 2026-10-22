# Gravity en el celular (todo en uno)

La app de Android trae **Gravity entero adentro**: el motor (Node.js 24 para Android), tus compañeros, sus conversaciones y su compu. No hace falta ninguna compu ni servidor; el celular es la compu.

## Instalarla

1. Abrí en el celu la release **[apk-latest](https://github.com/ramiroarrojo2077-beep/Hl/releases/tag/apk-latest)** del repo y tocá **gravity.apk**.
2. Abrila. Si Android lo pide, permití **Instalar apps desconocidas** para tu navegador.
3. Si aparece Play Protect: **Más detalles > Instalar de todos modos** (la app no está en Google Play).
4. Abrí Gravity y elegí el modelo:
   - **Gemini · gratis** (recomendado si no querés pagar): sacá la clave gratis en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con tu cuenta de Google, sin tarjeta. Opcional: una clave gratis de [Groq](https://console.groq.com/keys) (sin tarjeta; entrás con Google) como **respaldo**, para que sigan trabajando cuando se acabe el cupo diario de Gemini. También acepta una clave de Mistral.
   - **Claude**: el más capaz, se paga por uso con tu clave de [Anthropic](https://console.anthropic.com/settings/keys).
5. Permití las **notificaciones** y, cuando lo pregunte, dejá a Gravity **sin restricciones de batería**.

Requisitos: Android 8 o más nuevo, celular de 64 bits (arm64; casi todos desde 2017). La APK pesa unos 30 MB.

## Modelos gratis: qué cambia

- **Gemini** (Google): Flash es el principal y, cuando se agota su cupo del día, sigue con Flash-Lite (cupo aparte).
- **Respaldo** (Groq, opcional): clave gratis sin tarjeta. Usa GPT-OSS 120B y, si no alcanza su cupo, Llama 4 Scout, Llama 3.3 70B, Qwen3 32B y GPT-OSS 20B (cada uno tiene su cupo). Si en vez de Groq pegás una clave de Mistral, usa Mistral Large, Medium y Small.
- Las búsquedas en la web se hacen con Google a través de Gemini, y los compañeros pueden leer páginas públicas.
- No hay gasto en dólares: el contador de Ajustes queda en 0.
- Con modelos gratis los compañeros son menos finos que con Claude, sobre todo en tareas largas con muchas herramientas.

## Cómo trabaja en segundo plano

- El motor corre como **servicio en primer plano**: vas a ver una notificación fija "Gravity está prendido" con lo que están haciendo (por ejemplo, "Trabajando: 3 compañeros"). Cerrar la app o tocar Atrás **no** lo apaga.
- Mientras hay trabajo en marcha (bots trabajando, tareas del equipo, reuniones) mantiene la CPU despierta aunque apagues la pantalla. Cuando no hay nada, deja dormir al celular y programa una **alarma** para despertarse un poco antes de la próxima rutina.
- Si un compañero necesita tu aprobación y no estás mirando la app, te llega una notificación.
- Al **reiniciar el celular** o **actualizar la app**, el motor se vuelve a prender solo.
- Para apagarlo: botón flotante de Gravity > **Apagar Gravity**, o **Apagar** en la notificación. Así no vuelve a prenderse hasta que abras la app.

Para que las rutinas corran exactamente a horario, en Android 13 o más nuevo activá además *Ajustes > Apps > Gravity > Alarmas y recordatorios*. Sin eso corren igual, con unos minutos de diferencia.

Algunas marcas (Xiaomi, Huawei, Samsung con "apps en suspensión") cierran apps en segundo plano por su cuenta. Si notás que Gravity se apaga solo, buscá Gravity en los ajustes de batería del celular y sacalo de cualquier lista de optimización o suspensión.

## Dónde quedan tus cosas

- Conversaciones, memoria, rutinas, equipos, conexiones y la compu de los bots: en el almacenamiento privado de la app (`files/gravity`). Ninguna otra app puede leerlo y no se sube a ningún lado.
- Las claves (Gemini, Groq, Mistral o Anthropic): cifradas con el **Android Keystore**, fuera de las copias de seguridad.
- Actualizar la app (instalar la APK nueva encima) **no borra nada**. Desinstalarla sí borra todo.

## La compu de los bots en el celular

Los bots tienen una terminal con los comandos de Android (`ls`, `cat`, `grep`, `sed`, `find`…, el `sh` del sistema). No hay `bash`, `python`, `git` ni `curl`: para buscar en internet y leer páginas usan las herramientas web de la API, y para archivos usan su editor. Android no deja ejecutar programas descargados.

## Seguridad

- El motor escucha solo en `127.0.0.1` dentro del celular: desde otro dispositivo no se llega.
- Además, cada pedido tiene que traer un token secreto que solo conoce la app; así ninguna otra app del celular puede usar el puerto local.
- La APK debug se firma con una firma fija que está en el repo (`android/firma/`), para que cada versión nueva se instale encima sin perder datos. Como es pública, instalá Gravity solo desde la release de tu repo. Para una firma propia, cargá en el repo los secretos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`; la CI arma entonces la APK release con esa clave (cambiar de firma pide desinstalar una vez).

## Si algo falla

- **"El motor no arrancó"**: la pantalla muestra las últimas líneas del registro. Probá **Reiniciar el motor**; si dice algo de autenticación, revisá la clave (**Cambiar la clave**).
- **Los bots responden con error de autenticación**: la clave está mal o se venció. Botón flotante > **Modelo y claves**.
- **"Sin cupo"**: con Gemini gratis hay un límite de pedidos por minuto y por día. Gravity pasa solo de Gemini Flash a Flash-Lite y después al respaldo de Groq (si cargaste su clave); cuando todo está sin cupo, espera y sigue solo. Con muchos compañeros a la vez el cupo gratis se gasta rápido.
- **No corre con la pantalla apagada**: botón flotante > **Trabajar con la pantalla apagada** (aparece mientras falte el permiso de batería).

## Compilarla vos

La CI (`.github/workflows/android.yml`) la arma sola con cada cambio. A mano:

```bash
android/preparar.sh          # baja Node.js para Android y empaqueta el motor
cd android && gradle :app:assembleDebug
```

Pide JDK 17+, el SDK de Android con la NDK 27.3.13750724 y Node 22+.

## ¿Y en la compu?

Gravity sigue andando en la compu como siempre (`npm run gravity`, ver `bots/README.md`), y desde Chrome se puede instalar como app (PWA) si lo servís por `https://`. Son instalaciones separadas: la del celular no comparte datos con la de la compu.
