# StudyOS AI

Plataforma de estudio con profesor virtual 3D, tareas adaptativas (SmartTasks AI), exámenes con corrección explicada, flashcards con repetición espaciada, laboratorio 3D, pizarra inteligente, mapas conceptuales, planificador, modo Focus y estudio de video. Funciona como **app de Android (APK)** y en el navegador.

Todos los datos se guardan **en el dispositivo** (IndexedDB). No hay servidor propio: la IA se usa con la clave del estudiante, que va directo del celular al proveedor elegido.

## Instalar en Android

1. En GitHub, abrí **Releases** (o **Actions → StudyOS APK → último run → Artifacts**) y descargá `StudyOS-AI-…apk` desde el celular.
2. Abrilo y permití «Instalar apps desconocidas» para el navegador o el administrador de archivos.
3. Requiere Android 7.0 o superior.

**Actualizaciones sin perder datos:** Android solo deja instalar una versión nueva encima de la anterior si ambas tienen la misma firma. Para eso, cargá una clave propia como secretos del repositorio (Settings → Secrets and variables → Actions): `STUDYOS_KEYSTORE_BASE64` (el archivo `.keystore` en base64), `STUDYOS_KEYSTORE_PASSWORD`, `STUDYOS_KEY_ALIAS` y `STUDYOS_KEY_PASSWORD`. Se crea con:

```bash
keytool -genkeypair -keystore studyos.keystore -alias studyos -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 studyos.keystore   # este texto va en STUDYOS_KEYSTORE_BASE64
```

Sin esos secretos el APK se firma con una clave temporal distinta en cada compilación: para actualizar hay que desinstalar la versión anterior, así que antes exportá una copia de seguridad (Configuración → Datos y cuenta) e importala después.

El APK lo compila el workflow `.github/workflows/studyos-apk.yml` en cada push que toque `studyos/`.

## Configurar la IA

Configuración → Inteligencia artificial. Proveedores:

| Proveedor | Costo | Qué hace falta |
|---|---|---|
| Google Gemini | Plan gratuito con límites | Clave de aistudio.google.com |
| Anthropic (Claude) | Pago por uso | Clave de platform.claude.com. Por defecto `claude-opus-5-5` con fallback del servidor activado. |
| OpenAI o compatible | Pago por uso (o gratis según el servicio) | Clave y URL base. Sirve para OpenAI, Groq, OpenRouter, LM Studio, etc. |
| Ollama (local) | Gratis | Ollama en una computadora de la misma red: `OLLAMA_HOST=0.0.0.0 ollama serve`. En el navegador también `OLLAMA_ORIGINS=*`. En Android la conexión va por el puente nativo (sin transmisión en vivo). |

«Probar conexión y cargar modelos» verifica la clave y lista los modelos de tu cuenta. Si el modelo guardado ya no existe (los proveedores retiran modelos cada pocos meses), StudyOS elige uno disponible y lo guarda; lo mismo hace si un modelo deja de existir mientras usás la app. Para Gemini el predeterminado es `gemini-flash-latest`, el alias de Google que apunta siempre al Flash estable más nuevo. Los errores muestran el mensaje real del proveedor (clave inválida, sin saldo, límite de uso, etc.).

## Qué funciona sin IA

Materias, carpetas y apuntes; biblioteca (PDF, DOCX, PPTX, TXT, fotos) con **OCR en el dispositivo** (Tesseract, español e inglés, sin conexión); flashcards con SM-2; exámenes armados desde flashcards; calendario, planificador y recordatorios; modo Focus con sonidos ambientales; pizarra; laboratorio 3D; estadísticas; profesor 3D animado; copia de seguridad.

## Estado real de cada función

