"""Personaje de cada agente: rasgos de personalidad y emocionales, apariencia y voz.

Los rasgos no son decorativos: se traducen a instrucciones de tono y enfoque dentro del
prompt del agente (sin tocar nunca sus políticas de seguridad ni su rigor técnico).
La apariencia la dibuja la app Android y la voz la reproduce el TTS del dispositivo.
"""

from __future__ import annotations

import re
from typing import Any

# eje -> (etiqueta izquierda, etiqueta derecha). El valor (0-100) indica cuánto tiende a la derecha.
PERSONALITY_AXES: dict[str, tuple[str, str]] = {
    "introvert_extrovert": ("introvertido", "extrovertido"),
    "analytical_creative": ("analítico", "creativo"),
    "calm_energetic": ("sereno", "enérgico"),
    "curious_cautious": ("curioso y exploratorio", "cauteloso y conservador"),
    "playful_serious": ("lúdico", "serio"),
}
EMOTIONAL_TRAITS: dict[str, str] = {
    "empathy": "empatía",
    "patience": "paciencia",
    "optimism": "optimismo",
    "assertiveness": "asertividad",
}
APPEARANCE_OPTIONS: dict[str, list[str]] = {
    "body": ["a", "b"],
    "hair": ["short", "long", "asymmetric", "buzz", "ponytail", "mohawk", "helmet"],
    "outfit": ["suit", "armor", "coat", "jacket", "robe"],
    "accessory": ["none", "visor", "headset", "glasses", "halo"],
}
APPEARANCE_COLORS = ("hair_color", "eyes", "skin", "outfit_color", "accent")
VOICE_TONES = ["warm", "neutral", "bright", "deep"]
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_LOCALE = re.compile(r"^[a-z]{2}(-[A-Z]{2})?$")


class PersonaError(ValueError):
    pass


def _clamp_int(value: Any, name: str) -> int:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise PersonaError(f"«{name}» debe ser un número entre 0 y 100")
    return int(max(0, min(100, round(value))))


def validate_traits(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"personality": {}, "emotions": {}}
    for key, value in (data.get("personality") or {}).items():
        if key not in PERSONALITY_AXES:
            raise PersonaError(f"Rasgo de personalidad desconocido: {key}")
        out["personality"][key] = _clamp_int(value, key)
    for key, value in (data.get("emotions") or {}).items():
        if key not in EMOTIONAL_TRAITS:
            raise PersonaError(f"Rasgo emocional desconocido: {key}")
        out["emotions"][key] = _clamp_int(value, key)
    return out


