"""Validación de las preferencias de JARVIS y de privacidad (NEXUS 2.0)."""

from __future__ import annotations

import re
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.errors import NexusError

QUICK_ACTIONS = ["whatsapp", "reminder", "research", "project", "agenda", "document", "memory", "mission"]
MEMORY_CATEGORIES = ["personal", "preferences", "work", "projects", "health", "contacts", "general"]
PROACTIVE_LEVELS = ["off", "low", "normal", "high"]
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

DEFAULT_JARVIS = {
    "confirm_local_actions": False,
    "quick_actions": [{"key": k, "visible": True} for k in QUICK_ACTIONS],
    "proactive": {"level": "normal", "quiet_hours": {"start": "23:00", "end": "08:00"}, "categories": ["missions", "approvals", "reminders"],
                  "max_per_day": 10},
    "advanced_view": False,
}
DEFAULT_PRIVACY = {
    "disabled_memory_categories": [],
    "crash_reports_consent": False,
    "share_contacts_with_models": False,  # informativo: los contactos nunca se envían a modelos
}


def jarvis_view(stored: dict[str, Any] | None) -> dict[str, Any]:
    data = {**DEFAULT_JARVIS, **{k: v for k, v in (stored or {}).items() if k != "permissions_v2"}}
    return data


def privacy_view(stored: dict[str, Any] | None) -> dict[str, Any]:
    return {**DEFAULT_PRIVACY, **(stored or {}), "share_contacts_with_models": False}


def merge_jarvis(stored: dict[str, Any] | None, patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(stored or {})
    for key, value in patch.items():
        if key == "confirm_local_actions" or key == "advanced_view":
            out[key] = bool(value)
        elif key == "timezone":
            try:
                ZoneInfo(str(value))
            except (ZoneInfoNotFoundError, ValueError) as exc:
                raise NexusError(f"Zona horaria inválida: {value}") from exc
            out[key] = str(value)
        elif key == "quick_actions":
            if not isinstance(value, list):
                raise NexusError("quick_actions debe ser una lista")
            seen, clean = set(), []
            for item in value:
                k = item.get("key") if isinstance(item, dict) else None
                if k not in QUICK_ACTIONS or k in seen:
                    raise NexusError(f"Acción rápida inválida o repetida: {k}")
                seen.add(k)
                clean.append({"key": k, "visible": bool(item.get("visible", True))})
            for k in QUICK_ACTIONS:  # las que falten quedan al final, ocultas
                if k not in seen:
                    clean.append({"key": k, "visible": False})
            out[key] = clean
        elif key == "proactive":
            if not isinstance(value, dict):
                raise NexusError("proactive debe ser un objeto")
            cur = {**DEFAULT_JARVIS["proactive"], **(out.get("proactive") or {})}
            if "level" in value:
                if value["level"] not in PROACTIVE_LEVELS:
                    raise NexusError(f"Nivel proactivo inválido: {', '.join(PROACTIVE_LEVELS)}")
                cur["level"] = value["level"]
            if "quiet_hours" in value:
                q = value["quiet_hours"] or {}
                if q and not (_HHMM.match(str(q.get("start", ""))) and _HHMM.match(str(q.get("end", "")))):
                    raise NexusError("Horario de silencio inválido (HH:MM)")
                cur["quiet_hours"] = {"start": q.get("start"), "end": q.get("end")} if q else {}
            if "categories" in value:
                cur["categories"] = [str(c)[:30] for c in (value["categories"] or [])][:10]
            if "max_per_day" in value:
                cur["max_per_day"] = max(0, min(int(value["max_per_day"]), 50))
            if "timezone" in value:
                cur["timezone"] = str(value["timezone"])
            out["proactive"] = cur
        else:
            raise NexusError(f"Preferencia de JARVIS desconocida: {key}")
    return out


def merge_privacy(stored: dict[str, Any] | None, patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(stored or {})
    for key, value in patch.items():
        if key == "disabled_memory_categories":
            cats = [c for c in (value or []) if c in MEMORY_CATEGORIES]
            if len(cats) != len(value or []):
                raise NexusError(f"Categorías válidas: {', '.join(MEMORY_CATEGORIES)}")
            out[key] = sorted(set(cats))
        elif key == "crash_reports_consent":
            out[key] = bool(value)
        elif key == "share_contacts_with_models":
            if value:
                raise NexusError("Los contactos nunca se comparten con modelos de IA")
        else:
            raise NexusError(f"Preferencia de privacidad desconocida: {key}")
    return out
