# Proveedores de IA, modelos y plugins

Todo se configura desde la app (**Ajustes**) o por API. Las claves se guardan cifradas en el servidor; nunca en el
teléfono ni en el APK, y los agentes no tienen acceso a ellas.

## Proveedores soportados

| Tipo (`kind`) | URL base por defecto | Clave | Notas |
|---|---|---|---|
| `anthropic` | https://api.anthropic.com | obligatoria | tools, streaming, `effort` para modelos con capacidad *reasoning*, búsqueda web nativa del proveedor si el modelo tiene *web_search* |
| `openai` | https://api.openai.com/v1 | obligatoria | tools, streaming, `reasoning_effort`, embeddings `text-embedding-3-*` (768 dims) |
| `openai_compatible` | http://localhost:8000/v1 | opcional | OpenRouter, Groq, vLLM, LM Studio, Together, DeepSeek… |
| `gemini` | https://generativelanguage.googleapis.com/v1beta | obligatoria | tools, embeddings (`outputDimensionality` 768) |
| `ollama` | http://localhost:11434 | opcional | modelos locales; embeddings vía `/api/embed` (usar modelos de 768 dims, p. ej. `nomic-embed-text`) |

Pasos: **Agregar proveedor → Probar conexión** (lista los modelos reales de la cuenta) **→ tocar un modelo para
habilitarlo**. Las capacidades y la calidad se sugieren por nombre y se revisan en **Ajustes › Modelos**.

## Modelos

Para cada modelo: capacidades (`chat`, `tools`, `reasoning`, `code`, `vision`, `long_context`, `embedding`,
`web_search`), calidad 1-5, ventana de contexto, precio por millón de tokens de entrada/salida, predeterminado y
predeterminado para embeddings.

- **Router**: filtra por capacidades obligatorias (p. ej. `tools` si el agente usa herramientas) y contexto suficiente,
  exige una calidad mínima según el tipo de tarea (investigación/código/análisis/seguridad: 4; redacción/diseño: 3;
  resúmenes simples: 2), prefiere los modelos asignados al agente y la capacidad preferida, y solo usa el costo como
  desempate. Un modelo por debajo de la calidad requerida solo se usa si no hay otro, y queda registrado.
- **Fallback**: reintenta errores transitorios (429/5xx/timeouts) con backoff y luego pasa al siguiente modelo
  **compatible**; nunca a uno sin las capacidades que la tarea necesita. Si ninguno puede, la tarea falla con el motivo.
- **Asignación por agente**: Agente › Modelos (el primero es el principal).
- **Comparación** (Ajustes › Comparación de modelos): mismos casos sobre varios modelos; mide latencia, tokens, costo y
  errores, y un juez a ciegas puntúa calidad, precisión y cumplimiento de instrucciones sin premiar la longitud.

## Presupuestos

Límites diario y mensual, presupuesto por misión, por agente y tope de tokens por misión. Al alcanzarse: aviso
(`budget_reached`), las nuevas operaciones que lo exceden se detienen, la misión queda bloqueada y podés subir el
límite, cambiar de modelo o cancelar. Sin precios configurados el costo no se estima (y se indica).

## Plugins

| Plugin | Herramienta | Configuración | Clase de operación |
|---|---|---|---|
| `web_search` | `web.search` | proveedor `brave` o `tavily` + API key | lectura |
| `webhook` | `webhook.send` | URL https + cabecera secreta opcional | comunicación externa (requiere aprobación en modo supervisado) |
| `code_sandbox` | `code.execute` | — (requiere Docker en el worker) | modificación |

Cada plugin se activa por separado y cada permiso (`tool:...`) se concede o revoca explícitamente. Sin el plugin de
búsqueda, los modelos Anthropic con capacidad *web_search* pueden usar la búsqueda nativa del proveedor si el agente
tiene permiso `web.search`.
