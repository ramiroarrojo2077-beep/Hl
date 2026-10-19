

## NEXO Studio 4.1 — Solución al error «Respuesta no válida del servidor» en Android

Si la página de **Equipo** muestra `0 agentes` cuando esperabas los 4 iniciales y al crear uno aparece un error, normalmente **la interfaz no está llegando al backend de Node**, o `/api/bootstrap` devuelve HTML en lugar de JSON. El botón no puede almacenar un agente en el servidor si solo abriste los archivos `public/` como web estática o dentro de una APK.

**Diagnóstico**: abrí en el navegador de la computadora donde está corriendo Node `http://127.0.0.1:3377/api/bootstrap`. Debería aparecer JSON con `"agents"`. Si aparece una página HTML, un mensaje 404 o un error de conexión, la URL no apunta al backend correcto. Verificá que hayas iniciado `INICIAR-WINDOWS.bat` y no solamente `index.html`.

**Desde la APK/teléfono**: la interfaz y el backend son procesos distintos. Un teléfono **no puede usar `localhost` para acceder al Node de tu computadora**. Configurá en `Configuración → Tu app, tu servidor` una URL **HTTPS** pública y segura que realmente reenvíe `/api/*` al servidor NEXO, además del token del servidor si está habilitado. Si no tenés aún un backend remoto, seguí usando NEXO en la computadora; la app móvil puede servir como interfaz y guardar borradores de agentes offline, pero **no ejecuta IA de forma autónoma sin un backend y un modelo**. No publiques el backend sin autenticación, HTTPS y controles de acceso. El servidor por defecto solo acepta solicitudes locales por seguridad.

**Mejoras de 4.1**: ahora la app muestra una franja de conexión con error específico y botones «Reintentar» y «Configurar servidor». Si falla la conexión, podés **crear, editar o borrar borradores locales** de agentes en este dispositivo, identificados con una etiqueta especial (no funcionan como IA todavía). Cuando restablezcas la conexión, aparece «Sincronizar borradores» para crearlos realmente en el backend. Los borradores usan almacenamiento local del navegador: exportalos o sincronizalos antes de borrar los datos de la app, cambiar de dispositivo o desinstalarla.

**Pruebas**: las 6 pruebas automáticas del backend siguen pasando. El flujo móvil sin servidor, guardado de borrador y sincronización se comprobó en Chromium con respuestas HTTP simuladas. No se comprobó la conectividad a tu APK, teléfono o cuentas reales.
# NEXO Studio 4.0 · Agentes, reuniones y WhatsApp Business Cloud

**NEXO es un proyecto propio, inspirado en sistemas de agentes multiusuario. No es GrokBot ni una copia total de sus capacidades, ni está afiliado a xAI.**

## Novedades de NEXO Studio 4.0

- **Chat progresivo:** las respuestas de los agentes se muestran a medida que llegan desde Ollama o desde un proveedor compatible, sin esperar a que termine todo el mensaje. Botón para interrumpir.
- **Mesa de agentes:** en Canales, iniciá un debate sobre un tema. Los participantes activos se turnan, comparten el contexto reciente y generan intervenciones usando la IA seleccionada. Podés fijar de 2 a 24 turnos, detener la conversación en cualquier momento y revisar el registro persistido. No es una reunión de voz con micrófonos independientes.
- **Voz del dispositivo:** dictado mediante el reconocimiento de voz del navegador cuando existe soporte y permiso; botón «Escuchar» para leer respuestas mediante síntesis de voz del navegador. No es una llamada full-duplex ni está garantizado en todos los navegadores Android.
- **Eventos en vivo:** actualizaciones de canales transmitidas desde el backend para mostrar actividad mientras los agentes hablan.
- **Corrección verificada:** el control de detener debates cambia a `stopped` en vez de quedarse en `stopping`.

**Comprobación rápida (menos de 2 minutos):** activá el modo Demo en Configuración, abrí Chat privado y enviá «Hola»; después creá un canal con dos agentes y usá «Iniciar» en Mesa de agentes. Este modo verifica la interfaz y los flujos, **no prueba la calidad de un modelo de IA**. Con Ollama instalado, repetí los pasos para respuestas reales.

## Qué incluye realmente

