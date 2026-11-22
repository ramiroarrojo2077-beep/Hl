# Informe de rendimiento — NEXUS 2.0

Fecha: 22/11/2026. Todas las cifras son mediciones reales en este entorno (contenedor Linux de 4 vCPU, sin GPU ni
dispositivo Android). Lo que no se pudo medir está al final, sin estimaciones inventadas.

## 1. Backend — prueba de carga

Herramienta: `backend/scripts/loadtest.py` (httpx asíncrono, usuarios reales registrados, sin caché del lado del
cliente). Servidor: `uvicorn app.main:app --workers 4`, PostgreSQL 16 + pgvector y Redis locales.

```bash
NEXUS_RATE_LIMIT_PER_MINUTE=100000 uvicorn app.main:app --workers 4 &
python scripts/loadtest.py http://127.0.0.1:8000 --requests 1800 --concurrency 16
```

**Resultado:** 1.800 solicitudes, concurrencia 16, **313 solicitudes/s, 0 errores**.
Global: p50 37,1 ms · p95 125,7 ms · p99 296,4 ms.

| Endpoint | p95 (ms) | Nota |
|---|---|---|
| `POST /jarvis/intent` | 56,0 | clasificador determinista, sin modelo |
| `GET /actions` | 46,8 | |
| `GET /automations` | 45,7 | |
| `GET /voice/settings` | 53,3 | |
| `GET /agents` | 64,4 | |
| `GET /jarvis/state` | 78,9 | incluye conteo de workers en Redis |
| `GET /jarvis/context` | 87,6 | |
| `GET /dashboard` | 112,5 | el endpoint más pesado de lectura |
| `POST /jarvis/message` (acción directa) | 265,8 (p99 414,1) | pipeline completo + escritura + verificación, sin modelo |

Hallazgo durante la prueba: con varios procesos de API arrancando a la vez, la sincronización del catálogo de
herramientas chocaba por clave duplicada. Se corrigió con un upsert atómico (`ON CONFLICT DO UPDATE`).

## 2. Personajes 3D — costo de render

Motor propio por software (malla paramétrica, z-buffer, sombreado Gouraud con Blinn-Phong + borde fresnel),
medido por `Characters3DTest.renderCostIsMeasured` (promedio de varios cuadros en la JVM de pruebas):

| Malla | Resolución del render | Tiempo promedio por cuadro |
|---|---|---|
| 13.756 triángulos · 8.051 vértices | 540 × 960 | 4,5 – 7,6 ms según la carga del contenedor (4 corridas) |

Medidas de cuidado de recursos incluidas:
- La animación de cuerpo completo se limita a ~24 cuadros/s.
- En listas y miniaturas, los personajes se dibujan una sola vez (`animated = false`).
- Las mallas se cachean (24 entradas).
- Con «movimiento reducido» no hay animación.

## 3. Tamaño de la app

| APK | 1.0.0 | 2.0.0 |
|---|---|---|
| Release (R8, firmada) | 2.569.928 bytes | **2.976.604 bytes** |
| Debug | 22.985.336 bytes | 24.717.890 bytes |

Las fuentes Rajdhani originales sumaban 1,55 MB porque incluyen el alfabeto devanagari. Se recortaron con
fontTools conservando todo el latín, la puntuación y los símbolos. Con eso, la release bajó de 3.440.092 a
2.976.604 bytes; la licencia OFL lo permite y queda documentado en `docs/licenses/`.

## 4. Pruebas automáticas

| Suite | Resultado | Duración |
|---|---|---|
| Backend (PostgreSQL + pgvector reales) | 96/96 | ~46 s |
| App (JVM + Robolectric, UI de punta a punta con capturas) | 28/28 | ~1,5 min |

## 5. No medido en este entorno (pendiente en un dispositivo real)

- **Primer fragmento de respuesta de un modelo real** (streaming): requiere una API key real; solo se midió el
  camino sin modelo y con dobles HTTP.
- **Arranque en frío de la app, cuadros por segundo reales y consumo de batería**: requieren un Android físico o
  un emulador con aceleración; aquí no hay ninguno.
- **Latencia del reconocimiento de voz y del barge-in con eco real** (altavoz → micrófono).
- **Palabra de activación**: consumo durante 30 minutos de escucha en el dispositivo.
