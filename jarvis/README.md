# J.A.R.V.I.S.

Tu asistente personal por voz. Le hablás diciendo **«Jarvis»**, te responde con voz, vigila tus mails y tu WhatsApp por su cuenta y te avisa cuando llega algo importante, con una respuesta ya preparada que **solo se envía si vos le decís «mandala»**.

- **IA gratis**: Gemini (Google) como cerebro principal y Groq como respaldo automático. Si una se queda sin cupo, sigue la otra. También acepta OpenRouter y Ollama (100 % local).
- **Solo voz**: decís «Jarvis» y se abre sola, ya escuchándote. Si decís todo junto («Jarvis, ¿va a llover mañana?») responde directo.
- **Trabaja sola**: cuando entra un mail o un WhatsApp, lo lee, decide si es importante, se abre, te lo cuenta y te propone una respuesta. Vos decís «mandala», «cambiale…» o «descartala».
- **HUD rojo y transparente**: se ve tu fondo de pantalla. En la PC es un panel vertical al costado; en el celular, una app transparente.
- **Herramientas**: clima y pronóstico, noticias, búsqueda en internet, leer páginas, calculadora, recordatorios, memoria («acordate de que…»), leer y responder mails y WhatsApp, abrir páginas, estado de la compu, resumen de buenos días.

## 1. Instalación en la PC

