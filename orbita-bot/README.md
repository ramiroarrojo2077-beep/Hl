# Órbita — recreación independiente del núcleo de Grok Bot

Aplicación personal de agentes: chat persistente, perfiles, memoria, herramientas, aprobaciones, archivos compartidos, skills, rutinas y delegación entre bots. Cliente de escritorio Electron y motor Node/SQLite separado de la ventana.

**Estado de la entrega:** código fuente, no un instalador ni el producto oficial. El motor tiene 16 pruebas automatizadas aprobadas. La ejecución visual, el empaquetado Electron, Docker y la inferencia con un modelo real no pudieron verificarse en el entorno de desarrollo por restricciones de ejecución/red y ausencia de un modelo o clave. La interfaz no incluye respuestas demo: si el modelo no está conectado, muestra un error.

## Arranque en tu ordenador

Necesitas **Node.js 24 o posterior** y un modelo. Para usarlo sin pagar una API, instala [Ollama](https://ollama.com/download) y descarga un modelo con herramientas:

```sh
ollama pull qwen3:8b
```

Mantén Ollama abierto. Su consumo de memoria y velocidad dependen del modelo, contexto y hardware; puedes cambiar `OLLAMA_MODEL` por otro modelo instalado que admita herramientas. Los archivos del modelo no están incluidos en este proyecto. [Referencia oficial de tool calling](https://docs.ollama.com/capabilities/tool-calling).

Abre una terminal dentro de la carpeta del proyecto:

```sh
npm install
```

Copia `.env.example` a `.env` y conserva estos valores para inferencia local:

```dotenv
MODEL_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
```

La copia se hace con `cp .env.example .env` en macOS/Linux o `Copy-Item .env.example .env` en PowerShell. Después:

```sh
npm run doctor
npm run desktop
```

`doctor` muestra qué componentes faltan sin imprimir claves ni gastar tokens. No todas las comprobaciones son obligatorias para el chat: Docker y Chromium solo hacen falta para sus herramientas.

## Usar Grok como modelo

Con una cuenta y clave propia de xAI, configura en el archivo privado `.env`:

```dotenv
MODEL_PROVIDER=xai
XAI_API_KEY=tu_clave_privada
XAI_MODEL=grok-4.7
```

Verifica que el modelo esté habilitado en tu cuenta. El acceso a la API puede ser de pago y no se incluye aquí. La integración utiliza `https://api.x.ai/v1/responses` con `store: false`; esto no sustituye las condiciones de tratamiento de datos del proveedor. La clave permanece en el proceso del servidor y no se envía al cliente. [Documentación oficial](https://docs.x.ai/developers/model-capabilities/text/generate-text).

## Primer flujo completo

1. Abre Atlas o crea un bot con nombre, rol e instrucciones.
2. En **Archivos**, añade un TXT, MD, CSV o JSON con información de trabajo.
3. Pide: «Lee los archivos compartidos, prepara un resumen y guárdalo en resumen.md».
4. El modelo decide qué herramientas usar. Revisa los argumentos de `write_file` y pulsa **Permitir una vez**.
5. Descarga el archivo desde **Archivos**. La conversación y la actividad quedan guardadas.

Puedes pedir que recuerde preferencias con `remember`, guarde un procedimiento con `save_skill` o envíe una tarea a otro bot con `delegate`. Cada mutación requiere aprobación. Una aprobación rechazada o caducada no ejecuta la acción. La delegación es asíncrona; consulta el bot destinatario para ver su resultado.

## Ordenador y herramientas

### Terminal aislado

Instala e inicia Docker y construye la imagen:

```sh
npm run computer:build
```

La herramienta `terminal` ejecuta el comando aprobado en un contenedor con límite de 30 segundos, 512 MB, sin red, sin capacidades Linux y con raíz de solo lectura. Dispone de Node.js y shell Alpine. Un volumen Docker propio conserva `/workspace` y se comparte entre los bots. No se monta el disco personal ni el socket Docker dentro del contenedor.

Los archivos de este volumen y los adjuntos de la conversación son almacenes diferentes. Para entregar un resultado de texto en la aplicación, el bot usa `write_file`. No se transfieren automáticamente binarios entre ambos almacenes.

### Navegador dedicado

```sh
npx playwright install chromium
```

Define dominios **exactos** en `.env`, separados por comas, y reinicia:

```dotenv
BROWSER_ALLOWED_HOSTS=example.com,www.example.com
```

Las subpáginas pueden necesitar dominios adicionales para sus recursos. El navegador bloquea todo dominio no listado, las descargas y los WebSockets. Usa un perfil propio, con sesiones compartidas entre bots y una página por bot; no reutiliza tu perfil personal. Se ejecuta con el sandbox de Chromium activado: no lo desactives para resolver problemas de instalación.

Puede navegar, leer texto, inspeccionar elementos, hacer clic y rellenar campos, con aprobación individual. **Ordenador → Actualizar vista** consulta su captura actual. No se ha implementado control humano del navegador, voz, CAPTCHA/2FA ni enseñanza por grabación.

## Rutinas, memoria y persistencia

- Cada bot mantiene un rol, instrucciones, memoria explícita y una conversación. El modelo recibe hasta 40 mensajes recientes, limitados a 40.000 caracteres; no hay resumen automático de toda la historia.
- Las skills se descubren por catálogo y se leen mediante herramientas, evitando cargar todas las instrucciones a la vez.
- Las rutinas corren cada 1, 24 o 168 horas desde la fecha elegida, en UTC. La interfaz muestra hora local. No son horarios de calendario ajustados automáticamente al cambio de hora.
- Máximo 3 tareas simultáneas, una por bot, 12 pasos de inferencia y dos niveles de delegación. Son límites operativos de esta versión.
- Cerrar la ventana de escritorio la oculta si hay bandeja de sistema disponible; el proceso sigue activo. **Salir y detener tareas**, apagar o suspender el equipo detiene el motor local.
- Tras un reinicio, las tareas interrumpidas quedan en error y sus aprobaciones se cancelan. No se repiten automáticamente efectos que podrían haberse ejecutado.
- Borrar un bot elimina perfil, mensajes, actividad y rutinas. Los archivos compartidos se conservan.

## Dónde se guardan los datos

En escritorio: `<directorio userData de Electron>/data/`. En modo servicio: `data/` junto al proyecto, o `DATA_DIR` si lo configuras. La base `orbita.sqlite` y el perfil `browser-profile/` contienen información privada y no están cifrados por la aplicación. Usa las protecciones y cifrado del sistema operativo.

Para hacer copia de seguridad, sal completamente de Órbita y copia todo el directorio de datos. El volumen Docker tiene una copia separada. No está implementado un servicio de backup automático.

## Modo servicio y empaquetado

El motor también puede arrancarse sin Electron para desarrollo o para mantenerlo en un equipo encendido:

```sh
npm start
```

Se enlaza a `127.0.0.1:3000`. La interfaz local está en `http://localhost:3000`. Este modo usa un directorio de datos diferente al de escritorio salvo que configures `DATA_DIR`. No expongas directamente el puerto a internet: es un espacio personal, sin autenticación multiusuario ni aprovisionamiento cloud.

Para preparar una carpeta ejecutable para tu sistema operativo:

```sh
npm run package:desktop
```

La salida va a `releases/`. No es un instalador firmado ni notarizado. El empaquetado se debe ejecutar y comprobar en cada plataforma objetivo. La entrega no contiene binarios Electron ni un `package-lock.json` validado; la instalación de dependencias quedó pendiente en este entorno.

## Pruebas

```sh
npm run check
npm test
```

Las pruebas no necesitan Electron, Docker ni claves. Ejecutan el servicio mediante transporte HTTP en memoria y un proveedor controlado; sí verifican efectos reales sobre SQLite, permisos y rutinas. No demuestran la calidad de un LLM ni la integración externa en vivo.

Pruebas de interfaz preparadas, aún no ejecutadas con éxito en este entorno:

```sh
python -m pip install playwright
python tests/ui_test.py
```

La prueba usa Chromium instalado en `/usr/bin/chromium`, o la ruta indicada en `CHROMIUM_PATH`. Intercepta las peticiones y las dirige al motor real con un proveedor de QA; no contacta servicios externos. Las capturas solo se crean si Chromium puede arrancar.

## Diferencias respecto a Grok Bot

Esta es una recreación independiente del núcleo, no una reproducción completa del servicio. Faltan: ordenador cloud administrado, aplicaciones móviles, grupos de conversación, voz, conectores OAuth, marketplace, integración con X, sincronización entre dispositivos, aprendizaje por demostración, control manual del ordenador y políticas empresariales. La delegación básica, el motor local y las herramientas implementadas no equivalen a esas capacidades.

El estado detallado está en `replica/features.csv`, `replica/parity.md` y `replica/test-plan.md`. La investigación funcional usó documentación pública; no se copió el código ni se usaron APIs privadas del producto original.

## App Android (APK)

`android/` contiene un cliente WebView de la interfaz. El motor (Node, SQLite, Docker) sigue corriendo en el PC; el teléfono se conecta por USB sin abrir el servidor a la red:

1. En el PC: `npm start`.
2. Conecta el teléfono con depuración USB y ejecuta `adb reverse tcp:3000 tcp:3000`.
3. Abre la app Órbita.

El APK se compila en GitHub Actions (workflow **Android APK**) y se descarga como artefacto `orbita-apk`. Localmente: `cd android && gradle assembleDebug`.
