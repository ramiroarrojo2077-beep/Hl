# Modo local — NEXUS sin servidor

Desde la versión 2.1, NEXUS puede funcionar **entero dentro del teléfono**, sin servidor, sin cuenta y sin pagar
hosting. Solo necesitás una clave de un proveedor de IA; hay opciones gratuitas.

## Cómo empezar (2 minutos)

1. Instalá `NEXUS-AI-2.1.0-release.apk`.
2. En la pantalla de inicio escribí tu nombre y tocá **Empezar en este teléfono**.
3. Conseguí una clave gratis:
   - **Google Gemini**: entrá a aistudio.google.com → *Get API key* → *Create API key*.
   - **Groq**: entrá a console.groq.com → *API Keys* → *Create API Key*.
4. En NEXUS: **Más → Configuración → Proveedores de IA**.
   1. Elegí el tipo, pegá la clave y tocá **Agregar**.
   2. Tocá **Probar conexión**.
   3. Tocá un modelo para habilitarlo. El primero de chat queda como predeterminado. Sugeridos: `gemini-2.5-flash` en
      Gemini, `llama-3.3-70b-versatile` en Groq.
5. Listo: hablale o escribile a NEXUS.

Podés cargar varios proveedores. Si uno alcanza el límite de su plan gratuito, NEXUS pasa automáticamente al siguiente
modelo compatible.

## Qué funciona en el teléfono

| Función | Modo local |
|---|---|
| Acciones directas (WhatsApp con vista previa, llamadas, alarmas, temporizadores, recordatorios, apps, mapas, agenda, compartir) | ✅ sin IA y sin internet (salvo lo que abra cada app) |
| Conversación con NEXUS (streaming, voz, interrupción) | ✅ con tu clave |
| Especialistas: ATLAS, CIPHER, NOVA y ORACLE aportan antes de que NEXUS responda en investigación, código, redacción y análisis | ✅ llamadas reales al modelo |
| Chat directo con cada agente y agentes personalizados | ✅ |
| Misiones: plan de NEXUS, tareas por agente con dependencias, revisión de ORACLE y consolidación | ✅ |
| Reuniones entre agentes con acta | ✅ |
| Memoria (guardar, consultar, olvidar, privacidad por categorías) | ✅ búsqueda por palabras |
| Rutinas programadas, por fecha y por evento, con límites | ✅ |
| STOP ALL | ✅ |
| Proyectos y archivos | ✅ (NEXUS lee archivos de texto; PDF y DOCX se guardan pero no se leen) |
| Búsqueda web, sandbox de código, webhooks | ❌ requieren servidor |
| WhatsApp Business Platform | ❌ requiere servidor con webhooks |
| Transcripción o voz por servidor | ❌ se usa la voz del teléfono |
| Comparador de modelos | ❌ |

## Privacidad y seguridad

- Tus datos viven solo en este teléfono, en una base SQLite privada de la app. Se borran si desinstalás NEXUS.
  Exportalos desde Ajustes.
- La clave del proveedor se guarda **cifrada con Android Keystore** y no se vuelve a mostrar. Es una excepción a la
  regla 8 («no guardar API keys en Android»): la pediste explícitamente para no depender de un servidor. Con servidor,
  las claves siguen quedando solo en el servidor.
- Lo que escribís a NEXUS viaja directo del teléfono al proveedor que elegiste. Pasa lo mismo con lo que NEXUS necesita
  para responder: historial reciente, recuerdos relevantes y archivos que adjuntes.
- No viajan tu agenda ni los números de tus contactos: el número de WhatsApp se guarda cifrado en el teléfono y nunca
  se envía al modelo.

## Límites honestos

- **Trabajo en segundo plano**: las misiones y reuniones avanzan mientras Android mantiene viva la app. Si el sistema
  la cierra, la misión **se retoma sola** la próxima vez que abras NEXUS: continúa desde la tarea pendiente, sin
  repetir las terminadas.
- **Recordatorios y rutinas**:
  - Los revisa un trabajo de WorkManager cada 15 minutos y otro programado para la hora exacta.
  - Con ahorro de batería, Android puede demorarlos algunos minutos.
  - Si un recordatorio te importa mucho, pedile a NEXUS una **alarma**: queda en la app Reloj del teléfono.
- **Planes gratuitos**: tienen límites de pedidos por minuto y por día. Si se alcanzan, NEXUS lo dice y prueba con
  otro modelo configurado.
- **Costos**: en modo local no se calculan (los planes gratuitos no cobran). Se registran los tokens; si el proveedor
  no los informa, se estiman y se indica.

## Volver a un servidor

Cerrá sesión (Ajustes) y en la pantalla inicial usá **Acceso al centro de control** con la URL de tu servidor. Los
datos del modo local quedan en el teléfono y no se mezclan con los del servidor.
