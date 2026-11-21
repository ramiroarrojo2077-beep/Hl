"""Etapas 2 y 4 de JARVIS CORE: comprensión y clasificación de intención.

Clasificador determinista (local, sin llamar a un modelo) para las órdenes frecuentes y
bien definidas: acciones del teléfono, WhatsApp, recordatorios, memoria, misiones,
automatizaciones y control de voz (barge-in). Lo que no encaja con seguridad se marca
como `needs_model` y lo resuelve NEXUS con el modelo adecuado. Así no se hace una llamada
enorme por cada pedido: solo se ejecutan las etapas necesarias.

Categorías (capítulo 1.3): conversation, research, productivity, communication,
programming, organization, automation, phone_control, project_management,
memory_query, information.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any

from app.jarvis.timeparse import When, parse_duration_seconds, parse_when, remove_spans

CATEGORIES = ("conversation", "research", "productivity", "communication", "programming", "organization", "automation",
              "phone_control", "project_management", "memory_query", "information")

TONES = {"formal": "formal", "informal": "informal", "amistoso": "amistoso", "amistosa": "amistoso", "cordial": "amistoso",
         "breve": "breve", "corto": "breve", "corta": "breve", "profesional": "profesional", "explicativo": "explicativo",
         "explicativa": "explicativo", "detallado": "explicativo"}

SETTINGS_WORDS = [
    ("wi fi", "wifi"), ("wifi", "wifi"), ("internet", "wifi"), ("bluetooth", "bluetooth"), ("pantalla", "display"),
    ("brillo", "display"), ("sonido", "sound"), ("volumen", "sound"), ("bateria", "battery"), ("ubicacion", "location"),
    ("gps", "location"), ("aplicaciones", "apps"), ("apps", "apps"), ("notificaciones", "notifications"),
    ("datos", "data"), ("modo avion", "airplane"), ("avion", "airplane"), ("nfc", "nfc"), ("accesibilidad", "accessibility"),
    ("fecha", "date"), ("hora", "date"), ("idioma", "language"), ("seguridad", "security"), ("almacenamiento", "storage"),
]
SCREEN_WORDS = [("automatizaciones", "automations"), ("rutinas", "automations"), ("aprobaciones", "approvals"),
                ("misiones", "missions"), ("memoria", "memory"), ("recuerdos", "memory"), ("agentes", "agents"),
                ("reuniones", "meetings"), ("proyectos", "projects"), ("configuracion de nexus", "settings")]

# Especialistas sugeridos por dominio (NEXUS decide si consultarlos con agents.ask).
SPECIALISTS = {"research": "atlas", "programming": "cipher", "creative": "nova", "analysis": "oracle", "security": "guardian"}

STYLE = {
    "conversation": ("breve: 1 o 2 frases, natural y cálido", 500, "chat"),
    "information": ("directa: primero la respuesta en 1-3 frases; ampliá solo si la pregunta lo exige", 1500, "general"),
    "research": ("informe: hallazgos clave, fuentes citadas y conclusión. Separá hechos de hipótesis", 4000, "research"),
    "programming": ("técnica y precisa; incluí código solo cuando aporte", 4000, "code"),
    "productivity": ("concreta y lista para usar", 2500, "writing"),
    "organization": ("ordenada en pasos o prioridades, sin relleno", 2000, "planning"),
    "automation": ("breve: qué rutina proponés, cuándo se dispara y qué hace", 1200, "general"),
    "project_management": ("breve: estado y próximos pasos", 1500, "general"),
    "memory_query": ("breve, citando la procedencia de cada recuerdo", 1000, "simple"),
    "communication": ("breve; nunca digas que un mensaje se envió si solo se preparó", 800, "writing"),
    "phone_control": ("muy breve: qué acción preparaste", 400, "simple"),
}


@dataclass
class Intent:
    category: str
    confidence: float
    rule: str
    action_key: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    summary: str | None = None
    missing: list[str] = field(default_factory=list)
    question: str | None = None
    control: str | None = None  # stop | resume | repeat (barge-in)
    needs_model: bool = False
    specialists: list[str] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def style(self) -> tuple[str, int, str]:
        return STYLE.get(self.category, STYLE["information"])

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        style, max_tokens, task_type = self.style
        d["route"] = {"task_type": task_type, "response_style": style, "max_tokens": max_tokens,
                      "specialists": self.specialists, "handler": self.handler}
        return d

    @property
    def handler(self) -> str:
        if self.control:
            return "control"
        if self.question:
            return "clarification"
        if self.action_key:
            return "action"
        if self.extra.get("memory_lookup") is not None:
            return "memory_lookup"
        if self.extra.get("memory_forget"):
            return "memory_forget"
        return "model"


def normalize(text: str) -> str:
    """Minúsculas y sin acentos, conservando la longitud (los índices coinciden con el original)."""
    out = []
    for ch in text:
        base = unicodedata.normalize("NFD", ch)[0].lower()
        out.append(base if len(base) == 1 else ch.lower()[:1])
    return "".join(out)


WAKE_RE = re.compile(r"^\s*(?:(?:che|hey|oye|ey|hola)[\s,]+)?nexus[\s,:.!]*", re.I)
FILLER_RE = re.compile(r"^\s*(?:por\s+favor|porfa|dale|bueno|che)[\s,]+")


def strip_wake(text: str) -> str:
    out = WAKE_RE.sub("", text, count=1)
    out = FILLER_RE.sub("", out, count=1)
    out = re.sub(r"[\s,]*(?:por\s+favor|porfa)[.!]*\s*$", "", out, flags=re.I)
    return out.strip().lstrip("¿¡").strip()


def _cap(s: str) -> str:
    s = s.strip(" ,.;:")
    return s[:1].upper() + s[1:] if s else s


def _seg(original: str, norm_match: re.Match[str], group: str) -> str:
    start, end = norm_match.span(group)
    return original[start:end] if start >= 0 else ""


def _tone(norm: str) -> tuple[str | None, tuple[int, int] | None]:
    m = re.search(r"\s*\b(?:en\s+(?:un\s+)?tono|de\s+forma|de\s+manera|con\s+tono|en\s+plan|bien)\s+(" + "|".join(TONES) + r")\b", norm)
    if m:
        return TONES[m.group(1)], m.span()
    return None, None


def _clean_recipient(raw: str) -> str:
    r = re.sub(r"^(?:a\s+)?(?:mi|mis|el|la|los|las)\s+", "", raw.strip(), flags=re.I)
    return r.strip(" ,.;:")


PHONE_IN_TEXT = re.compile(r"(\+?\d[\d\s\-().]{6,}\d)")

# ------------------------------------------------------------------ reglas

CONTROL_STOP = re.compile(r"^(?:para|pare|stop|basta|callate|silencio|frena|espera|un\s+momento|un\s+segundo|alto|cortala)(?:\s+nexus)?[\s.!]*$")
CONTROL_RESUME = re.compile(r"^(?:segui|continua|dale\s+segui|segui\s+hablando|continua\s+por\s+favor|retoma)(?:\s+nexus)?[\s.!]*$")
CONTROL_REPEAT = re.compile(r"^(?:repeti(?:lo|me)?|repetilo|de\s+nuevo|otra\s+vez)(?:\s+nexus)?[\s.!?]*$")

WA_CHANNEL = r"(?:whatsapp|whats\s*app|wsp|wpp|whats|mensaje|msj|mensajito|mensajes)"
WA_VERB = r"(?:mand(?:a|ale|ales)|envi(?:a|ale|ales)|escrib(?:i|ile|ime)|pas(?:a|ale))"
WA_1 = re.compile(rf"^{WA_VERB}\s+(?:un\s+|una\s+)?{WA_CHANNEL}(?:\s+(?:por|de)\s+(?:whatsapp|wsp|wpp))?\s+(?:a|para)\s+(?P<rest>.+)$")
WA_2 = re.compile(rf"^(?:mandale|enviale|escribile|pasale)\s+a\s+(?P<recipient>.+?)\s+(?:un\s+)?{WA_CHANNEL}\b(?:\s+(?:por\s+)?(?:whatsapp|wsp))?(?:\s*(?:que|diciendo(?:le)?|con\s+el\s+texto|:)\s*(?P<body>.+))?$")
WA_3 = re.compile(r"^(?:decile|escribile|mandale|avisale|contale|preguntale)\s+(?:a\s+)?(?P<recipient>.+?)(?:\s+por\s+(?:whatsapp|wsp|wpp))?\s+(?:que|si|diciendo(?:le)?|:)\s*(?P<body>.+)$")
WA_4 = re.compile(rf"^{WA_CHANNEL}\s+(?:a|para)\s+(?P<rest>.+)$")
WA_SPLIT = re.compile(r"^(?P<recipient>.+?)(?:\s*[,:]\s*|\s+(?:diciendo(?:le)?(?:\s+que)?|que\s+diga|que\s+dice|con\s+el\s+texto|para\s+decirle|y\s+decile|y\s+decirle|que)\s+)(?P<body>.+)$")
CALL_RE = re.compile(r"^(?:llam(?:a|ale|alo|ala)|llamame\s+a|marcale|marca)\s+(?:a\s+)?(?P<recipient>.+?)(?:\s+por\s+telefono)?$")

REMINDER_RE = re.compile(
    r"^(?:recorda(?:me|rme)|recordame|recuerdame|acordame|haceme\s+acordar|avisame|"
    r"(?:cre(?:a|ame)|pon(?:e|eme)|agend(?:a|ame)|program(?:a|ame)|arm(?:a|ame))\s+un\s+recordatorio|quiero\s+(?:crear\s+)?un\s+recordatorio|"
    r"necesito\s+un\s+recordatorio|recordatorio)\b(?P<rest>.*)$")
REMEMBER_ME_TO_RE = re.compile(r"^acordate\s+de\s+(?!que\b)(?P<rest>.+)$")
ALARM_RE = re.compile(r"(?:^|\b)(?:(?:pon(?:e|eme)|program(?:a|ame)|cre(?:a|ame)|activ(?:a|ame)|arm(?:a|ame))\s+(?:una\s+)?alarma|despertame|alarma\s+(?:a|para)\s+las)\b")
TIMER_RE = re.compile(r"\b(?:pon(?:e|eme)|inici(?:a|ame)|arranc(?:a|ame)|program(?:a|ame)|activ(?:a|ame))\s+(?:un\s+)?(?:timer|temporizador|cronometro|cuenta\s+regresiva)\b|^(?:timer|temporizador)\s+(?:de|por)\b")
EVENT_RE = re.compile(r"^(?:agend(?:a|ame)|cre(?:a|ame)|prepar(?:a|ame)|anot(?:a|ame)|pon(?:e|eme)|arm(?:a|ame)|program(?:a|ame))\s+(?:un|una)\s+(?P<kind>evento|reunion|cita|turno|cumpleanos|llamada)\b(?P<rest>.*)$")
AGENDA_RE = re.compile(r"^(?:que\s+tengo|que\s+hay)(?:\s+(?:para|en|el))?\s*(?P<rest>.*?)(?:\s+(?:en\s+(?:la|mi)\s+agenda|en\s+(?:el|mi)\s+calendario|agendado))?\s*\??$|^(?:consult(?:a|ame)|mostrame|abr(?:i|ime)|revis(?:a|ame)|ver)\s+(?:la\s+|mi\s+|el\s+)?(?:agenda|calendario)\b(?P<rest2>.*)$")
SETTINGS_RE = re.compile(r"^(?:abr(?:i|ime|e|ir)|mostrame|and(?:a|e)\s+a|llevame\s+a|entr(?:a|e)\s+a|ir\s+a)\s+(?:la\s+|el\s+|los\s+|las\s+)?(?:configuracion|ajustes|opciones|preferencias)(?:\s+(?:de|del)\s+(?:la\s+|el\s+|los\s+)?(?P<panel>.+))?$")
TOGGLE_RE = re.compile(r"^(?:prend(?:e|eme)|activ(?:a|ame)|encend(?:e|eme)|apag(?:a|ame)|desactiv(?:a|ame)|conect(?:a|ame))\s+(?:el\s+|la\s+)?(?P<panel>wi\s?fi|bluetooth|gps|ubicacion|datos|modo\s+avion|nfc)\b")
NAV_RE = re.compile(r"\b(?:como\s+(?:llego|voy|hago\s+para\s+ir)|llevame|naveg(?:a|ar)|indicaciones|ruta|guiame)\s+(?:a|al|hasta|hacia|para\s+ir\s+a)\s+(?P<dest>.+?)(?:\s+(?P<mode>caminando|a\s+pie|en\s+auto|en\s+bici|en\s+colectivo|en\s+transporte\s+publico))?$")
MAP_RE = re.compile(r"^(?:busc(?:a|ame)|mostrame|ubic(?:a|ame))\s+(?P<q>.+?)\s+en\s+(?:el\s+)?(?:mapa|maps|google\s+maps)$|^donde\s+queda\s+(?P<q2>.+?)\??$")
OPEN_URL_RE = re.compile(r"^(?:abr(?:i|ime)|and(?:a|e)\s+a|entr(?:a|e)\s+a)\s+(?P<url>https://\S+)$")
OPEN_PROJECT_RE = re.compile(r"^(?:abr(?:i|ime)|mostrame|and(?:a|e)\s+a|entr(?:a|e)\s+a|ir\s+a)\s+(?:el\s+)?proyecto\s+(?P<name>.+)$")
OPEN_SCREEN_RE = re.compile(r"^(?:abr(?:i|ime)|mostrame|and(?:a|e)\s+a|ir\s+a|ver)\s+(?:la\s+|el\s+|las\s+|los\s+|mis\s+|mi\s+)?(?P<what>automatizaciones|rutinas|aprobaciones(?:\s+pendientes)?|misiones|memoria|recuerdos|agentes|reuniones|proyectos)$")
OPEN_APP_RE = re.compile(r"^(?:abr(?:i|ime|e|ir|ilo)|lanz(?:a|ame)|inici(?:a|ame)|ejecut(?:a|ame)|pon(?:e|eme)|arranc(?:a|ame))\s+(?:la\s+app\s+(?:de\s+)?|la\s+aplicacion\s+(?:de\s+)?|el\s+|la\s+)?(?P<app>[\w .+&-]{2,40}?)[\s.!]*$")
CONTACT_CREATE_RE = re.compile(r"^(?:agend(?:a|ame)|guard(?:a|ame)|cre(?:a|ame))\s+(?:el\s+|un\s+)?(?:numero|contacto|telefono)\s+(?P<phone>[+\d][\d \-]{5,}\d)\s+(?:como|a\s+nombre\s+de|de)\s+(?P<name>.+)$")
SHARE_LAST_RE = re.compile(r"^(?:compart(?:i|ir|ime)|mand(?:a|ame)|pasame)\s+(?:esto|eso|tu\s+(?:ultima\s+)?respuesta|la\s+(?:ultima\s+)?respuesta|lo\s+que\s+(?:dijiste|escribiste))\b")
SHARE_FILE_RE = re.compile(r"^compart(?:i|ir|ime)\s+(?:este|un|el|ese)\s+(?:documento|archivo|pdf|foto)\b")
MEMORY_SAVE_RE = re.compile(r"^(?:acordate|record(?:a|ar)|guard(?:a|ame)(?:\s+en\s+(?:la|tu)\s+memoria)?|anot(?:a|ate)|toma\s+nota(?:\s+de)?|tene\s+en\s+cuenta|no\s+te\s+olvides)\s+(?:de\s+)?que\s+(?P<fact>.+)$")
MEMORY_QUERY_RE = re.compile(r"^(?:que\s+(?:sabes|recordas|te\s+acordas|tenes\s+guardado|guardaste|anotaste|recuerdos\s+tenes)|que\s+(?:informacion|datos)\s+(?:tenes|guardaste))(?:\s+(?:de|sobre|acerca\s+de))?\s*(?P<topic>.*?)\??$")
MEMORY_FORGET_RE = re.compile(r"^(?:olvidate|borra(?:\s+de\s+(?:la|tu)\s+memoria)?|elimina\s+(?:el|los)\s+recuerdos?)\s+(?:de\s+)?(?:que\s+|lo\s+de\s+|sobre\s+)?(?P<topic>.+)$")
MISSION_RE = re.compile(r"^(?:cre(?:a|ame)|arm(?:a|ame)|lanz(?:a|ame)|ejecut(?:a|ame)|inici(?:a|ame)|empez(?:a|ame)|nueva)\s+(?:una\s+)?mision\s*(?:para|de|que|sobre|:)?\s*(?P<obj>.+)$")
DEEP_RESEARCH_RE = re.compile(r"\b(?:a\s+fondo|en\s+profundidad|informe\s+completo|investigacion\s+(?:profunda|completa)|analisis\s+completo|comparativa\s+completa)\b")
SCHEDULE_AUTO_RE = re.compile(r"^(?:todos\s+los|todas\s+las|cada)\s+(?P<freq>dias|dia|mananas|noches|tardes|lunes|martes|miercoles|jueves|viernes|sabados|domingos|semana|semanas|hora|\d+\s+horas|mes)\b(?P<rest>.*)$")
EVENT_AUTO_RE = re.compile(r"^(?:avisame|notificame|mandame\s+un\s+aviso|decime|alertame)\s+(?:siempre\s+)?(?:que|cuando|cada\s+vez\s+que)\s+(?P<cond>.+)$")
RESEARCH_RE = re.compile(r"^(?:investig(?:a|ame)|averigu(?:a|ame)|busc(?:a|ame)\s+(?:info|informacion|datos|noticias|precios|opciones|alternativas)|fijate\s+(?:que\s+onda|si|como|cuanto|cual|donde|cuando|en\s+internet)|buscame\s+(?:una\s+)?soluci|hace(?:me)?\s+una\s+investigacion|research)")
PROGRAMMING_RE = re.compile(r"\b(?:codigo|programa(?:r|cion)|script|funcion|bug|debug|compil\w*|stack\s?trace|excepcion|python|kotlin|java(?:script)?|typescript|sql|regex|endpoint|refactor\w*|git|docker|gradle|android\s+studio|algoritmo)\b")
CREATIVE_RE = re.compile(r"^(?:escrib(?:i|ime)|redact(?:a|ame)|hace(?:me)?|arm(?:a|ame)|prepar(?:a|ame)|cre(?:a|ame))\s+(?:un|una|el|la)\s+(?:texto|post|carta|poema|mail|correo|email|discurso|slogan|eslogan|logo|guion|historia|cuento|nota|documento|informe|resumen|presentacion|propuesta|cv|curriculum)\b")
ORGANIZE_RE = re.compile(r"^(?:organiz(?:a|ame)|orden(?:a|ame)|planific(?:a|ame)|prioriz(?:a|ame)|arm(?:a|ame)\s+un\s+plan|hace(?:me)?\s+un\s+plan|dejalo\s+preparado|ayudame\s+a\s+organizar)")
ANALYSIS_RE = re.compile(r"^(?:analiz(?:a|ame)|revis(?:a|ame)|evalu(?:a|ame)|compar(?:a|ame)|audit(?:a|ame)|fijate\s+que\s+onda\s+con)")
SECURITY_RE = re.compile(r"\b(?:es\s+seguro|seguridad|vulnerab\w*|contrasena|phishing|estafa|hackeo|malware|virus)\b")
GREETING_RE = re.compile(r"^(?:hola|buenas|buen\s+dia|buenos\s+dias|buenas\s+tardes|buenas\s+noches|que\s+tal|como\s+(?:andas|estas|va)|gracias|muchas\s+gracias|genial|perfecto|joya|de\s+una|todo\s+bien|chau|hasta\s+luego)\b")
QUESTION_RE = re.compile(r"^(?:que|cual|cuales|cuando|donde|como|por\s+que|cuanto|cuanta|cuantos|quien|quienes|es\s+verdad|sabes)\b|\?$")

SCHED_FREQ = {"dias": "*", "dia": "*", "mananas": "*", "noches": "*", "tardes": "*", "lunes": "1", "martes": "2", "miercoles": "3",
              "jueves": "4", "viernes": "5", "sabados": "6", "domingos": "0"}
EVENT_CONDITIONS = [
    (re.compile(r"(?:termine|terminen|se\s+complete|se\s+completen|finalice|este\s+lista)\s+(?:una|la|cada|alguna)?\s*mision"), "mission.completed"),
    (re.compile(r"(?:falle|fallen|se\s+caiga)\s+(?:una|la|alguna)?\s*mision"), "mission.failed"),
    (re.compile(r"(?:se\s+bloquee|quede\s+bloqueada)\s+(?:una|la|alguna)?\s*mision|mision\s+(?:se\s+)?bloque"), "mission.blocked"),
    (re.compile(r"(?:haya|tenga|necesites|requiera)\s+(?:una\s+|mi\s+)?(?:aprobacion|confirmacion)|(?:aprobacion|confirmacion)\s+pendiente"), "approval.requested"),
    (re.compile(r"(?:llegue|entre|reciba)\s+un\s+mensaje\s+(?:a|de|en|por)\s+whatsapp\s+business"), "whatsapp.business.inbound"),
]


@dataclass
class ClassifyContext:
    now: datetime  # con la zona horaria del usuario
    timezone: str
    last_assistant_text: str | None = None
    has_attachments: bool = False
    pending: dict[str, Any] | None = None  # pregunta abierta (relleno de datos)


def classify(text: str, ctx: ClassifyContext) -> Intent:
    original = strip_wake(text)
    norm = normalize(original)
    n = norm.strip()

    if not n:
        return Intent("conversation", 1.0, "empty", control="noop")
    if CONTROL_STOP.match(n):
        return Intent("conversation", 0.99, "control.stop", control="stop")
    if CONTROL_RESUME.match(n):
        return Intent("conversation", 0.99, "control.resume", control="resume")
    if CONTROL_REPEAT.match(n):
        return Intent("conversation", 0.95, "control.repeat", control="repeat")

    if ctx.pending:
        filled = _fill_pending(original, norm, ctx)
        if filled is not None:
            return filled

    for rule in (_whatsapp, _call, _alarm, _timer, _reminder, _event, _agenda, _contact_create, _settings, _navigation, _map,
                 _open_url, _open_project, _open_screen, _share, _memory_save, _memory_query, _memory_forget, _mission,
                 _automation, _open_app):
        result = rule(original, norm, ctx)
        if result is not None:
            return result
    return _model_intent(original, norm, ctx)


# ------------------------------------------------------------------ comunicación

def _whatsapp(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    tone, tone_span = _tone(norm)
    if tone_span:
        original = (original[:tone_span[0]] + original[tone_span[1]:]).strip()
        norm = normalize(original)
    recipient = body = None
    if (m := WA_1.match(norm)) or (m := WA_4.match(norm)):
        rest_o = _seg(original, m, "rest")
        rest_n = normalize(rest_o)
        if s := WA_SPLIT.match(rest_n):
            recipient, body = rest_o[: s.end("recipient")], rest_o[s.start("body"):]
        else:
            recipient, body = rest_o, ""
    elif m := WA_2.match(norm):
        recipient = _seg(original, m, "recipient")
        body = _seg(original, m, "body") if m.group("body") else ""
    elif m := WA_3.match(norm):
        recipient, body = _seg(original, m, "recipient"), _seg(original, m, "body")
        if m.group(0).split()[0] == "preguntale" and body and not body.rstrip().endswith("?"):
            body = "¿" + body.strip() + "?"
    if recipient is None:
        return None
    recipient = _clean_recipient(recipient)
    if not recipient:
        return None
    params: dict[str, Any] = {"text": _cap(body or "")}
    if tone:
        params["tone"] = tone
    phone_match = PHONE_IN_TEXT.search(recipient)
    if phone_match and len(re.sub(r"\D", "", phone_match.group(1))) >= 8:
        params["phone"] = re.sub(r"[^\d+]", "", phone_match.group(1))
        label = recipient.replace(phone_match.group(1), "").strip()
        if label:
            params["contact_label"] = label
    else:
        params["recipient_query"] = recipient
    who = params.get("contact_label") or params.get("recipient_query") or "el número indicado"
    summary = f"WhatsApp para {who}" + (f": «{params['text'][:80]}»" if params["text"] else " (sin texto todavía)")
    return Intent("communication", 0.93, "whatsapp", action_key="whatsapp.open_chat", params=params, summary=summary,
                  extra={"indirect_speech": bool(body) and bool(re.search(r"\bque\b", norm))})


def _call(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = CALL_RE.match(norm)
    if not m:
        return None
    recipient = _clean_recipient(_seg(original, m, "recipient"))
    if not recipient or normalize(recipient) in ("me", "luego", "despues"):
        return None
    digits = re.sub(r"[^\d+]", "", recipient)
    params = {"phone": digits} if len(re.sub(r"\D", "", digits)) >= 6 else {"recipient_query": recipient}
    return Intent("communication", 0.9, "call", action_key="device.dial", params=params, summary=f"Llamar a {recipient}")


# ------------------------------------------------------------------ productividad

def _when_iso(w: When) -> str | None:
    return w.dt.isoformat() if w.dt else None


def _alarm(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    if not ALARM_RE.search(norm):
        return None
    w = parse_when(norm, ctx.now, prefer_pm=False)
    if not w.dt:
        return Intent("productivity", 0.9, "alarm", question="¿Para qué hora pongo la alarma?", missing=["time"],
                      extra={"pending": {"kind": "alarm"}})
    label_m = re.search(r"\b(?:para|que\s+diga)\s+(?!las\b)(?P<label>[a-z].{2,60})$", remove_spans(norm, w.spans))
    params: dict[str, Any] = {"hour": w.dt.hour, "minute": w.dt.minute}
    if label_m:
        params["label"] = _cap(label_m.group("label"))
    day_note = "" if w.dt.date() == ctx.now.date() else " (mañana)" if w.dt.date() == (ctx.now + timedelta(days=1)).date() else ""
    return Intent("productivity", 0.93, "alarm", action_key="device.set_alarm", params=params,
                  summary=f"Alarma a las {w.dt:%H:%M}{day_note}", assumptions=w.assumptions)


def _timer(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    if not TIMER_RE.search(norm):
        return None
    secs, _ = parse_duration_seconds(norm)
    if not secs:
        return Intent("productivity", 0.9, "timer", question="¿De cuánto tiempo querés el temporizador?", missing=["duration"],
                      extra={"pending": {"kind": "timer"}})
    mins, s = divmod(secs, 60)
    label = f"{mins} min" + (f" {s} s" if s else "") if mins else f"{s} s"
    return Intent("productivity", 0.94, "timer", action_key="device.set_timer", params={"seconds": secs}, summary=f"Temporizador de {label}")


def _reminder_from(rest_o: str, ctx: ClassifyContext, rule: str) -> Intent:
    rest_n = normalize(rest_o)
    w = parse_when(rest_n, ctx.now)
    title = remove_spans(rest_o, w.spans)
    title = re.sub(r"^(?:que\s+(?:tengo\s+que\s+)?|de\s+(?:que\s+)?|para\s+|a\s+|el\s+recordatorio\s+(?:de\s+)?|un\s+recordatorio\s+(?:de\s+|para\s+)?)", "", title, flags=re.I)
    title = _cap(_trim_preps(title))
    if not w.dt:
        pending = {"kind": "reminder", "title": title, "day": w.day.isoformat() if w.day else None}
        q = "¿A qué hora te lo recuerdo?" if w.day else "¿Cuándo te lo recuerdo?"
        if not title:
            q = "¿Qué querés que te recuerde y cuándo?"
        return Intent("productivity", 0.9, rule, question=q, missing=["time"] + ([] if title else ["title"]), extra={"pending": pending})
    if not title:
        return Intent("productivity", 0.9, rule, question="¿Qué querés que te recuerde?", missing=["title"],
                      extra={"pending": {"kind": "reminder_title", "at": w.dt.isoformat()}})
    return Intent("productivity", 0.94, rule, action_key="reminder.create", params={"title": title[:200], "at": w.dt.isoformat()},
                  summary=f"Recordatorio: «{title[:80]}» {_human_dt(w.dt, ctx.now)}", assumptions=w.assumptions)


def _reminder(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    if m := REMEMBER_ME_TO_RE.match(norm):
        rest_o = _seg(original, m, "rest")
        w = parse_when(normalize(rest_o), ctx.now)
        if w.found:
            return _reminder_from(rest_o, ctx, "reminder.acordate_de")
        return None
    m = REMINDER_RE.match(norm)
    if not m:
        return None
    if re.match(r"^avisame\s+(?:siempre\s+)?(?:cuando|cada\s+vez\s+que)\b", norm):
        return None  # es una automatización por evento
    return _reminder_from(_seg(original, m, "rest"), ctx, "reminder")


def _trim_preps(s: str) -> str:
    return re.sub(r"(?:\s+|^)(?:para|de|del|el|la|a|en|que|por)$", "", s.strip(), flags=re.I).strip()


def _human_dt(dt: datetime, now: datetime) -> str:
    days = (dt.date() - now.date()).days
    day = "hoy" if days == 0 else "mañana" if days == 1 else "pasado mañana" if days == 2 else dt.strftime("el %d/%m/%Y")
    return f"{day} a las {dt:%H:%M}"


# ------------------------------------------------------------------ organización

def _event(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = EVENT_RE.match(norm)
    if not m:
        return None
    kind = {"reunion": "Reunión", "cumpleanos": "Cumpleaños"}.get(m.group("kind"), _cap(_seg(original, m, "kind")))
    rest_o = _seg(original, m, "rest")
    w = parse_when(normalize(rest_o), ctx.now)
    detail = remove_spans(rest_o, w.spans)
    detail = _trim_preps(re.sub(r"^(?:para|de|sobre|el|la)(?:\s+|$)", "", detail.strip(), flags=re.I))
    title = (kind + (" " + detail if detail else "")).strip()
    if w.dt:
        params = {"title": title[:200], "start": w.dt.isoformat(), "end": (w.dt + timedelta(hours=1)).isoformat()}
        summary = f"Evento «{title[:80]}» {_human_dt(w.dt, ctx.now)}"
    elif w.day:
        start = datetime.combine(w.day, datetime.min.time(), tzinfo=ctx.now.tzinfo)
        params = {"title": title[:200], "start": start.isoformat(), "all_day": True}
        summary = f"Evento «{title[:80]}» el {w.day:%d/%m} (todo el día)"
    else:
        return Intent("organization", 0.88, "event", question=f"¿Para cuándo preparo «{title}»?", missing=["date"],
                      extra={"pending": {"kind": "event", "title": title}})
    return Intent("organization", 0.92, "event", action_key="device.calendar_event", params=params, summary=summary,
                  assumptions=w.assumptions)


def _agenda(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = AGENDA_RE.match(norm)
    if not m:
        return None
    rest = (m.group("rest") or m.group("rest2") or "").strip()
    if m.group("rest") is not None and not re.search(r"\b(?:hoy|manana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo|semana|agenda|calendario|\d)", norm):
        return None  # "qué tengo que hacer..." no es una consulta de agenda
    w = parse_when(rest, ctx.now)
    day = (w.dt.date() if w.dt else w.day) or ctx.now.date()
    return Intent("organization", 0.88, "agenda", action_key="device.calendar_view", params={"date": day.isoformat()},
                  summary=f"Abrir el calendario en {day:%d/%m}",
                  extra={"note": "NEXUS abre tu calendario en esa fecha; no lee tus eventos."})


def _contact_create(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = CONTACT_CREATE_RE.match(norm)
    if not m:
        return None
    phone = re.sub(r"[^\d+]", "", _seg(original, m, "phone"))
    name = _cap(_seg(original, m, "name"))
    return Intent("organization", 0.92, "contact_create", action_key="device.contact_create", params={"name": name, "phone": phone},
                  summary=f"Crear el contacto {name}")


# ------------------------------------------------------------------ teléfono

def _settings(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    toggled = TOGGLE_RE.match(norm)
    m = SETTINGS_RE.match(norm)
    if not m and not toggled:
        return None
    target = ((toggled.group("panel") if toggled else m.group("panel")) or "") if (toggled or m) else ""
    panel = "general"
    for word, key in SETTINGS_WORDS:
        if word in target.replace("-", " "):
            panel = key
            break
    extra = {"note": "Android no permite que una app cambie ese ajuste sola: te abro la pantalla para que lo hagas vos."} if toggled else {}
    return Intent("phone_control", 0.93, "settings", action_key="device.open_settings", params={"panel": panel},
                  summary=f"Abrir la configuración{'' if panel == 'general' else ' de ' + target.strip()}", extra=extra)


def _navigation(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = NAV_RE.search(norm)
    if not m:
        return None
    dest = _seg(original, m, "dest").strip(" ?.!")
    mode_word = m.group("mode") or ""
    mode = ("walking" if ("pie" in mode_word or "caminando" in mode_word) else "bicycling" if "bici" in mode_word
            else "transit" if ("colectivo" in mode_word or "transporte" in mode_word) else "driving")
    return Intent("phone_control", 0.92, "navigate", action_key="device.navigate", params={"destination": dest, "mode": mode},
                  summary=f"Ruta hacia {dest}")


def _map(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = MAP_RE.match(norm)
    if not m:
        return None
    q = _seg(original, m, "q") if m.group("q") else _seg(original, m, "q2")
    return Intent("phone_control", 0.9, "map_search", action_key="device.map_search", params={"query": q.strip(" ?")},
                  summary=f"Buscar «{q.strip(' ?')}» en el mapa")


def _open_url(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = OPEN_URL_RE.match(norm)
    if not m:
        return None
    url = _seg(original, m, "url")
    return Intent("information", 0.95, "open_url", action_key="device.open_url", params={"url": url}, summary=f"Abrir {url[:80]}")


def _open_project(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = OPEN_PROJECT_RE.match(norm)
    if not m:
        return None
    name = _seg(original, m, "name").strip(" .!")
    return Intent("project_management", 0.9, "open_project", action_key="app.open_screen",
                  params={"screen": "project", "label": name}, summary=f"Abrir el proyecto {name}", extra={"resolve_project": name})


def _open_screen(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = OPEN_SCREEN_RE.match(norm)
    if not m:
        return None
    what = m.group("what")
    screen = next(v for k, v in SCREEN_WORDS if what.startswith(k))
    return Intent("project_management", 0.9, "open_screen", action_key="app.open_screen", params={"screen": screen},
                  summary=f"Abrir {what}")


def _share(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    if SHARE_FILE_RE.match(norm):
        return Intent("communication", 0.9, "share_file", action_key="device.share_file", params={}, summary="Compartir un documento")
    if SHARE_LAST_RE.match(norm):
        if not ctx.last_assistant_text:
            return Intent("communication", 0.85, "share_last", question="No tengo una respuesta anterior para compartir. ¿Qué texto querés compartir?")
        return Intent("communication", 0.9, "share_last", action_key="device.share_text", params={"text": ctx.last_assistant_text[:8000]},
                      summary="Compartir mi última respuesta")
    return None


def _open_app(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = OPEN_APP_RE.match(norm)
    if not m:
        return None
    app = _seg(original, m, "app").strip(" .!")
    app_n = normalize(app)
    if not app or len(app) < 2 or re.match(r"^(?:un|una|el|la)\s", app_n) or app_n in ("eso", "esto", "algo", "musica de fondo"):
        return None
    return Intent("phone_control", 0.88, "open_app", action_key="device.open_app", params={"app": app}, summary=f"Abrir {app}")


# ------------------------------------------------------------------ memoria

def _memory_save(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = MEMORY_SAVE_RE.match(norm)
    if not m:
        return None
    fact = _cap(_seg(original, m, "fact"))
    if len(fact) < 3:
        return None
    category = _memory_category(normalize(fact))
    return Intent("memory_query", 0.93, "memory.save", action_key="memory.remember", params={"content": fact, "category": category},
                  summary=f"Recordar: «{fact[:100]}»")


def _memory_category(n: str) -> str:
    if re.search(r"\b(?:prefiero|me gusta|no me gusta|odio|favorit[oa])\b", n):
        return "preferences"
    if re.search(r"\b(?:trabajo|oficina|jefe|cliente|empresa|reunion)\b", n):
        return "work"
    if re.search(r"\b(?:medico|alergi\w*|medicamento|salud|turno medico)\b", n):
        return "health"
    if re.search(r"\b(?:proyecto)\b", n):
        return "projects"
    return "personal"


def _memory_query(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = MEMORY_QUERY_RE.match(norm)
    if not m:
        return None
    topic = _seg(original, m, "topic").strip(" ?") if m.group("topic") else ""
    topic_n = normalize(topic)
    if topic_n in ("", "mi", "mi?", "de mi"):
        topic = ""
    return Intent("memory_query", 0.9, "memory.query", extra={"memory_lookup": topic})


def _memory_forget(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = MEMORY_FORGET_RE.match(norm)
    if not m:
        return None
    topic = _seg(original, m, "topic").strip(" .")
    if len(topic) < 3:
        return None
    return Intent("memory_query", 0.88, "memory.forget", extra={"memory_forget": topic})


# ------------------------------------------------------------------ misiones y automatizaciones

def _mission(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    m = MISSION_RE.match(norm)
    deep = None
    if not m and RESEARCH_RE.match(norm) and DEEP_RESEARCH_RE.search(norm):
        deep = original
    if not m and not deep:
        return None
    objective = _cap(_seg(original, m, "obj")) if m else _cap(deep or "")
    if len(objective) < 5:
        return Intent("project_management", 0.85, "mission", question="¿Cuál es el objetivo de la misión?", missing=["objective"],
                      extra={"pending": {"kind": "mission"}})
    return Intent("project_management", 0.9, "mission" if m else "research.deep", action_key="mission.create",
                  params={"objective": objective, "title": objective[:80]},
                  summary=f"Misión: {objective[:120]}", specialists=["atlas"] if deep else [])


def _automation(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    if m := EVENT_AUTO_RE.match(norm):
        cond = m.group("cond")
        for pattern, event_type in EVENT_CONDITIONS:
            if pattern.search(cond):
                label = _seg(original, m, "cond").strip(" .")
                params = {"name": f"Aviso cuando {label[:150]}", "trigger_type": "event", "event_type": event_type,
                          "actions": [{"type": "notify", "title": f"Aviso: {label[:150]}", "body": "Se cumplió la condición de tu rutina."}],
                          "max_runs_per_day": 20}
                return Intent("automation", 0.9, "automation.event", action_key="automation.create", params=params,
                              summary=f"Rutina: avisarte cuando {cond[:100]}")
        return Intent("automation", 0.6, "automation.event_unmapped", needs_model=True)
    m = SCHEDULE_AUTO_RE.match(norm)
    if not m:
        return None
    freq = m.group("freq")
    rest_o = _seg(original, m, "rest")
    w = parse_when(normalize(rest_o), ctx.now.replace(hour=0, minute=0, second=0, microsecond=0))
    body = remove_spans(rest_o, w.spans)
    body = re.sub(r"^(?:a\s+la\s+|por\s+la\s+|que\s+|,\s*)", "", body.strip(), flags=re.I)
    hour, minute = (w.dt.hour, w.dt.minute) if w.dt and w.has_time else (None, None)
    if freq in ("mananas", "noches", "tardes") and hour is None:
        hour, minute = {"mananas": 9, "tardes": 16, "noches": 21}[freq], 0
    if freq == "hora" or re.match(r"\d+\s+horas", freq):
        every = int(freq.split()[0]) if freq[0].isdigit() else 1
        cron = "0 * * * *" if every == 1 else f"0 */{every} * * *"
        when_label = "cada hora" if every == 1 else f"cada {every} horas"
    else:
        if hour is None:
            return Intent("automation", 0.85, "automation.schedule", question="¿A qué hora querés que se ejecute la rutina?", missing=["time"],
                          extra={"pending": {"kind": "automation_time", "freq": freq, "body": body}})
        if freq in ("semana", "semanas"):
            dow = str(ctx.now.isoweekday() % 7)
        elif freq == "mes":
            cron = f"{minute} {hour} {ctx.now.day} * *"
            dow = None
        else:
            dow = SCHED_FREQ.get(freq, "*")
        if freq != "mes":
            cron = f"{minute} {hour} * * {dow}"
        when_label = f"{'todos los días' if dow == '*' else 'cada ' + freq} a las {hour:02d}:{minute:02d}"
    if len(body) < 3:
        return Intent("automation", 0.8, "automation.schedule", question="¿Qué querés que haga NEXUS en esa rutina?", missing=["action"])
    body_n = normalize(body)
    rm = re.match(r"^(?:recordame|recorda(?:me|rme)|avisame|acordame\s+de|acordame)\s+(?:que\s+|de\s+)?(?P<what>.+)$", body_n)
    if rm:
        what = _cap(body[rm.start("what"):])
        actions = [{"type": "notify", "title": what[:200], "body": "Recordatorio de tu rutina."}]
    else:
        actions = [{"type": "jarvis_prompt", "prompt": _cap(body)}]
    params = {"name": _cap(body)[:200], "trigger_type": "schedule", "cron": cron, "timezone": ctx.timezone, "actions": actions}
    return Intent("automation", 0.88, "automation.schedule", action_key="automation.create", params=params,
                  summary=f"Rutina {when_label}: {_cap(body)[:100]}", assumptions=w.assumptions)


# ------------------------------------------------------------------ relleno de datos pendientes

def _fill_pending(original: str, norm: str, ctx: ClassifyContext) -> Intent | None:
    p = ctx.pending or {}
    kind = p.get("kind")
    if re.match(r"^(?:no|nada|cancela|cancelar|olvidalo|deja|dejalo)\b", norm.strip()):
        return Intent("conversation", 0.95, "pending.cancel", control="cancel_pending")
    if kind in ("reminder", "event", "alarm") or kind == "automation_time":
        default_day = None
        if p.get("day"):
            try:
                default_day = datetime.fromisoformat(p["day"]).date()
            except ValueError:
                default_day = None
        prefer_pm = kind != "alarm"
        w = parse_when(norm, ctx.now, prefer_pm=prefer_pm, default_day=default_day)
        if not w.dt and (m := re.match(r"^\s*(\d{1,2})(?::(\d{2}))?\s*(?:hs|h)?\s*$", norm)):
            w = parse_when(f"a las {m.group(1)}" + (f":{m.group(2)}" if m.group(2) else ""), ctx.now, prefer_pm=prefer_pm,
                           default_day=default_day)
        if kind == "reminder":
            if not w.dt:
                return None
            title = p.get("title") or ""
            if not title:
                return None
            return Intent("productivity", 0.9, "reminder.filled", action_key="reminder.create",
                          params={"title": title, "at": w.dt.isoformat()}, summary=f"Recordatorio: «{title[:80]}» {_human_dt(w.dt, ctx.now)}",
                          assumptions=w.assumptions)
        if kind == "alarm" and w.dt:
            return Intent("productivity", 0.9, "alarm.filled", action_key="device.set_alarm", params={"hour": w.dt.hour, "minute": w.dt.minute},
                          summary=f"Alarma a las {w.dt:%H:%M}", assumptions=w.assumptions)
        if kind == "event" and (w.dt or w.day):
            title = p.get("title") or "Evento"
            if w.dt:
                params = {"title": title, "start": w.dt.isoformat(), "end": (w.dt + timedelta(hours=1)).isoformat()}
            else:
                assert w.day is not None
                params = {"title": title, "start": datetime.combine(w.day, datetime.min.time(), tzinfo=ctx.now.tzinfo).isoformat(), "all_day": True}
            return Intent("organization", 0.9, "event.filled", action_key="device.calendar_event", params=params, summary=f"Evento «{title}»")
        if kind == "automation_time" and w.dt:
            return classify(f"todos los {p.get('freq', 'dias')} a las {w.dt:%H:%M} {p.get('body', '')}",
                            ClassifyContext(now=ctx.now, timezone=ctx.timezone))
        return None
    if kind == "reminder_title" and len(original.strip()) >= 3:
        title = _cap(original)
        at = datetime.fromisoformat(p["at"])
        return Intent("productivity", 0.9, "reminder.filled", action_key="reminder.create", params={"title": title, "at": p["at"]},
                      summary=f"Recordatorio: «{title[:80]}» {_human_dt(at, ctx.now)}")
    if kind == "timer":
        secs, _ = parse_duration_seconds(norm)
        if secs:
            return Intent("productivity", 0.9, "timer.filled", action_key="device.set_timer", params={"seconds": secs},
                          summary=f"Temporizador de {secs // 60} min" if secs >= 60 else f"Temporizador de {secs} s")
    if kind == "mission" and len(original.strip()) >= 5:
        objective = _cap(original)
        return Intent("project_management", 0.9, "mission.filled", action_key="mission.create",
                      params={"objective": objective, "title": objective[:80]}, summary=f"Misión: {objective[:120]}")
    return None


# ------------------------------------------------------------------ resto: modelo

def _model_intent(original: str, norm: str, ctx: ClassifyContext) -> Intent:
    specialists: list[str] = []
    if RESEARCH_RE.match(norm):
        category, conf = "research", 0.8
        specialists.append(SPECIALISTS["research"])
        if PROGRAMMING_RE.search(norm):
            specialists.append(SPECIALISTS["programming"])
    elif PROGRAMMING_RE.search(norm):
        category, conf = "programming", 0.75
        specialists.append(SPECIALISTS["programming"])
    elif CREATIVE_RE.match(norm):
        category, conf = "productivity", 0.75
        specialists.append(SPECIALISTS["creative"])
    elif ORGANIZE_RE.match(norm):
        category, conf = "organization", 0.75
    elif ANALYSIS_RE.match(norm) or (ctx.has_attachments and re.search(r"\b(?:archivo|documento|esto|este)\b", norm)):
        category, conf = ("project_management" if ctx.has_attachments else "information"), 0.7
        specialists.append(SPECIALISTS["analysis"])
    elif re.search(r"\b(?:automatiz\w*|rutina)\b", norm):
        category, conf = "automation", 0.7
    elif re.search(r"\b(?:mision(?:es)?|proyecto(?:s)?|tarea(?:s)?\s+pendiente)", norm):
        category, conf = "project_management", 0.65
    elif GREETING_RE.match(norm) and len(norm.split()) <= 6:
        category, conf = "conversation", 0.85
    elif QUESTION_RE.search(norm.strip()):
        category, conf = "information", 0.65
    else:
        category, conf = "conversation", 0.5
    if SECURITY_RE.search(norm) and SPECIALISTS["security"] not in specialists:
        specialists.append(SPECIALISTS["security"])
    return Intent(category, conf, f"model.{category}", needs_model=True, specialists=specialists)