| Área | Estado |
|---|---|
| Biblioteca e importación | PDF con capa de texto y escaneado (OCR por página), DOCX (secciones por título), PPTX (diapositivas y notas), TXT/pegado, JPG/PNG. Detecta títulos, fórmulas, tablas e imágenes y guarda el original. Si no hay texto legible, se informa y no se genera contenido. |
| Resúmenes | 5 modos, profundidad y extensión. Documentos largos por partes (map-reduce). Cada dato cita la página; las citas a páginas inexistentes se marcan. Revisor de calidad opcional. |
| Profesor IA | 6 modos de enseñanza, nivel 1–5, memoria de la sesión, búsqueda en tus documentos (BM25 + embeddings opcionales), respuestas en vivo con botón Detener, voz y conversación continua. |
| Profesor 3D | Modelos VRM riggeados (Seed-san, VRM sample) y RobotExpressive (GLB). Animación procedural por capas: respiración, cambio de peso, dedos relajados, mirada con movimientos sacádicos, acciones en reposo (mirar alrededor, cambiar de postura, inclinar la cabeza), posturas al escuchar y al pensar, gestos de explicación que se alternan al hablar con énfasis en las palabras, y boca por sílabas con visemas. La sincronía labial es aproximada (por posición en el texto o eventos de palabra del motor de voz); con la voz de OpenAI se usa el volumen real del audio. |
| SmartTasks | Generación desde una instrucción, un PDF, un resumen, la clase con el profesor o tus errores reales; dificultad 1–5 o adaptativa; criterios de evaluación, pistas progresivas y solución paso a paso (que no se muestra antes de intentar); guardado automático; corrección automática de objetivas y por criterios en abiertas, con revisión manual; refuerzo desde errores y comparación de dominio; exportación a PDF con y sin soluciones; fecha de entrega en el calendario; actividades con gráficos, tablas, diagramas y simulaciones 3D. |
| Exámenes | Opción múltiple, V/F, respuesta corta, completar, relacionar, desarrollo y problemas. Práctica (comprobar al instante) o simulacro con tiempo. Nota, respuestas, explicaciones, errores frecuentes y temas a repasar. |
| Flashcards | SM-2 documentado en `docs/SRS.md`, edición manual, imágenes, fórmulas, historial y retención estimada. |
| Laboratorio 3D | Tiro oblicuo, péndulo (RK4), moléculas, separación magnética, célula animal/vegetal, sistema solar, superficies z=f(x,y) y sólidos. Cada uno aclara qué simplifica. |
| Pizarra | Lápiz, formas, flechas, texto, fórmulas LaTeX, gráficos de funciones, imágenes, deshacer, sesiones guardadas. Explicación paso a paso con IA y pasos para que el estudiante complete (verificación numérica o algebraica). |
| Estudio de video | Guion con IA sobre plantillas programáticas (tipografía cinética, ideas clave, diagramas, procesos, comparaciones, fórmulas, gráficos, quiz) y 8 escenas 3D, presentador 3D, transiciones, subtítulos, vista previa narrada y exportación MP4/WebM. La voz del dispositivo no puede grabarse dentro del archivo: para incluir narración hace falta la voz de OpenAI. No genera video fotorrealista ni escenas arbitrarias. |
| Voz | Dictado y lectura con el motor del sistema en Android (plugins nativos) o Web Speech API en el navegador. Estados visibles (escuchando, procesando, respondiendo, desactivado, permiso denegado) y alternativa escrita si no hay soporte. |
| Cuentas | Perfil local, bloqueo con PIN (PBKDF2), exportar/importar copia de seguridad y borrar todos los datos. **No hay** cuenta en la nube, sincronización ni recuperación de cuenta: requieren un servidor que esta versión no incluye. |

## Desarrollo

```bash
cd studyos
npm install
npm run dev          # http://localhost:5173
npm run check        # tipos (TypeScript)
npm test             # pruebas unitarias (Vitest)
npm run build && npm run test:e2e   # pruebas funcionales en Chromium con IA simulada
npm run android:apk  # APK local (requiere Android SDK)
```

### Arquitectura

- **Interfaz**: React 19 + TypeScript + Vite, Tailwind CSS 4, Framer Motion, Zustand, React Router (hash), Recharts, React Flow, KaTeX.
- **Datos**: Dexie (IndexedDB) en `src/lib/db.ts`; persistencia solicitada al sistema; todo con guardado automático.
- **IA** (`src/ai`): adaptadores para Anthropic (SDK oficial), OpenAI/compatibles, Gemini y Ollama; salida JSON validada con zod y un reintento de reparación; RAG con BM25 local y embeddings opcionales.
- **Agentes** (`src/ai/agents`): Tutor, Document, Summary, Exam, Task Generator, Visual (mapas), Video Director, Study Planner, pizarra y Quality Reviewer. Comparten el modelo configurado con roles separados.
- **3D**: Three.js + React Three Fiber; avatares con `@pixiv/three-vrm`.
- **Documentos**: pdf.js, mammoth (DOCX), JSZip (PPTX), Tesseract.js (OCR local, datos incluidos).
- **Android**: Capacitor 8 con plugins de voz, texto a voz, notificaciones locales, archivos y compartir.

### Pruebas

- `tests/`: corrección automática, SM-2, parser matemático, planificador, búsqueda BM25 y citas, dominio adaptativo y racha.
- `e2e/smoke.mjs`: 19 recorridos completos (las 8 pruebas funcionales pedidas y las 8 de SmartTasks, más OCR, flashcards y planificador). Usa `e2e/mock-ai.mjs`, un servidor **simulado** compatible con OpenAI que devuelve respuestas fijas, para probar los flujos sin una clave real. No reemplaza probar con un proveedor real.

### Créditos

- Seed-san © VirtualCast, Inc. y VRM1_Constraint_Twist_Sample © pixiv Inc. — VRM Public License 1.0.
- RobotExpressive de Tomás Laulhé (Quaternius) — CC0.
- Detalle en `public/models/LICENSES.md`.