- **Interfaz completa:** dashboard, vista de equipo, formularios, mensajes, canales, misiones, reuniones, memoria, rutinas, aprobaciones, ajustes e integraciones. Diseño adaptable a Android y escritorio, app instalable PWA, archivos base para una futura APK con Capacitor.
- **IA real (opcional):** Ollama local para que el modelo corra sin pagos por cada mensaje, o cualquier API *chat/completions* compatible configurada por vos. «Demo» se identifica en las respuestas, no es una IA real.
- **Agentes:** hasta 16, puestos, personalidad, tono, iniciativa y estilo de respuesta, manager único, modelo por agente, pausa y edición. Chats individuales con historial local y streaming de respuestas.
- **Trabajo en paralelo:** tareas y canales de varios agentes; el manager sintetiza respuestas. Reuniones con actas; debates autónomos de canales con botón Detener; rutinas diarias o semanales. La app debe permanecer encendida para las rutinas. Los agentes no pueden cambiar archivos arbitrarios ni navegar solos por la web.
- **Memoria manual:** notas para uno o todos los agentes. Aprobaciones manuales: registran decisiones, no disparan acciones externas automáticamente.
- **Conectores reales configurables:** Gmail / Google Calendar / Google Drive (OAuth oficial, lectura), GitHub y Notion (lectura con token), Discord / Slack / Telegram (envío manual confirmado), RSS, Bluesky y YouTube (lectura de contenido público). Los conectores no se activan hasta configurarlos con credenciales tuyas. Su funcionamiento depende de la disponibilidad y las políticas de cada servicio.
- **Catálogo de futuras integraciones**: Instagram, Facebook, X y TikTok se muestran como PENDIENTES, no como conexiones funcionales. WhatsApp Cloud API oficial en conversaciones individuales está implementada y requiere cuenta WhatsApp Business Platform. Los grupos de amigos no se pueden conectar con una cuenta personal mediante esta API.
- **Privacidad:** las credenciales del Connector Hub se cifran con AES-256-GCM en `.secrets/connectors.enc` y la clave local se guarda en `.secrets/key`. Es una protección en reposo para un equipo personal: alguien con acceso a ambos archivos puede recuperar los secretos. No compartas la carpeta `.secrets` ni la carpeta `data`.

## Empezar (Windows/macOS/Linux)

