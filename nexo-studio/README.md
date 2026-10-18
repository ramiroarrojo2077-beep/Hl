# NEXO Studio 2.1 · Sistema personal de agentes

**NEXO es un proyecto propio, inspirado en sistemas de agentes multiusuario. No es GrokBot ni una copia total de sus capacidades, ni está afiliado a xAI.**

## Qué incluye realmente

- **Interfaz completa:** dashboard, vista de equipo, formularios, mensajes, canales, misiones, reuniones, memoria, rutinas, aprobaciones, ajustes e integraciones. Diseño adaptable a Android y escritorio, app instalable PWA, archivos base para una futura APK con Capacitor.
- **IA real (opcional):** Ollama local para que el modelo corra sin pagos por cada mensaje, o cualquier API *chat/completions* compatible configurada por vos. «Demo» se identifica en las respuestas, no es una IA real.
- **Agentes:** hasta 16, puestos y personalidades, manager único, modelo por agente, pausa y edición. Chats individuales con historial local.
- **Trabajo en paralelo:** tareas y canales de varios agentes; el manager sintetiza respuestas. Reuniones con actas; rutinas diarias o semanales. La app debe permanecer encendida para las rutinas. Los agentes no pueden cambiar archivos arbitrarios ni navegar solos por la web.
- **Memoria manual:** notas para uno o todos los agentes. Aprobaciones manuales: registran decisiones, no disparan acciones externas automáticamente.
- **Conectores reales configurables:** Gmail / Google Calendar / Google Drive (OAuth oficial, lectura), GitHub y Notion (lectura con token), Discord / Slack / Telegram (envío manual confirmado), RSS, Bluesky y YouTube (lectura de contenido público). Los conectores no se activan hasta configurarlos con credenciales tuyas. Su funcionamiento depende de la disponibilidad y las políticas de cada servicio.
- **Catálogo de futuras integraciones**: Instagram, Facebook, X y TikTok se muestran como PENDIENTES, no como conexiones funcionales. WhatsApp en grupos existe como módulo opcional experimental con biblioteca no oficial.
- **Privacidad:** las credenciales del Connector Hub se cifran con AES-256-GCM en `.secrets/connectors.enc` y la clave local se guarda en `.secrets/key`. Es una protección en reposo para un equipo personal: alguien con acceso a ambos archivos puede recuperar los secretos. No compartas la carpeta `.secrets` ni la carpeta `data`.

## Empezar (Windows/macOS/Linux)

1. Instalá **Node.js 22 o superior** (https://nodejs.org) y **Ollama** (https://ollama.com).
2. En la terminal, ejecutá **`ollama pull llama3.2`**; dejá Ollama ejecutándose. También podés usar otro modelo.
3. Descomprimí NEXO y entrá en la carpeta. Ejecutá **`npm start`** (o doble clic en `INICIAR-WINDOWS.bat`). Las funciones principales no requieren instalar paquetes npm adicionales.
4. Entrá a **http://127.0.0.1:3377** desde el navegador de **esa computadora**.
5. Seleccioná **Configuración → Ollama** y el nombre del modelo. Probá **Chat privado**, **Misiones**, **Reuniones** y **Canales**. También podés elegir «Demo» para probar la UI sin IA real.
6. Ejecutá **`npm test`** para las pruebas del servidor.

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
| WhatsApp | **Experimental**; modo grupo opcional no oficial | Ver nota especial más abajo |

**OAuth de Google** (para Gmail + Calendar + Drive):

1. Entrá a [Google Cloud Console](https://console.cloud.google.com/) y creá un proyecto. Habilitá **Gmail API**, **Google Calendar API** y **Google Drive API**.
2. Configurá la pantalla de consentimiento de OAuth (si está en Testing, agregá tu usuario de prueba). Algunas opciones o permisos pueden requerir verificación de Google en implementaciones públicas.
3. En Credenciales, creá **ID de cliente OAuth → Aplicación web**. Agregá esta URI exacta entre las URI de redireccionamiento autorizadas:
   `http://127.0.0.1:3377/api/connectors/google/callback`
4. Copiá `.env.example` como `.env`. Completá `GOOGLE_CLIENT_ID=` y `GOOGLE_CLIENT_SECRET=` (solo allí, nunca en el HTML ni en una conversación pública). Reiniciá NEXO.
5. Abrí Integraciones → Gmail (o Calendar/Drive) → **Autorizar con Google**. Completá el consentimiento en tu navegador. El acceso a Google se comparte entre estos tres conectores.
6. Presioná **Usar** y luego **Consultar datos** o **Pedir análisis**. Para revocar el acceso, usá **Desconectar Google**; también podés revocarlo desde la seguridad de tu Cuenta Google.

**GitHub / Notion**: creá el token de lectura en la plataforma, ingresalo en la tarjeta y guardá. Nunca compartas tokens. Los envíos a Discord, Slack y Telegram se activan solo tras confirmar cada mensaje en pantalla. Los agentes pueden analizar los resultados de lectura, pero no publican automáticamente.

**WhatsApp**: este conector experimental usa `whatsapp-web.js`, NO la API oficial. Tiene riesgo de fallos o restricciones de cuenta; apagado por defecto. Si aceptás esas condiciones y todos los participantes del grupo están informados y consienten, instalá los paquetes opcionales `npm install whatsapp-web.js qrcode` y configurá el grupo en Integraciones. Nunca se lee un grupo antes de autorizarlo. Usá `!bot`, mención explícita o el modo inteligente, que está limitado. No es apropiado para espiar mensajes ni actuar como una persona real.

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
