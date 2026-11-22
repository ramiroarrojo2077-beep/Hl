# Guía de permisos de Android — NEXUS 2.0

NEXUS usa solo APIs oficiales y pide cada permiso cuando hace falta, nunca al instalar "por las dudas".
No usa servicios de accesibilidad ni simula toques, y no lee la agenda completa.

| Permiso | Cuándo se pide | Para qué | Si lo negás |
|---|---|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | Instalación (normales) | Hablar con tu servidor NEXUS | — |
| `POST_NOTIFICATIONS` (Android 13+) | Al abrir la app | Avisos de misiones, recordatorios, confirmaciones | No recibís avisos (la app sigue funcionando) |
| `RECORD_AUDIO` | La primera vez que tocás el micrófono | Reconocer tu voz | Podés usar NEXUS escribiendo |
| `com.android.alarm.permission.SET_ALARM` | Instalación (normal) | Pasarle alarmas y temporizadores a tu app de Reloj | — |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE` | Solo si activás la palabra de activación | Escuchar «NEXUS» con notificación visible | La palabra de activación no se activa |
| `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED` | Instalación (normales, agregados por WorkManager) | Revisar notificaciones en segundo plano cada ~15 min y reprogramarlo tras reiniciar | — |
| `com.google.android.c2dm.permission.RECEIVE` | Instalación (agregado por Firebase) | Recibir push FCM si configuraste Firebase | — |

Lista verificada con `aapt2 dump badging` sobre el APK 2.0.0 compilado.

## Lo que NEXUS **no** pide

- **`READ_CONTACTS`**: para WhatsApp y llamadas se usa el selector nativo de Android (`ACTION_PICK`), que te deja
  elegir UN contacto y da acceso temporal solo a ese número. Si querés que NEXUS recuerde a alguien como «papá»,
  se guarda cifrado (Android Keystore) en el teléfono, nunca en el servidor ni en un modelo de IA.
- **`CALL_PHONE`**: las llamadas abren el marcador con el número cargado; la llamada la iniciás vos.
- **`READ_CALENDAR` / `WRITE_CALENDAR`**: los eventos se precargan en tu app de calendario (`ACTION_INSERT`) y los
  guardás vos. NEXUS no lee tus eventos; «consultar agenda» abre el calendario en esa fecha.
- **Accesibilidad**, **superposición** o **QUERY_ALL_PACKAGES**: para abrir apps por nombre se declaran en
  `<queries>` solo los lanzadores y los intents usados (Click to Chat, mapas, compartir, alarmas, calendario).

## Palabra de activación («NEXUS»)

- Apagada por defecto: el modo normal es **pulsar para hablar**.
- Para activarla: Más → Voz → aceptar el aviso de micrófono → interruptor. Queda registrado tu consentimiento.
- Solo funciona con **reconocimiento local** (Android 12+ con reconocedor en el dispositivo). Si tu teléfono no lo
  tiene, la función no se activa: no se envía audio continuo a internet.
- Mientras está activa hay una **notificación permanente** con botón «Desactivar» y Android muestra su propio
  indicador de micrófono. Se apaga sola a los 30 minutos. No se guarda audio.
- Con la app en segundo plano Android no permite abrir la pantalla sola: NEXUS te avisa con una notificación
  («Te escuché decir NEXUS — tocá para hablar»).

## Voz y privacidad

- Por defecto el audio se procesa **en el teléfono**. El modo «Servidor NEXUS» solo funciona si configuraste un
  modelo con capacidad `stt`; el audio se sube una vez, se transcribe y se descarta (nunca se guarda).
- Las transcripciones de mensajes por voz se borran según tu política (1, 7, 30 o 90 días, o no guardarlas).

## Reportes de fallos

Solo con tu consentimiento (Más → Privacidad). Se envían a **tu** servidor, sin números de teléfono, emails ni
tokens (se filtran antes de guardarse). Sin consentimiento, el registro local del fallo se borra al reabrir la app.

## Modo local (2.1)

No pide permisos nuevos. La clave del proveedor de IA se guarda cifrada con Android Keystore dentro de la app. Los
recordatorios y rutinas usan WorkManager, que ya estaba incluido. Ver [LOCAL_MODE.md](LOCAL_MODE.md).