Necesitás [Node.js 22.18 o más nuevo](https://nodejs.org).

```bash
cd jarvis
npm install
cp .env.example .env      # en Windows: copy .env.example .env
```

Abrí `.env` y completá **como mínimo** `GEMINI_API_KEY` y `GROQ_API_KEY` (las dos son gratis, ver más abajo). Después:

```bash
npm run escritorio   # app de escritorio: panel transparente con ícono en la bandeja
# o
npm start            # solo el servidor; abrí http://localhost:3700 en Chrome o Edge
```

### Atajos de la app de escritorio

| Atajo | Qué hace |
|---|---|
| **«Jarvis»** (en voz alta) | Se abre y te escucha |
| `Alt + J` | Mostrar / ocultar |
| `Alt + H` | Hablarle sin decir «Jarvis» |
| `Esc` | Callarla / dejar de escuchar |
| Botón **ACTIVA** | La desactivás: no te avisa, no se abre sola y deja de escuchar |
| Ícono de la bandeja | Activar/desactivar, siempre arriba, iniciar con la compu, salir |

Por defecto es un panel vertical a la derecha. Para el HUD de pantalla completa poné `JARVIS_PANEL=completo` (o abrí `http://localhost:3700/?modo=completo` en el navegador).

## 2. Lo que tenés que agregar vos

Todo va en el archivo `.env`. Lo que dice **gratis** no pide tarjeta.

| Qué | Para qué | Dónde se saca |
|---|---|---|
| `GEMINI_API_KEY` **(gratis)** | El cerebro | <https://aistudio.google.com/apikey> |
| `GROQ_API_KEY` **(gratis)** | Respaldo y para entender tu voz (Whisper) | <https://console.groq.com/keys> |
| `EMAIL_CUENTAS` | Leer tus mails y responderlos | Gmail: activá la verificación en 2 pasos y creá una **contraseña de aplicación** en <https://myaccount.google.com/apppasswords>. Formato: `vos@gmail.com:clavedeaplicacion` (varias separadas por coma) |
| `WHATSAPP_ACTIVO=1` | Tus WhatsApp | Al arrancar aparece un QR en la interfaz: WhatsApp → Dispositivos vinculados → Vincular |
| `TELEGRAM_BOT_TOKEN` | Que te encuentre fuera de casa (avisos con botones Enviar/Descartar, y le podés mandar audios) | Hablale a [@BotFather](https://t.me/BotFather) → `/newbot`. Después escribile a tu bot: te contesta tu `TELEGRAM_CHAT_ID` |
| `ELEVENLABS_API_KEY` | Voz natural | <https://elevenlabs.io> → API Keys |
| `JARVIS_TOKEN` + `JARVIS_HOST=0.0.0.0` | Usarla desde el celular | Inventá un token largo |
| AccessKey de Picovoice | Que el celular detecte «Jarvis» sin internet y gastando menos batería | <https://console.picovoice.ai> (gratis para uso personal). Se carga en la app del celular |

### Sobre la voz de ElevenLabs

- Con el **plan gratis**, la API solo puede usar las voces predeterminadas de ElevenLabs (no las de la biblioteca de la comunidad) y da unos 10.000 caracteres por mes. Si se termina el cupo, Jarvis pasa sola a la voz del sistema y vuelve a probar a la media hora.
- **Recomendado**: en ElevenLabs entrá a *Voices → Voice Design* y creá tu voz con una descripción como *«Mujer argentina de 30 años, voz cálida, elegante y segura, asistente de inteligencia artificial, acento rioplatense»*. Guardala y Jarvis la elige sola (prioriza tus voces en español). O copiá su ID en `ELEVENLABS_VOZ`.
- Para ver las voces de tu cuenta: `http://localhost:3700/api/voces`.
- Con un plan pago podés usar voces de la biblioteca en español latino (buscá «Latin American Spanish female» en <https://elevenlabs.io/voice-library>).

## 3. App para el celular (Android) — funciona sola, sin la PC

Todo el cerebro de Jarvis (IA, memoria, recordatorios, avisos y herramientas) vive dentro de la app.

1. Instalá `jarvis.apk` (Android pide permitir "instalar apps desconocidas").
2. Al abrirla se abre **⚙ Ajustes**: pegá tu clave gratis de Gemini y/o Groq. Opcionales: ElevenLabs (voz), Picovoice (detectar «Jarvis» sin internet), cuentas de correo, Tavily.
3. Aceptá los permisos: micrófono, notificaciones, **Acceso a notificaciones** (así lee tus WhatsApp, Gmail, Telegram, Instagram, SMS… y responde desde la notificación cuando vos lo aprobás), **Mostrar sobre otras apps** (para abrirse sola) y **sin restricción de batería**.

Decís «Jarvis» y se abre escuchando. Cuando te llega algo importante, se abre sola, te lo lee, te propone una respuesta y la manda solo si decís «mandala». También pone alarmas y temporizadores, abre apps, busca en internet y te da el clima y las noticias.

**Trabaja sola** (Ajustes → «Trabajar sola: si»):
- Cada 30 minutos (de 8 a 23) revisa tu correo, mensajes, agenda, tareas y borradores, y te habla solo si hay algo que valga la pena.
- Te avisa 15 minutos antes de cada evento del calendario y cuando vence una tarea.
- Anota sola las tareas que salen de tus mails y mensajes («pagar la tarjeta antes del 10»).
- Rutinas: «todos los días a las 9 revisá mis mails y decime lo importante» y lo hace sola cada día.
- Nunca envía nada sin tu «sí»: solo prepara borradores.

**Correo directo**: en Ajustes poné tu Gmail y una [contraseña de aplicación](https://myaccount.google.com/apppasswords) (requiere verificación en 2 pasos). Jarvis entra directo a tu bandeja por IMAP, sin depender de las notificaciones.

**Voz y oído propios**: voz neural gratis de Microsoft (Elena o Tomás de Argentina, y otras) o Gemini/ElevenLabs. Con la clave de Groq escucha con su propio oído (Whisper): sin la ventanita ni el pitido de Google.

## 4. API

Todo lo que hace la interfaz se puede usar desde otras apps. Si definiste `JARVIS_TOKEN`, mandalo como `Authorization: Bearer <token>`.

| Método y ruta | Qué hace |
|---|---|
| `POST /api/chat` `{"mensaje": "...", "stream": false}` | Le hablás y responde `{"respuesta"}`. Con `"stream": true` responde en vivo (SSE: `texto`, `herramienta`, `fin`, `error`) |
| `GET /api/eventos` | Avisos, borradores y estado en vivo (SSE) |
| `GET /api/estado` | IA, voz y conexiones |
| `POST /api/activa` `{"activa": false}` | Activarla o desactivarla |
| `GET /api/avisos` · `GET /api/propuestas?estado=pendiente` | Avisos y borradores |
| `POST /api/propuestas/:id/enviar` `{"texto"?}` · `POST /api/propuestas/:id/descartar` · `PATCH /api/propuestas/:id` | Aprobar, descartar o corregir un borrador |
| `GET/POST /api/recordatorios` `{"texto","cuando"}` · `DELETE /api/recordatorios/:id` | Recordatorios |
| `GET /api/memoria` · `DELETE /api/memoria/:id` | Lo que Jarvis recuerda de vos |
| `POST /api/transcribir` (audio) → `{"texto"}` · `POST /api/hablar` `{"texto"}` → mp3 | Oído y voz |
| `GET /api/clima` · `GET /api/noticias?tema=` · `GET /api/sistema` · `GET /api/resumen` · `GET /api/voces` | Datos del panel |

```bash
curl -X POST http://localhost:3700/api/chat -H "Content-Type: application/json" -d '{"mensaje":"¿Qué tengo pendiente hoy?"}'
```

## 5. Seguridad y privacidad

- **Nada se envía sin tu OK.** Las respuestas quedan como borrador. Además, el envío por voz solo funciona si tus palabras incluyen una aprobación («mandala», «dale», «sí, enviásela»): un mail con instrucciones escondidas no puede hacer que Jarvis mande nada.
- Lo que llega por mail o WhatsApp se analiza **sin herramientas**: la IA solo resume y sugiere.
- La API solo acepta conexiones de esta compu salvo que configures `JARVIS_HOST` y `JARVIS_TOKEN`, y bloquea pedidos de otras páginas web.
- Con el plan gratis de Gemini, **Google puede usar el contenido para mejorar sus productos**. Si no querés que tus mails pasen por ahí, usá `OLLAMA_MODELO` (IA local, gratis) con `JARVIS_PROVEEDORES=ollama`.
- **WhatsApp** usa una librería no oficial (como WhatsApp Web). Es lo único que permite leer tu WhatsApp personal, pero WhatsApp podría limitar cuentas que la usan para spam. Usala con tu cuenta normal y sin mandar mensajes masivos.
- La escucha continua manda a transcribir (Groq) solo los pedacitos donde se detecta voz, como máximo 8 por minuto. Con Porcupine en el celular, la palabra se detecta sin internet.
- Tus datos quedan en `jarvis/datos/` (historial, memoria, avisos, sesión de WhatsApp). No se suben a git.

## Estructura

```
jarvis/
  src/server.ts        API y servidor web
  src/asistente.ts     Cerebro: charla, análisis de lo que llega, recordatorios y resumen diario
  src/ia.ts            Proveedores de IA gratuitos con respaldo automático
  src/herramientas.ts  Lo que puede hacer (clima, búsqueda, mails, borradores…)
  src/acciones.ts      Avisos y borradores (nada sale sin aprobación)
  src/voz.ts           Oído (Whisper/Gemini) y voz (ElevenLabs)
  src/info.ts          Clima (Open-Meteo), noticias (Google Noticias) y sistema
  src/conectores/      Correo (IMAP/SMTP), WhatsApp y Telegram
  public/              HUD (vertical y pantalla completa)
  desktop/             App de escritorio (Electron)
  android/             App de Android (Java)
```

`npm run check` revisa los tipos. El APK se compila solo en GitHub Actions (`.github/workflows/jarvis-apk.yml`).
