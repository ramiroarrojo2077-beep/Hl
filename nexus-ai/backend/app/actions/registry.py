"""Action Registry de NEXUS 2.0.

Cada acción declara: ID, descripción, parámetros (JSON Schema reducido), permisos de
Android necesarios, nivel de riesgo, validación, si requiere confirmación, quién la
ejecuta y cómo se registra el resultado.

- executor="device": la ejecuta la app Android con APIs oficiales (intents). El backend
  solo guarda la propuesta, la confirmación y el resultado que informa el dispositivo.
- executor="server": la ejecuta el backend al confirmarse y verifica el resultado
  releyendo lo que creó.

Riesgo (capítulo 5) y clase de operación (capítulo 14):
  READ_ONLY            → lectura
  LOCAL_REVERSIBLE     → creación / modificación local que se deshace fácil
  EXTERNAL_COMMUNICATION → comunicación con terceros: confirmación SIEMPRE
  SENSITIVE            → datos personales o de cuentas: confirmación SIEMPRE
  IRREVERSIBLE         → borrado u operaciones sin vuelta atrás: confirmación SIEMPRE
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any


class Risk(StrEnum):
    READ_ONLY = "READ_ONLY"
    LOCAL_REVERSIBLE = "LOCAL_REVERSIBLE"
    EXTERNAL_COMMUNICATION = "EXTERNAL_COMMUNICATION"
    SENSITIVE = "SENSITIVE"
    IRREVERSIBLE = "IRREVERSIBLE"


# Riesgos cuya confirmación humana no se puede desactivar.
ALWAYS_CONFIRM = {Risk.EXTERNAL_COMMUNICATION, Risk.SENSITIVE, Risk.IRREVERSIBLE}

Validator = Callable[[dict[str, Any]], str | None]


@dataclass(frozen=True)
class ActionDef:
    key: str
    name: str
    description: str
    category: str  # categoría de intención de JARVIS
    risk: Risk
    operation: str  # lectura | creación | modificación | comunicación | irreversible
    executor: str  # device | server
    params: dict[str, dict[str, Any]]
    required: tuple[str, ...] = ()
    android_permissions: tuple[str, ...] = ()
    validator: Validator | None = None
    result_states: tuple[str, ...] = ("COMPLETED", "FAILED")
    notes: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def needs_confirmation(self, confirm_local: bool) -> bool:
        if self.risk in ALWAYS_CONFIRM:
            return True
        if self.risk == Risk.LOCAL_REVERSIBLE:
            return confirm_local
        return False

    def describe(self) -> dict[str, Any]:
        return {
            "key": self.key, "name": self.name, "description": self.description, "category": self.category,
            "risk": self.risk.value, "operation": self.operation, "executor": self.executor,
            "params": self.params, "required": list(self.required), "android_permissions": list(self.android_permissions),
            "always_confirm": self.risk in ALWAYS_CONFIRM, "result_states": list(self.result_states), "notes": self.notes,
        }


ACTIONS: dict[str, ActionDef] = {}


def _register(a: ActionDef) -> None:
    ACTIONS[a.key] = a


def _iso(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return dt.tzinfo is not None


def _validate_alarm(p: dict[str, Any]) -> str | None:
    h, m = p.get("hour"), p.get("minute", 0)
    if not isinstance(h, int) or not 0 <= h <= 23:
        return "La hora debe estar entre 0 y 23"
    if not isinstance(m, int) or not 0 <= m <= 59:
        return "Los minutos deben estar entre 0 y 59"
    return None


def _validate_timer(p: dict[str, Any]) -> str | None:
    s = p.get("seconds")
    if not isinstance(s, int) or not 1 <= s <= 86_400:
        return "El temporizador debe durar entre 1 segundo y 24 horas"
    return None


def _validate_event(p: dict[str, Any]) -> str | None:
    if not _iso(p.get("start")):
        return "El inicio del evento debe ser una fecha ISO 8601 con zona horaria"
    if p.get("end") is not None and not _iso(p["end"]):
        return "El fin del evento debe ser una fecha ISO 8601 con zona horaria"
    return None


def _validate_reminder(p: dict[str, Any]) -> str | None:
    if not _iso(p.get("at")):
        return "La fecha del recordatorio debe ser ISO 8601 con zona horaria"
    return None


def _validate_url(p: dict[str, Any]) -> str | None:
    url = p.get("url", "")
    if not isinstance(url, str) or not url.startswith("https://"):
        return "Solo se abren direcciones https://"
    return None


_PHONE_RE = re.compile(r"^\+?[0-9]{6,16}$")


def _validate_phone_optional(p: dict[str, Any]) -> str | None:
    phone = p.get("phone")
    if phone and not _PHONE_RE.match(str(phone)):
        return "Número de teléfono inválido"
    if not phone and not p.get("recipient_query"):
        return "Falta el destinatario"
    return None


S = {"type": "string"}
I = {"type": "integer"}
B = {"type": "boolean"}

SETTINGS_PANELS = ["general", "wifi", "bluetooth", "display", "sound", "battery", "location", "apps", "notifications",
                   "data", "airplane", "nfc", "accessibility", "date", "language", "security", "storage"]

# ------------------------------------------------------------------ dispositivo

_register(ActionDef(
    key="whatsapp.open_chat", name="Preparar WhatsApp",
    description="Prepara un mensaje y abre WhatsApp con el texto listo (Click to Chat). El envío lo confirma el usuario dentro de WhatsApp.",
    category="communication", risk=Risk.EXTERNAL_COMMUNICATION, operation="comunicación", executor="device",
    params={"recipient_query": {**S, "maxLength": 120}, "phone": {**S, "maxLength": 20}, "contact_label": {**S, "maxLength": 120},
            "text": {**S, "maxLength": 4000}, "tone": {**S, "enum": ["original", "informal", "formal", "amistoso", "breve", "profesional", "explicativo"]}},
    validator=_validate_phone_optional,
    result_states=("DRAFT_CREATED", "CONTACT_RESOLVED", "AWAITING_CONFIRMATION", "READY_TO_OPEN", "WHATSAPP_OPENED", "CANCELLED", "ERROR"),
    notes="NEXUS nunca informa 'enviado': abrir WhatsApp no es enviar. El número se resuelve en el teléfono.",
))
_register(ActionDef(
    key="device.dial", name="Preparar llamada",
    description="Abre el marcador con el número cargado. La llamada la inicia el usuario.",
    category="communication", risk=Risk.EXTERNAL_COMMUNICATION, operation="comunicación", executor="device",
    params={"recipient_query": {**S, "maxLength": 120}, "phone": {**S, "maxLength": 20}, "contact_label": {**S, "maxLength": 120}},
    validator=_validate_phone_optional, result_states=("DIALER_OPENED", "CANCELLED", "ERROR"),
))
_register(ActionDef(
    key="device.share_text", name="Compartir texto",
    description="Abre el selector de Android para compartir un texto con la app que elija el usuario.",
    category="communication", risk=Risk.EXTERNAL_COMMUNICATION, operation="comunicación", executor="device",
    params={"text": {**S, "maxLength": 8000}, "title": {**S, "maxLength": 120}}, required=("text",),
    result_states=("SHARE_SHEET_OPENED", "CANCELLED", "ERROR"),
))
_register(ActionDef(
    key="device.share_file", name="Compartir documento",
    description="El usuario elige un archivo con el selector del sistema y se abre el menú de compartir.",
    category="communication", risk=Risk.EXTERNAL_COMMUNICATION, operation="comunicación", executor="device",
    params={"title": {**S, "maxLength": 120}}, result_states=("SHARE_SHEET_OPENED", "CANCELLED", "ERROR"),
))
_register(ActionDef(
    key="device.open_app", name="Abrir aplicación",
    description="Abre una aplicación instalada por su nombre (intent de lanzamiento oficial).",
    category="phone_control", risk=Risk.LOCAL_REVERSIBLE, operation="lectura", executor="device",
    params={"app": {**S, "maxLength": 80}}, required=("app",), result_states=("APP_OPENED", "APP_NOT_FOUND", "ERROR"),
))
_register(ActionDef(
    key="device.open_settings", name="Abrir configuración",
    description="Abre una pantalla de configuración del sistema. No modifica ajustes protegidos.",
    category="phone_control", risk=Risk.READ_ONLY, operation="lectura", executor="device",
    params={"panel": {**S, "enum": SETTINGS_PANELS}}, required=("panel",), result_states=("SETTINGS_OPENED", "ERROR"),
))
_register(ActionDef(
    key="device.navigate", name="Preparar navegación",
    description="Abre la app de mapas con la ruta hacia un destino. La navegación la inicia el usuario.",
    category="phone_control", risk=Risk.READ_ONLY, operation="lectura", executor="device",
    params={"destination": {**S, "maxLength": 200}, "mode": {**S, "enum": ["driving", "walking", "transit", "bicycling"]}},
    required=("destination",), result_states=("MAPS_OPENED", "ERROR"),
))
_register(ActionDef(
    key="device.map_search", name="Buscar en el mapa",
    description="Busca un lugar en la app de mapas.",
    category="phone_control", risk=Risk.READ_ONLY, operation="lectura", executor="device",
    params={"query": {**S, "maxLength": 200}}, required=("query",), result_states=("MAPS_OPENED", "ERROR"),
))
_register(ActionDef(
    key="device.set_alarm", name="Programar alarma",
    description="Crea una alarma en la app Reloj (AlarmClock.ACTION_SET_ALARM).",
    category="productivity", risk=Risk.LOCAL_REVERSIBLE, operation="creación", executor="device",
    params={"hour": I, "minute": I, "label": {**S, "maxLength": 100}}, required=("hour",),
    android_permissions=("com.android.alarm.permission.SET_ALARM",), validator=_validate_alarm,
    result_states=("ALARM_SET", "ERROR"),
))
_register(ActionDef(
    key="device.set_timer", name="Iniciar temporizador",
    description="Inicia un temporizador en la app Reloj (AlarmClock.ACTION_SET_TIMER).",
    category="productivity", risk=Risk.LOCAL_REVERSIBLE, operation="creación", executor="device",
    params={"seconds": I, "label": {**S, "maxLength": 100}}, required=("seconds",),
    android_permissions=("com.android.alarm.permission.SET_ALARM",), validator=_validate_timer,
    result_states=("TIMER_SET", "ERROR"),
))
_register(ActionDef(
    key="device.calendar_event", name="Preparar evento",
    description="Abre el calendario con un evento precargado (CalendarContract). El usuario lo guarda en su calendario.",
    category="organization", risk=Risk.LOCAL_REVERSIBLE, operation="creación", executor="device",
    params={"title": {**S, "maxLength": 200}, "start": {**S, "maxLength": 40}, "end": {**S, "maxLength": 40},
            "all_day": B, "location": {**S, "maxLength": 200}, "description": {**S, "maxLength": 2000}},
    required=("title", "start"), validator=_validate_event, result_states=("CALENDAR_OPENED", "ERROR"),
))
_register(ActionDef(
    key="device.calendar_view", name="Consultar agenda",
    description="Abre el calendario del teléfono en una fecha. NEXUS no lee los eventos del calendario.",
    category="organization", risk=Risk.READ_ONLY, operation="lectura", executor="device",
    params={"date": {**S, "maxLength": 40}}, result_states=("CALENDAR_OPENED", "ERROR"),
))
_register(ActionDef(
    key="device.contact_create", name="Crear contacto",
    description="Abre la app de contactos con un contacto precargado para que el usuario lo guarde.",
    category="organization", risk=Risk.SENSITIVE, operation="creación", executor="device",
    params={"name": {**S, "maxLength": 120}, "phone": {**S, "maxLength": 20}}, required=("name",),
    result_states=("CONTACTS_OPENED", "ERROR"),
))
_register(ActionDef(
    key="device.open_url", name="Abrir enlace",
    description="Abre una dirección https:// en el navegador.",
    category="information", risk=Risk.READ_ONLY, operation="lectura", executor="device",
    params={"url": {**S, "maxLength": 2000}}, required=("url",), validator=_validate_url,
    result_states=("BROWSER_OPENED", "ERROR"),
))
_register(ActionDef(
    key="app.open_screen", name="Abrir sección de NEXUS",
    description="Navega a una sección de la app (proyecto, misión, memoria, agenda de automatizaciones...).",
    category="project_management", risk=Risk.READ_ONLY, operation="lectura", executor="device",
    params={"screen": {**S, "enum": ["project", "projects", "mission", "missions", "memory", "automations", "approvals", "agents", "meetings", "settings"]},
            "entity_id": {**S, "maxLength": 40}, "label": {**S, "maxLength": 200}},
    required=("screen",), result_states=("SCREEN_OPENED", "ERROR"),
))

# ------------------------------------------------------------------ servidor

_register(ActionDef(
    key="reminder.create", name="Crear recordatorio",
    description="Programa un recordatorio: llega como notificación push y dentro de la app.",
    category="productivity", risk=Risk.LOCAL_REVERSIBLE, operation="creación", executor="server",
    params={"title": {**S, "maxLength": 200}, "body": {**S, "maxLength": 1000}, "at": {**S, "maxLength": 40}},
    required=("title", "at"), validator=_validate_reminder,
))
_register(ActionDef(
    key="memory.remember", name="Guardar en memoria",
    description="Guarda un dato personal que el usuario pidió recordar, con su procedencia.",
    category="memory_query", risk=Risk.SENSITIVE, operation="creación", executor="server",
    params={"content": {**S, "maxLength": 2000}, "category": {**S, "maxLength": 30}}, required=("content",),
))
_register(ActionDef(
    key="memory.forget", name="Olvidar recuerdos",
    description="Elimina definitivamente los recuerdos indicados.",
    category="memory_query", risk=Risk.IRREVERSIBLE, operation="irreversible", executor="server",
    params={"memory_ids": {"type": "array"}, "query": {**S, "maxLength": 300}}, required=("memory_ids",),
))
_register(ActionDef(
    key="mission.create", name="Crear misión",
    description="Crea una misión: NEXUS planifica, asigna agentes y ejecuta en segundo plano (consume presupuesto).",
    category="project_management", risk=Risk.LOCAL_REVERSIBLE, operation="creación", executor="server",
    params={"title": {**S, "maxLength": 200}, "objective": {**S, "maxLength": 4000}, "project_id": {**S, "maxLength": 40}},
    required=("objective",), extra={"force_confirm": True},
))
_register(ActionDef(
    key="automation.create", name="Crear automatización",
    description="Crea una rutina con disparador, condiciones, acciones y límites. Queda activa al confirmarla.",
    category="automation", risk=Risk.LOCAL_REVERSIBLE, operation="creación", executor="server",
    params={"name": {**S, "maxLength": 200}, "trigger_type": {**S, "enum": ["schedule", "date", "event"]},
            "cron": {**S, "maxLength": 120}, "run_at": {**S, "maxLength": 40}, "timezone": {**S, "maxLength": 60},
            "event_type": {**S, "maxLength": 60}, "conditions": {"type": "object"}, "actions": {"type": "array"},
            "max_runs_per_day": I},
    required=("name", "trigger_type", "actions"), extra={"force_confirm": True},
))
_register(ActionDef(
    key="whatsapp.business_send", name="Enviar por WhatsApp Business",
    description="Envía un mensaje por la API oficial de WhatsApp Business Platform (credenciales solo en el servidor).",
    category="communication", risk=Risk.EXTERNAL_COMMUNICATION, operation="comunicación", executor="server",
    params={"phone": {**S, "maxLength": 20}, "text": {**S, "maxLength": 4096}, "template_name": {**S, "maxLength": 120},
            "template_language": {**S, "maxLength": 12}, "template_params": {"type": "array"}, "opt_in_confirmed": B,
            "contact_label": {**S, "maxLength": 120}},
    required=("phone",),
    result_states=("ACCEPTED", "SENT", "DELIVERED", "READ", "FAILED"),
    notes="Los estados vienen de la API y sus webhooks; nunca se infieren.",
))


def get_action(key: str) -> ActionDef | None:
    return ACTIONS.get(key)


def validate_params(action: ActionDef, params: dict[str, Any]) -> str | None:
    type_map = {"string": str, "integer": int, "boolean": bool, "array": list, "object": dict}
    for req in action.required:
        if params.get(req) in (None, "", []):
            return f"Falta el parámetro «{req}»"
    for name, value in params.items():
        spec = action.params.get(name)
        if spec is None:
            return f"Parámetro desconocido «{name}»"
        if value is None:
            continue
        py = type_map.get(spec.get("type", ""))
        if py and (not isinstance(value, py) or (py is int and isinstance(value, bool))):
            return f"El parámetro «{name}» debe ser {spec['type']}"
        if "enum" in spec and value not in spec["enum"]:
            return f"«{name}» debe ser uno de: {', '.join(spec['enum'])}"
        if "maxLength" in spec and isinstance(value, str) and len(value) > spec["maxLength"]:
            return f"«{name}» supera {spec['maxLength']} caracteres"
    if action.validator is not None:
        return action.validator(params)
    return None
