"""Contact Manager (resolución de destinatarios por alias).

La agenda del teléfono NUNCA se sube: la app resuelve localmente (ContactResolver.kt, misma
lógica). Este endpoint existe para clientes que quieran resolver contra etiquetas que el
usuario eligió compartir (solo nombres/alias, sin números) y devuelve el candidato o la
ambigüedad para que el usuario elija.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from typing import Any

# Sinónimos coloquiales → alias canónico (se comparan sin acentos).
SYNONYMS = {
    "papa": ["papa", "papi", "viejo", "mi viejo", "pa", "padre", "pápa"],
    "mama": ["mama", "mami", "vieja", "mi vieja", "ma", "madre"],
    "hermano": ["hermano", "brother", "bro", "hermanito"],
    "hermana": ["hermana", "hermanita", "sis"],
    "abuelo": ["abuelo", "abu", "nono", "abuelito"],
    "abuela": ["abuela", "abu", "nona", "abuelita"],
    "novio": ["novio", "amor", "gordo"],
    "novia": ["novia", "amor", "gorda"],
    "esposo": ["esposo", "marido"],
    "esposa": ["esposa", "mujer", "señora"],
    "jefe": ["jefe", "jefa", "boss"],
}


def fold(text: str) -> str:
    s = unicodedata.normalize("NFD", text or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^(?:a\s+)?(?:mi|mis|el|la|los|las)\s+", "", s.strip())
    return re.sub(r"\s+", " ", s).strip()


def _canon(term: str) -> set[str]:
    f = fold(term)
    out = {f}
    for canon, words in SYNONYMS.items():
        if f == canon or f in (fold(w) for w in words):
            out.add(canon)
            out.update(fold(w) for w in words)
    return out


def score(query: str, label: str, aliases: list[str]) -> float:
    q = fold(query)
    names = [fold(label)] + [fold(a) for a in aliases]
    q_forms = _canon(query)
    best = 0.0
    for n in names:
        if not n:
            continue
        if n == q or n in q_forms or (_canon(n) & q_forms and n in q_forms | _canon(n)):
            if n == q:
                return 1.0
            best = max(best, 0.97 if n in q_forms else 0.9)
        first = n.split(" ")[0]
        if q == first:
            best = max(best, 0.9)
        if q and (n.startswith(q + " ") or (" " + q) in n):
            best = max(best, 0.82)
        best = max(best, difflib.SequenceMatcher(None, q, n).ratio() * 0.85)
    return round(best, 3)


def resolve(query: str, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    ranked = []
    for c in candidates:
        s = score(query, str(c.get("label", "")), [str(a) for a in c.get("aliases") or []])
        if c.get("favorite"):
            s += 0.02
        ranked.append({"id": c.get("id"), "label": c.get("label"), "score": round(min(s, 1.0), 3)})
    ranked = [r for r in ranked if r["score"] >= 0.6]
    ranked.sort(key=lambda r: r["score"], reverse=True)
    if not ranked:
        return {"status": "not_found", "matches": [], "message": f"No encontré a «{query}» entre tus contactos de NEXUS."}
    top = ranked[0]
    close = [r for r in ranked[1:] if top["score"] - r["score"] < 0.08]
    if top["score"] >= 0.9 and not close:
        return {"status": "resolved", "match": top, "matches": ranked[:5], "message": f"Destinatario: {top['label']}"}
    return {"status": "ambiguous", "matches": ranked[:5], "message": f"Hay varios contactos posibles para «{query}». ¿Cuál es?"}