1. Instalá **Node.js 22 o superior** (https://nodejs.org) y **Ollama** (https://ollama.com).
2. En la terminal, ejecutá **`ollama pull llama3.2`**; dejá Ollama ejecutándose. También podés usar otro modelo.
3. Descomprimí NEXO y entrá en la carpeta. Ejecutá **`npm start`** (o doble clic en `INICIAR-WINDOWS.bat`). Las funciones principales no requieren instalar paquetes npm adicionales.
4. Entrá a **http://127.0.0.1:3377** desde el navegador de **esa computadora**.
5. Seleccioná **Configuración → Ollama** y el nombre del modelo. Probá **Chat privado**, **Misiones**, **Reuniones** y **Canales**. También podés elegir «Demo» para probar la UI sin IA real.
6. Ejecutá **`npm test`** para las pruebas del servidor, o abrí **`COMPROBAR-WINDOWS.bat`** en Windows. La simulación de WhatsApp comprueba la firma y la mensajería con respuestas de prueba, pero **no sustituye una conexión real con tu cuenta de Meta**.

> **Ojo:** pagar ChatGPT o Claude no incluye por defecto créditos para sus APIs. Ollama no cobra por mensaje, pero usa recursos de tu computadora. Para equipos modestos podés usar modelos más chicos.

## Conectores · guía rápida

Entrá a **Integraciones → Conectá tu mundo digital**. Cada tarjeta muestra estado, capacidades y permisos.

| Servicio | Capacidad implementada | Para configurarlo |
|---|---|---|
| Gmail | Lista correos recientes de la bandeja; remitente, asunto, fecha y extracto; resumen por agente | OAuth Google; solo lectura |
| Google Calendar | Próximos eventos del calendario principal | OAuth Google; solo lectura |
| Google Drive | Metadatos de archivos recientes, no contenidos | OAuth Google; solo lectura |
| GitHub | Repositorios propios / colaboraciones | Token personal de lectura |
| Notion | Buscar páginas que compartiste con la integración | Token de integración con lectura |
| Discord | Publicar texto en un canal | Webhook del canal + confirmación humana |
| Slack | Publicar texto en un canal | Incoming Webhook + confirmación humana |
| Telegram | Enviar texto como bot identificado | Token de bot + chat ID autorizado + confirmación |
| RSS | Ver títulos/fechas de un feed HTTPS público | URL de feed pública |
| Bluesky | Leer publicaciones públicas recientes | Nombre de usuario público |
| YouTube | Ver videos recientes de un canal público | ID del canal (`UC...`) |
| Instagram, Facebook, X, TikTok | **No implementados** | APIs oficiales, permisos específicos; evaluar según el servicio |
| WhatsApp Business Cloud | **Webhook oficial con verificación, firmas, contactos habilitados, consentimiento y respuestas de agentes** (solo chats individuales) | Credenciales de Meta + URL HTTPS pública y permiso del contacto |

**OAuth de Google** (para Gmail + Calendar + Drive):

1. Entrá a [Google Cloud Console](https://console.cloud.google.com/) y creá un proyecto. Habilitá **Gmail API**, **Google Calendar API** y **Google Drive API**.
2. Configurá la pantalla de consentimiento de OAuth (si está en Testing, agregá tu usuario de prueba). Algunas opciones o permisos pueden requerir verificación de Google en implementaciones públicas.
3. En Credenciales, creá **ID de cliente OAuth → Aplicación web**. Agregá esta URI exacta entre las URI de redireccionamiento autorizadas:
   `http://127.0.0.1:3377/api/connectors/google/callback`
4. Copiá `.env.example` como `.env`. Completá `GOOGLE_CLIENT_ID=` y `GOOGLE_CLIENT_SECRET=` (solo allí, nunca en el HTML ni en una conversación pública). Reiniciá NEXO.
5. Abrí Integraciones → Gmail (o Calendar/Drive) → **Autorizar con Google**. Completá el consentimiento en tu navegador. El acceso a Google se comparte entre estos tres conectores.
6. Presioná **Usar** y luego **Consultar datos** o **Pedir análisis**. Para revocar el acceso, usá **Desconectar Google**; también podés revocarlo desde la seguridad de tu Cuenta Google.

**GitHub / Notion**: creá el token de lectura en la plataforma, ingresalo en la tarjeta y guardá. Nunca compartas tokens. Los envíos a Discord, Slack y Telegram se activan solo tras confirmar cada mensaje en pantalla. Los agentes pueden analizar los resultados de lectura, pero no publican automáticamente.

## WhatsApp oficial · Configuración real y límites

No es WhatsApp Web ni usa una sesión personal: NEXO 4 tiene integración directa con **WhatsApp Business Cloud API** mediante un webhook que verifica el token y la firma HMAC-SHA256 de Meta. Esto requiere una cuenta con acceso a la plataforma WhatsApp Business, número empresarial habilitado y credenciales. Meta puede cobrar por mensajes según el tipo y las condiciones; no se promete uso ilimitado gratis.

1. Abrí **Meta for Developers**, configurá tu app de WhatsApp Business y obtené `Phone Number ID`, token de acceso, `App Secret` y un token de verificación elegido por vos. Mantené los secretos fuera del frontend.
2. Copiá `.env.example` como `.env` y completá `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`. Reiniciá el servidor.
3. Publicá el backend mediante un **proxy HTTPS seguro** con el dominio y certificado correspondiente. En Meta registrá el callback `https://tu-dominio/api/whatsapp/webhook` y el mismo token de verificación. Suscribite al campo `messages`. **No expongas toda la API sin HTTPS, autenticación y protección de acceso.**
4. En **Integraciones → WhatsApp**, agregá solo el número de un contacto al que hayas informado. Elegí agente y modo. La persona debe escribir **`!bot aceptar`** desde su cuenta al número Business conectado para habilitar respuestas. Hasta entonces el bot no responde preguntas.
5. El contacto escribe `!bot ¿qué opinás?`, o usa modo «Preguntas». Para desconectarse puede escribir `!bot silencio`; también podés eliminarlo desde NEXO.

**Limitaciones honestas:** no se pueden introducir los bots en cualquier grupo personal de amigos. La **Groups API** existe pero exige elegibilidad especial de Meta (por ejemplo, cuenta empresarial oficial verificada); **este paquete solo implementa mensajería individual**, no grupos. Los mensajes de texto libre están sujetos a la ventana de atención de 24 horas, y fuera de ella suelen requerirse plantillas aprobadas. No se incluyen plantillas ni campañas automáticas.

**Personalidades propias:** editá cada agente para definir personalidad estable, tono, iniciativa y formato comunicativo. Estas preferencias se incorporan al prompt de sistema junto con su puesto, instrucciones y memoria.

**Reuniones más reales:** los agentes participan secuencialmente, conocen los aportes anteriores, podés intervenir durante la sesión, escuchar cada intervención con la voz del navegador y el manager produce un acta. Las intervenciones se guardan mientras ocurren, la interfaz recibe eventos y podés detener una reunión. Las rutinas de reuniones diarias siguen disponibles. No se presenta una llamada de voz grupal como si estuviera implementada.

## Preparado para Android / APK

La UI es adaptable a pantallas chicas; viene con `public/manifest.webmanifest`, ícono y service worker para instalar como PWA. **El service worker guarda exclusivamente archivos visuales; no guarda datos privados ni ejecuta IA sin conexión**. El servidor y Ollama siguen siendo procesos distintos que deben permanecer disponibles, idealmente en tu PC o servidor privado.

Para generar una APK en el futuro, con [Android Studio](https://developer.android.com/studio) y un ordenador configurado:

```bash
npm install --save @capacitor/core
npm install --save-dev @capacitor/cli
npm install @capacitor/android
npx cap add android
npx cap sync android
npx cap open android
```

El proyecto incluye `capacitor.config.json` con `webDir: public`. Desde Android, abrí Configuración → Servidor y definí **URL HTTPS** de tu instancia remota y token de acceso. Para permitir esto, tenés que desplegar el backend en una PC/servidor accesible con **HTTPS + control de acceso real**. Los `localhost` de Android y de tu computadora son máquinas distintas. No actives `HOST=0.0.0.0` sin proteger el servidor con un proxy TLS y un token robusto; este ejemplo no trae controles de múltiples cuentas ni protecciones completas para exposición pública.

## Arquitectura y límites

- Servidor: HTTP Node.js nativo, por defecto solo escucha en `127.0.0.1:3377` y usa `data/state.json` local. El servidor web sirve únicamente archivos autorizados. No hay cuentas de usuarios separadas.
- Conectores: `connectors.js` separado del backend. Credenciales cifradas en `.secrets/`. API externa a través de endpoints específicos; el estado público NO contiene tokens. La lectura de correo es solo lectura y no hay acceso oculto a mensajes directos de redes sociales.
- Procesamiento en paralelo: `Promise.allSettled()` para obtener los aportes de agentes; con Ollama el hardware limita el paralelismo real.
- Automaciones: se ejecutan **solo** mientras el servidor está prendido. No hay cola distribuida, navegación remota, múltiples computadoras orquestadas ni tareas independientes en la nube.
- Importante: las respuestas de la IA pueden contener errores. Las aplicaciones conectadas pueden cambiar sus APIs, límites y tarifas. No publiqués NEXO en internet para terceros sin desarrollar autenticación por usuario, cifrado de transporte, medidas contra abuso, CSRF y revisiones de seguridad.

## Comandos en el chat privado

Si conectaste un servicio de lectura, podés pedirle a cualquier agente que consulte sus datos usando un comando explícito: `/gmail`, `/calendar`, `/drive`, `/github`, `/notion`, `/rss`, `/bluesky` o `/youtube`. Ejemplo: `/gmail resumí los mensajes importantes`. El agente recibe solo el resultado de esa consulta; no se conectará en secreto a otras cuentas.

## Pruebas

`npm test` verifica los flujos locales, chats, manager, tareas y actas, el protocolo Ollama con modelo simulado, y el catálogo, cifrado y envíos de los conectores con servicios simulados. **No incluye pruebas reales contra las cuentas de terceros**, que requieren autorización y credenciales del usuario.
