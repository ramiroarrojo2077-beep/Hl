# Gravity NEXT · Fase 0: auditoría técnica

Fecha: 2026-11-03. Base auditada: `gravity-8-arreglado.apk` (SHA-256 `f0d12098…f131d134`) y el repositorio en la rama `ccr-c7fbf7b5-pvcwck`.

## 1. Qué es el APK y de dónde salió

Comparé el APK, archivo por archivo, contra la APK que compiló la CI del repo en el commit `92937aa`:

| Contenido | Resultado |
|---|---|
| `classes*.dex`, `lib/arm64-v8a/*.so` (libnode 24.20, libgravity_nodo, libc++_shared), `res/`, `assets/motor/public/*` (interfaz, sw.js, íconos, fuentes) | **Idénticos** byte a byte al build de `92937aa`. |
| `assets/motor/gravity/servidor.mjs` | **Modificado a mano**: +16 líneas en el motor compilado (ver abajo). |
| Firma | **Otra clave**: `CN=Gravity`, SHA-256 `8A:BF:C3:16:…:53:CE`, con firma v1 (`META-INF/GRAVITY.RSA`). La CI firma con `android/firma/gravity-debug.jks` (`CN=Gravity (firma de prueba)`, `F5:A3:BC:13:…:B4:DA`). |

**El cambio del motor** completa con `null` los campos opcionales que Gemini y los modelos estilo OpenAI omiten en las llamadas a herramientas. Sin eso, las herramientas estrictas (por ejemplo `mensajes` → enviar) fallaban la validación y el bot creía que había mandado algo que nunca salió. Es un arreglo correcto: **ya está portado al código fuente** (`bots/src/proveedores.ts`, commit `b5133d3`) con una prueba.

**Riesgo por la firma distinta:** si en el celular está instalada `gravity-8-arreglado.apk`, Android **no deja instalar encima** la APK de la CI (otra firma). Desinstalar borra los datos de la app (conversaciones, memoria, claves). Opciones, de mejor a peor:
1. Cargar en el repo los secretos `ANDROID_KEYSTORE_BASE64/PASSWORD/KEY_ALIAS/KEY_PASSWORD` con la keystore que firmó el APK "arreglado": la CI firma con esa y se actualiza sin perder nada.
2. Exportar los datos antes (pendiente: no hay exportación todavía; ver plan, Entrega 2) y reinstalar.
3. Desinstalar y empezar de cero.

## 2. Arquitectura real

Android (Kotlin, sin AndroidX) + Node.js 24 embebido (nodejs-mobile, `libnode.so`) + interfaz web en un WebView.

- **Proceso `:motor`** (`Motor.kt`): servicio en primer plano que arranca Node con JNI (`gravity_nodo.cpp`), le pasa por variables de entorno las claves (descifradas del Android Keystore) y un token. Vigila el estado (`/api/motor`), mantiene la CPU despierta con trabajo en curso y programa alarmas para las rutinas. Reinicio tras caídas con tope (`Fallos`).
- **Motor Node** (`bots/src`, ~9.000 líneas TypeScript, empaquetado con esbuild en `servidor.mjs`): servidor HTTP en `127.0.0.1:38471`, API REST + SSE, bucle de cada agente con la API de mensajes de Anthropic (o Gemini/Groq/Mistral traducidos por `proveedores.ts`), herramientas, aprobaciones, equipos, reuniones, rutinas, memoria, conexiones, mensajería, videos.
- **Interfaz** (`bots/public/index.html`, ~4.150 líneas, sin frameworks): SPA con rutas por hash, actualizaciones por SSE, PWA con service worker.
- **Comunicación Android ↔ motor:** HTTP local con token (cookie `gravity_app` o header `x-gravity-token`). La app verifica al motor con un reto HMAC (`/api/hola`) antes de mandar el token, para que otra app que ocupe el puerto no lo robe.
- **Persistencia:** archivos JSON/JSONL con escritura atómica (temporal + rename) y escrituras diferidas que se vacían al apagar (`SIGTERM`). Carpeta `files/gravity` (en la compu, `~/gravity`): `estado.json` (bots, rutinas, habilidades, reglas, ajustes), `tareas.json`, `conversaciones/*.jsonl` + `.meta.json`, `memoria/<bot>/`, `reuniones/*.json`, `mensajeria/`, `conexiones.json` (secretos cifrados con AES-256-GCM), `gasto.json`, `computadora/` (archivos de trabajo de los bots). **No hay SQLite.**

## 3. Inventario de funciones

Leyenda: ✅ funcional y comprobada · 🟡 parcialmente implementada · 🟠 implementada pero con fallas reportadas · 🎨 solo interfaz · ⛔ no existe.
"Comprobada" = pruebas automáticas del repo (motor real + API falsa + Playwright), **no en un celular**.

