"""Interpretación de fechas y horas en español (incluye usos rioplatenses).

Trabaja sobre el texto normalizado (minúsculas, sin acentos, misma longitud que el
original) y devuelve los tramos reconocidos para poder quitarlos del título. Toda
suposición queda registrada en `assumptions` y se muestra al usuario antes de confirmar.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

NUM = {
    "un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8,
    "nueve": 9, "diez": 10, "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15, "veinte": 20,
    "veinticinco": 25, "treinta": 30, "cuarenta": 40, "cuarenta y cinco": 45, "cincuenta": 50, "sesenta": 60, "noventa": 90,
}
NUM_RE = "|".join(sorted(NUM, key=len, reverse=True))
MONTHS = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
          "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
WEEKDAYS = {"lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6}

REL_RE = re.compile(rf"\b(?:en|dentro de)\s+(\d+|{NUM_RE}|media)\s+(minutos?|mins?|horas?|hs|dias?|semanas?)\b")
REL_HALF_HOUR_RE = re.compile(r"\b(?:en|dentro de)\s+media\s+hora\b")
TIME_RE = re.compile(
    rf"\b(?:a\s+las|a\s+la|para\s+las|tipo|las)\s+(\d{{1,2}}|{NUM_RE})(?:\s*(?::|\.|h)\s*(\d{{2}}))?(?:\s*(?:hs|h|horas)\b)?"
    r"(\s+y\s+media|\s+y\s+cuarto|\s+menos\s+cuarto)?"
    r"(\s+(?:de\s+la|a\s+la|por\s+la|en\s+la)\s+(?:manana|tarde|noche|madrugada)|\s*(?:am|pm|a\.m\.|p\.m\.))?"
)
NOON_RE = re.compile(r"\b(?:al|a)\s+(mediodia|medianoche)\b")
DAY_RE = re.compile(r"\b(pasado\s+manana|hoy|esta\s+noche|esta\s+tarde|esta\s+manana)\b|(?<!la )(?<!de la )\bmanana\b")
WEEKDAY_RE = re.compile(r"\b(?:el|este|el\s+proximo|proximo)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b")
DATE_TEXT_RE = re.compile(r"\b(?:el\s+)?(\d{1,2})\s+de\s+(" + "|".join(MONTHS) + r")(?:\s+(?:de|del)\s+(\d{4}))?\b")
DATE_NUM_RE = re.compile(r"\b(?:el\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b")
PART_RE = re.compile(r"\b(?:a|por|en)\s+la\s+(manana|tarde|noche)\b")


@dataclass
class When:
    dt: datetime | None = None  # fecha y hora completas (zona del usuario)
    day: date | None = None  # solo fecha (sin hora)
    has_time: bool = False
    spans: list[tuple[int, int]] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)

    @property
    def found(self) -> bool:
        return self.dt is not None or self.day is not None


def _num(token: str) -> int:
    return int(token) if token.isdigit() else NUM[token]


def parse_duration_seconds(norm: str) -> tuple[int | None, tuple[int, int] | None]:
    if m := re.search(r"\b(?:de|por)?\s*media\s+hora\b", norm):
        return 1800, m.span()
    m = re.search(rf"\b(\d+|{NUM_RE})\s+(segundos?|segs?|minutos?|mins?|horas?|hs)\b(?:\s+y\s+media)?", norm)
    if not m:
        return None, None
    n = _num(m.group(1))
    unit = m.group(2)
    secs = n if unit.startswith("seg") else n * 60 if unit.startswith("min") else n * 3600
    if "y media" in m.group(0):
        secs += 30 if unit.startswith("seg") else 30 * 60 if unit.startswith("min") else 1800
    return secs, m.span()


def _hour_from(match: re.Match[str]) -> tuple[int, int, bool]:
    hour = _num(match.group(1))
    minute = int(match.group(2)) if match.group(2) else 0
    frac = (match.group(3) or "").strip()
    if frac == "y media":
        minute = 30
    elif frac == "y cuarto":
        minute = 15
    elif frac == "menos cuarto":
        hour, minute = (hour - 1) % 24, 45
    qual = (match.group(4) or "").strip().replace(".", "")
    explicit = bool(qual)
    if qual.endswith("tarde") or qual == "pm":
        if hour < 12:
            hour += 12
    elif qual.endswith("noche"):
        if hour == 12:
            hour = 0
        elif 6 <= hour < 12:
            hour += 12
    elif qual.endswith("manana") or qual.endswith("madrugada") or qual == "am":
        if hour == 12:
            hour = 0
    return hour, minute, explicit


def parse_when(norm: str, now: datetime, *, prefer_pm: bool = True, default_day: date | None = None) -> When:
    """`now` debe venir con la zona horaria del usuario. prefer_pm: una hora 1-7 sin
    aclaración se entiende como de la tarde (no aplica a alarmas)."""
    w = When()
    if m := REL_HALF_HOUR_RE.search(norm):
        w.dt, w.has_time = now + timedelta(minutes=30), True
        w.spans.append(m.span())
        return w
    if m := REL_RE.search(norm):
        n = 0.5 if m.group(1) == "media" else _num(m.group(1))
        unit = m.group(2)
        delta = (timedelta(minutes=n) if unit.startswith("min") else timedelta(hours=n) if unit.startswith(("hora", "hs"))
                 else timedelta(days=n) if unit.startswith("dia") else timedelta(weeks=n))
        w.dt, w.has_time = now + delta, True
        w.spans.append(m.span())
        return w

    base: date | None = None
    default_hour: int | None = None
    if m := DATE_TEXT_RE.search(norm):
        day, month = int(m.group(1)), MONTHS[m.group(2)]
        year = int(m.group(3)) if m.group(3) else now.year
        try:
            base = date(year, month, day)
        except ValueError:
            base = None
        if base and not m.group(3) and base < now.date():
            base = base.replace(year=year + 1)
        if base:
            w.spans.append(m.span())
    elif (m := DATE_NUM_RE.search(norm)) and int(m.group(2)) <= 12:
        day, month = int(m.group(1)), int(m.group(2))
        year = int(m.group(3)) if m.group(3) else now.year
        year = year + 2000 if year < 100 else year
        try:
            base = date(year, month, day)
        except ValueError:
            base = None
        if base and not m.group(3) and base < now.date():
            base = base.replace(year=year + 1)
        if base:
            w.spans.append(m.span())
    if base is None and (m := WEEKDAY_RE.search(norm)):
        target = WEEKDAYS[m.group(1)]
        ahead = (target - now.weekday()) % 7 or 7
        base = now.date() + timedelta(days=ahead)
        w.spans.append(m.span())
    if base is None and (m := DAY_RE.search(norm)):
        word = (m.group(1) or "manana").replace("  ", " ")
        if word.startswith("pasado"):
            base = now.date() + timedelta(days=2)
        elif word == "manana":
            base = now.date() + timedelta(days=1)
        else:
            base = now.date()
            if word == "esta noche":
                default_hour = 21
            elif word == "esta tarde":
                default_hour = 16
            elif word == "esta manana":
                default_hour = 9
        w.spans.append(m.span())

    if base is None and default_day is not None:
        base = default_day
    hour = minute = None
    explicit = False
    if m := TIME_RE.search(norm):
        hour, minute, explicit = _hour_from(m)
        if not 0 <= hour <= 23 or not 0 <= minute <= 59:
            hour = minute = None
        else:
            w.spans.append(m.span())
    elif m := NOON_RE.search(norm):
        hour, minute, explicit = (12 if m.group(1) == "mediodia" else 0), 0, True
        w.spans.append(m.span())
    if hour is None and (m := PART_RE.search(norm)):
        default_hour = {"manana": 9, "tarde": 16, "noche": 21}[m.group(1)]
        w.spans.append(m.span())

    if hour is None and default_hour is not None:
        hour, minute = default_hour, 0
        w.assumptions.append(f"Tomé las {hour:02d}:00 como horario aproximado.")

    if hour is not None:
        assert minute is not None
        if base is None:
            candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if prefer_pm and not explicit and 1 <= hour <= 7:
                candidate = candidate.replace(hour=hour + 12)
                w.assumptions.append(f"Entendí las {hour + 12:02d}:{minute:02d} (de la tarde).")
            elif prefer_pm and candidate <= now and not explicit and hour < 12 and candidate.replace(hour=hour + 12) > now:
                candidate = candidate.replace(hour=hour + 12)
                w.assumptions.append(f"Entendí las {hour + 12:02d}:{minute:02d}.")
            if candidate <= now:
                candidate += timedelta(days=1)
                w.assumptions.append("Como esa hora ya pasó hoy, lo puse para mañana.")
            w.dt = candidate
        else:
            if prefer_pm and not explicit and 1 <= hour <= 7:
                hour += 12
                w.assumptions.append(f"Entendí las {hour:02d}:{minute:02d} (de la tarde).")
            w.dt = datetime.combine(base, time(hour, minute), tzinfo=now.tzinfo)
        w.has_time = True
    elif base is not None:
        w.day = base
    return w


def remove_spans(text: str, spans: list[tuple[int, int]]) -> str:
    out = text
    for start, end in sorted(spans, reverse=True):
        out = out[:start] + " " + out[end:]
    return re.sub(r"\s{2,}", " ", out).strip(" ,.;:")