def validate_appearance(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in data.items():
        if key in APPEARANCE_OPTIONS:
            if value not in APPEARANCE_OPTIONS[key]:
                raise PersonaError(f"Valor inválido para {key}: {value}")
            out[key] = value
        elif key in APPEARANCE_COLORS:
            if not isinstance(value, str) or not _HEX.match(value):
                raise PersonaError(f"{key} debe ser un color #RRGGBB")
            out[key] = value.upper()
        else:
            raise PersonaError(f"Atributo de apariencia desconocido: {key}")
    return out


def validate_voice(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in data.items():
        if key in ("pitch", "rate"):
            if not isinstance(value, (int, float)) or not 0.5 <= float(value) <= 2.0:
                raise PersonaError(f"{key} debe estar entre 0.5 y 2.0")
            out[key] = round(float(value), 2)
        elif key == "locale":
            if not isinstance(value, str) or not _LOCALE.match(value):
                raise PersonaError("locale debe tener formato es-AR, en-US…")
            out[key] = value
        elif key == "tone":
            if value not in VOICE_TONES:
                raise PersonaError(f"tone debe ser uno de {', '.join(VOICE_TONES)}")
            out[key] = value
        elif key == "enabled":
            out[key] = bool(value)
        else:
            raise PersonaError(f"Atributo de voz desconocido: {key}")
    return out


def _level(v: int) -> str:
    if v >= 80:
        return "muy alta"
    if v >= 60:
        return "alta"
    if v >= 40:
        return "moderada"
    if v >= 20:
        return "baja"
    return "muy baja"


def traits_prompt(traits: dict[str, Any]) -> str:
    """Convierte los rasgos en indicaciones de comportamiento para el prompt."""
    lines: list[str] = []
    for key, value in (traits.get("personality") or {}).items():
        left, right = PERSONALITY_AXES.get(key, (None, None))
        if left is None:
            continue
        if value >= 65:
            lines.append(f"- Tendés claramente a lo {right} ({value}/100 hacia {right}).")
        elif value <= 35:
            lines.append(f"- Tendés claramente a lo {left} ({100 - value}/100 hacia {left}).")
        else:
            lines.append(f"- Equilibrás lo {left} y lo {right} ({value}/100).")
    for key, value in (traits.get("emotions") or {}).items():
        label = EMOTIONAL_TRAITS.get(key)
        if label:
            lines.append(f"- {label.capitalize()}: {_level(value)} ({value}/100).")
    if not lines:
        return ""
    return (
        "# Rasgos de tu personaje (modulan tu tono y tu enfoque; nunca tus políticas, tu honestidad ni tu rigor)\n"
        + "\n".join(lines)
    )


DEFAULT_PERSONAS: dict[str, dict[str, Any]] = {
    "nexus": {
        "traits": {"personality": {"introvert_extrovert": 60, "analytical_creative": 40, "calm_energetic": 35,
                                   "curious_cautious": 55, "playful_serious": 75},
                   "emotions": {"empathy": 70, "patience": 80, "optimism": 65, "assertiveness": 80}},
        "appearance": {"body": "a", "hair": "short", "hair_color": "#C9D6E8", "eyes": "#00D9FF", "skin": "#E8C4A8",
                       "outfit": "suit", "outfit_color": "#16324A", "accent": "#00D9FF", "accessory": "headset"},
        "voice": {"pitch": 0.95, "rate": 1.0, "locale": "es-AR", "tone": "neutral", "enabled": True},
    },
    "atlas": {
        "traits": {"personality": {"introvert_extrovert": 40, "analytical_creative": 30, "calm_energetic": 45,
                                   "curious_cautious": 25, "playful_serious": 65},
                   "emotions": {"empathy": 60, "patience": 85, "optimism": 60, "assertiveness": 55}},
        "appearance": {"body": "b", "hair": "ponytail", "hair_color": "#3B2A20", "eyes": "#38D99B", "skin": "#C68E65",
                       "outfit": "coat", "outfit_color": "#1E3B32", "accent": "#38D99B", "accessory": "glasses"},
        "voice": {"pitch": 1.1, "rate": 1.0, "locale": "es-AR", "tone": "warm", "enabled": True},
    },
    "cipher": {
        "traits": {"personality": {"introvert_extrovert": 25, "analytical_creative": 20, "calm_energetic": 40,
                                   "curious_cautious": 45, "playful_serious": 70},
                   "emotions": {"empathy": 45, "patience": 70, "optimism": 55, "assertiveness": 70}},
        "appearance": {"body": "a", "hair": "mohawk", "hair_color": "#8A5CFF", "eyes": "#B69CFF", "skin": "#F1D3BC",
                       "outfit": "jacket", "outfit_color": "#221A3D", "accent": "#8A5CFF", "accessory": "visor"},
        "voice": {"pitch": 0.9, "rate": 1.1, "locale": "es-AR", "tone": "neutral", "enabled": True},
    },
    "nova": {
        "traits": {"personality": {"introvert_extrovert": 70, "analytical_creative": 85, "calm_energetic": 60,
                                   "curious_cautious": 10, "playful_serious": 25},
                   "emotions": {"empathy": 95, "patience": 80, "optimism": 88, "assertiveness": 50}},
        "appearance": {"body": "b", "hair": "asymmetric", "hair_color": "#5FB6D9", "eyes": "#4B3BBF", "skin": "#F3D5C3",
                       "outfit": "jacket", "outfit_color": "#1A2230", "accent": "#FF6FB5", "accessory": "none"},
        "voice": {"pitch": 1.15, "rate": 1.0, "locale": "es-AR", "tone": "bright", "enabled": True},
    },
    "oracle": {
        "traits": {"personality": {"introvert_extrovert": 35, "analytical_creative": 15, "calm_energetic": 20,
                                   "curious_cautious": 60, "playful_serious": 85},
                   "emotions": {"empathy": 55, "patience": 90, "optimism": 45, "assertiveness": 75}},
        "appearance": {"body": "a", "hair": "long", "hair_color": "#E9E4D8", "eyes": "#FFC24B", "skin": "#8D5A3B",
                       "outfit": "robe", "outfit_color": "#2E2614", "accent": "#FFC24B", "accessory": "halo"},
        "voice": {"pitch": 0.85, "rate": 0.95, "locale": "es-AR", "tone": "deep", "enabled": True},
    },
    "guardian": {
        "traits": {"personality": {"introvert_extrovert": 30, "analytical_creative": 25, "calm_energetic": 30,
                                   "curious_cautious": 85, "playful_serious": 90},
                   "emotions": {"empathy": 50, "patience": 75, "optimism": 40, "assertiveness": 90}},
        "appearance": {"body": "a", "hair": "helmet", "hair_color": "#2A2F3A", "eyes": "#FF5C5C", "skin": "#D9A982",
                       "outfit": "armor", "outfit_color": "#2B1518", "accent": "#FF5C5C", "accessory": "visor"},
        "voice": {"pitch": 0.8, "rate": 0.95, "locale": "es-AR", "tone": "deep", "enabled": True},
    },
}

GENERIC_PERSONA: dict[str, Any] = {
    "traits": {"personality": {k: 50 for k in PERSONALITY_AXES}, "emotions": {k: 60 for k in EMOTIONAL_TRAITS}},
    "appearance": {"body": "a", "hair": "short", "hair_color": "#4A4F5C", "eyes": "#00D9FF", "skin": "#E0B899",
                   "outfit": "suit", "outfit_color": "#1A2433", "accent": "#00D9FF", "accessory": "none"},
    "voice": {"pitch": 1.0, "rate": 1.0, "locale": "es-AR", "tone": "neutral", "enabled": True},
}


def persona_catalog() -> dict[str, Any]:
    return {
        "personality_axes": [{"key": k, "left": l, "right": r} for k, (l, r) in PERSONALITY_AXES.items()],
        "emotional_traits": [{"key": k, "label": v} for k, v in EMOTIONAL_TRAITS.items()],
        "appearance_options": APPEARANCE_OPTIONS,
        "appearance_colors": list(APPEARANCE_COLORS),
        "voice_tones": VOICE_TONES,
        "presets": {slug: p["appearance"] for slug, p in DEFAULT_PERSONAS.items()},
    }