| # | Función | Estado | Evidencia y notas |
|---|---|---|---|
| 1 | Gestión de agentes | ✅ | Crear, listar, borrar; hasta 50; e2e `orbita.mjs` (30 pasos). |
| 2 | Creación y edición | ✅ | Diálogo con 36 puestos, perfil editable (nombre, puesto, descripción, ícono, esfuerzo, manager). |
| 3 | Personalidades y roles | 🟡 | 36 puestos en 9 categorías + descripción libre. No hay campos separados de personalidad, objetivos, restricciones ni nivel de autonomía por agente. |
| 4 | Conversaciones | ✅ | Streaming, markdown, acciones con detalle, cola de mensajes, detener, historial persistente (JSONL). |
| 5 | Reuniones multiagente | ✅ | Daily y discusión con facilitador, rondas, presupuesto, acta estructurada, tareas desde el acta. Sin pausa/reanudar. |
| 6 | Tareas y proyectos | 🟡 | Tareas delegadas con estados, plazos, presupuesto y tablero por manager. **No hay entidad "proyecto"**, ni Kanban general, ni dependencias. |
| 7 | Memoria persistente | 🟡 | Memoria por agente (archivos), habilidades compartidas, carpeta de equipo. Sin búsqueda semántica ni de texto completo, sin políticas de retención. |
| 8 | Rutinas | ✅ | Intervalo, diaria, semanal; registro de ejecuciones; alarma de Android para despertar el celular. Sin condiciones ni dependencias. |
| 9 | Aprobaciones | ✅ | Por herramienta, reglas "siempre permitir" con alcance, bandeja con lote, "Aprobar todo solo" opcional. |
| 10 | Conexiones | 🟡 | Gmail/IMAP-SMTP, Microsoft 365 (Graph, código de dispositivo), MCP. Probadas con servidores falsos, no con cuentas reales. Sin Calendar/Drive/GitHub/Telegram Bot API. |
| 11 | WhatsApp y Telegram | 🟠 | Por **notificaciones del celular** (leer + "Responder"), modos leer/atender/charlar, autorespuesta. **El usuario reporta que muchas veces dice "enviado" y no sale.** Causas encontradas y arregladas en código (sin probar en un celular): campos null en llamadas de herramientas (`b5133d3`), confirmación real del envío y acción fresca de la notificación (`0c2bf65`), reintentos. `whatsapp.ts` (API oficial de WhatsApp Cloud) existe pero **no está conectado**. Riesgo: WhatsApp no permite automatizar cuentas personales. |
| 12 | Proveedores de IA | ✅ | Anthropic; gratis: Gemini (cadena de modelos) → Groq → Mistral, con cambio automático por cupo. No hay selección de modelo por agente ni enrutamiento por complejidad. |
| 13 | Persistencia | ✅ | JSON atómico; vaciado al apagar; migración de formatos viejos. Sin exportar/importar ni copias de seguridad. |
| 14 | Servidor local | ✅ | Arranque, salud (`/api/motor`), token, reto HMAC, cierre con `SIGTERM`. |
| 15 | Android ↔ Node | ✅ | HTTP local, long-poll de salientes, reinicio con tope de fallos. |
| 16 | Notificaciones | ✅ | Servicio en primer plano con estado, aprobaciones y derivaciones. |
| 17 | Recuperación de sesiones | 🟡 | Colas y tareas en curso vuelven a pendiente al reiniciar; salientes con reintento. Una respuesta a medias de un agente se pierde si el motor muere en el medio. |
| 18 | Seguridad y permisos | 🟡 | Token + HMAC, claves en Keystore, secretos cifrados, contenido de afuera marcado como no confiable, herramientas restringidas en turnos de mensajería. **Falta:** Content-Security-Policy en la página principal, permisos por agente (todas las herramientas para todos), revisión de seguridad completa de la mensajería. |
| — | Voz y llamadas | ⛔ | No existían. En desarrollo (Entrega 6 adelantada por pedido explícito). |
| — | Avatar 3D | ⛔ | No existía. En desarrollo. |

## 4. Fallas y riesgos priorizados

1. **Envíos de mensajería que no salen** (🟠, reportado): arreglos en `0c2bf65` + `b5133d3`; falta probar en un celular real.
2. **Firma distinta** del APK arreglado: actualizar puede requerir desinstalar y perder datos (ver §1).
3. **Sin exportar/importar datos**: cualquier reinstalación pierde todo.
4. **Sin CSP** en la interfaz: hoy el escape de HTML es el único freno a XSS.
5. **Todas las herramientas para todos los agentes**: no hay permisos ni autonomía por agente (solo aprobaciones globales).
6. **APK debug firmada con clave pública** en el repo: cualquiera con el repo puede firmar una "actualización".
7. Pruebas de seguridad de mensajería escritas que no se disparan (formato del mock), y ninguna prueba en dispositivo.

## 5. Protección del proyecto

- El repo tiene todo el historial en git; ninguna entrega borra datos: los formatos nuevos son aditivos y los campos nuevos son opcionales.
- El APK original quedó guardado fuera del repo (scratchpad) con su hash.
- Recompilar desde el APK no hace falta: el código fuente completo está en el repo y el único cambio del APK ya está portado.
