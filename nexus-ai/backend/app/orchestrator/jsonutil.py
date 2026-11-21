"""Extracción robusta de JSON de las respuestas de los modelos."""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.S)


class JSONExtractionError(ValueError):
    pass


def extract_json(text: str) -> Any:
    text = text.strip()
    candidates = [m.group(1) for m in _FENCE.finditer(text)]
    candidates.append(text)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    for raw in candidates:
        try:
            return json.loads(raw)
        except ValueError:
            continue
    raise JSONExtractionError("La respuesta no contiene un JSON válido")


def split_trailing_json(text: str) -> tuple[str, Any | None]:
    """Separa un bloque ```json final (p.ej. aprendizajes) del resto del texto."""
    matches = list(_FENCE.finditer(text))
    if not matches:
        return text.strip(), None
    last = matches[-1]
    if text[last.end():].strip():
        return text.strip(), None
    try:
        data = json.loads(last.group(1))
    except ValueError:
        return text.strip(), None
    return text[: last.start()].strip(), data
