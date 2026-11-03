# Gravity · Manual de instalación y configuración

## 1. Instalar en el celular (Android 8+, 64 bits)

1. Bajá `gravity.apk` de la release [apk-latest](https://github.com/ramiroarrojo2077-beep/Hl/releases/tag/apk-latest) y abrila. Si Android lo pide, permití «Instalar apps desconocidas» para el navegador.
2. Play Protect: «Más detalles > Instalar de todos modos» (la app no está en Google Play).
3. Elegí el modelo (ver §3), permití notificaciones y dejá a Gravity **sin restricciones de batería**.
4. Para WhatsApp y redes: botón ⋮ > **Leer WhatsApp y redes** > activá Gravity.

**Actualizar:** instalá la APK nueva encima; no se pierde nada **si la firma es la misma**. Si Android dice «conflicto de paquete», no desinstales: hacé primero una copia (Ajustes > Copia de seguridad) o pedí la APK firmada con tu clave.

## 2. En la compu

Node.js 22.18+, Linux o macOS (Windows con WSL):

```bash
npm install
cp .env.example .env     # completá la clave del modelo
npm run gravity          # http://127.0.0.1:3001
```

`npm run check` (tipos), `npm run pruebas` (pruebas automáticas), `node bots/empaquetar.mjs` (motor en un solo archivo para la app).

## 3. Modelos de IA

| Opción | Costo | Cómo |
|---|---|---|
| **Claude (Anthropic)** | Pago por uso | Clave en [console.anthropic.com](https://console.anthropic.com/settings/keys). En la app: «Claude». En la compu: `ANTHROPIC_API_KEY`. |
| **Gemini (Google)** | Gratis con cupo diario | Clave en [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sin tarjeta. En la app: «Gemini · gratis». En la compu: `GEMINI_API_KEY`. Usa Flash y, si se agota, Flash-Lite (cupos separados). |
| **Groq** (respaldo) | Gratis | Clave en [console.groq.com/keys](https://console.groq.com/keys). Campo «Respaldo gratis» o `GROQ_API_KEY`. |
| **Mistral** (respaldo) | Gratis («Experiment», verifica el teléfono) | Clave en [console.mistral.ai](https://console.mistral.ai/api-keys). Mismo campo (se reconoce sola) o `MISTRAL_API_KEY`. |

Orden con modelos gratis: Gemini → Groq → Mistral; si uno se queda sin cupo, pasa al siguiente sin cortar la conversación. Con modelos gratis el gasto se muestra en 0 (es real: no hay costo); con Claude es una **estimación** a precio de lista. En los planes gratis Google y Mistral pueden usar lo que mandás para entrenar.

## 4. Servicios externos (Conexiones)

| Servicio | Qué hace | Qué necesitás |
|---|---|---|
| Gmail / otro correo | Buscar, leer, mandar y responder correos (mandar pide aprobación) | Contraseña de aplicación (Gmail) o datos IMAP/SMTP |
| Microsoft 365 | Correo, calendario y OneDrive | Iniciar sesión con el código que muestra Gravity |
| Apps MCP | Las herramientas que publique el servidor (Notion, GitHub, Zapier…) | URL del servidor MCP y token si lo pide |
| **Bot de Telegram** | Lo que le escriben llega a Mensajes y los compañeros contestan por el bot (privado y grupos) | Token de @BotFather (`/newbot`); para leer todo en grupos, `/setprivacy` → Disable |
| WhatsApp / Instagram / Messenger / TikTok | Por las notificaciones del celular (leer y «Responder») | Permiso de acceso a notificaciones. WhatsApp no permite oficialmente automatizar cuentas: usalo con moderación |
| WhatsApp Business (API oficial) | Pendiente de conectar en la app | Cuenta de Meta Business, número verificado y una URL pública para el webhook |

## 5. Llamadas de voz

En el chat de un compañero, botón de teléfono. En el celular usa el reconocimiento y la voz del sistema (Google): la primera vez pide el micrófono. El robot 3D se configura por compañero en Perfil > Llamadas (activar, color, expresividad, calidad, voz y velocidad). Si el 3D no anda en el celular, la llamada sigue sin el robot.

## 6. Copias de seguridad

Ajustes > Copia de seguridad: **Exportar** baja un `.zip` con compañeros, conversaciones, memoria, rutinas, tareas, proyectos, reuniones, mensajería y la computadora de los bots (sin las claves de las conexiones). **Importar** lo restaura; la carpeta anterior queda guardada al lado (`gravity-antes-<fecha>`) y el motor se reinicia solo en el celular (en la compu, abrí Gravity de nuevo).
