"""Normalización y validación de números para WhatsApp (foco en Argentina).

Formato que espera WhatsApp para celulares argentinos: 54 9 <área sin 0> <número sin 15>,
donde área + número suman 10 dígitos. Ejemplo: 011 15 2345-6789 → 5491123456789.

Cuando el número es ambiguo (falta el código de área, o no se puede saber si es celular)
el resultado lo dice explícitamente y la app pregunta antes de seguir: nunca se adivina en
silencio. La misma lógica existe en Android (PhoneNormalizer.kt) y ambas se prueban con
los vectores de shared/phone_vectors_ar.json.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

# Códigos de área de 3 dígitos (sin el 0). El 11 (AMBA) es el único de 2 dígitos; el resto son de 4.
AREA_CODES_3 = {
    "220", "221", "223", "230", "236", "237", "249", "260", "261", "263", "264", "266", "280", "291", "294", "297",
    "298", "299", "336", "341", "342", "343", "345", "348", "351", "353", "358", "362", "364", "370", "376", "379",
    "380", "381", "383", "385", "387", "388",
}


@dataclass
class PhoneResult:
    input: str
    status: str  # ok | needs_confirmation | needs_area_code | invalid
    e164: str | None = None  # dígitos sin '+', listo para wa.me
    display: str | None = None
    masked: str | None = None
    country: str | None = None  # AR | other
    is_mobile: bool | None = None
    assumptions: list[str] = field(default_factory=list)
    message: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def area_length(national10: str) -> int:
    if national10.startswith("11"):
        return 2
    if national10[:3] in AREA_CODES_3:
        return 3
    return 4


def mask(e164: str) -> str:
    """Oculta parcialmente el número: +54 9 11 ****-6789."""
    if e164.startswith("549") and len(e164) == 13:
        national = e164[3:]
        alen = area_length(national)
        return f"+54 9 {national[:alen]} ****-{national[-4:]}"
    return "+" + "*" * (len(e164) - 4) + e164[-4:] if len(e164) > 6 else "****"


def display(e164: str) -> str:
    if e164.startswith("549") and len(e164) == 13:
        national = e164[3:]
        alen = area_length(national)
        local = national[alen:]
        return f"+54 9 {national[:alen]} {local[:-4]}-{local[-4:]}"
    return f"+{e164}"


def _strip_15(national: str) -> str | None:
    """national: área + [15] + número (12 dígitos). Devuelve 10 dígitos si el 15 está donde corresponde."""
    for alen in (2, 3, 4):
        area = national[:alen]
        if alen == 2 and area != "11":
            continue
        if alen == 3 and area not in AREA_CODES_3:
            continue
        if national[alen:alen + 2] == "15":
            candidate = area + national[alen + 2:]
            if len(candidate) == 10:
                return candidate
    return None


def _ok(raw: str, national10: str, assumptions: list[str], message: str = "") -> PhoneResult:
    e164 = "549" + national10
    status = "needs_confirmation" if assumptions else "ok"
    return PhoneResult(input=raw, status=status, e164=e164, display=display(e164), masked=mask(e164), country="AR",
                       is_mobile=True, assumptions=assumptions, message=message or ("Verificá el número antes de seguir." if assumptions else ""))


def normalize(raw: str, default_area_code: str | None = None) -> PhoneResult:
    text = (raw or "").strip()
    if not text:
        return PhoneResult(input=raw, status="invalid", message="No hay número")
    if re.search(r"[A-Za-z]", text):
        return PhoneResult(input=raw, status="invalid", message="El número tiene letras")
    plus = text.startswith("+")
    digits = re.sub(r"\D", "", text)
    if digits.startswith("00"):
        digits, plus = digits[2:], True
    if plus or (digits.startswith("54") and len(digits) in (12, 13, 14)):
        if not digits.startswith("54"):
            if 8 <= len(digits) <= 15:
                return PhoneResult(input=raw, status="ok", e164=digits, display="+" + digits, masked=mask(digits), country="other",
                                   message="Número internacional: se usa tal cual.")
            return PhoneResult(input=raw, status="invalid", message="Longitud de número internacional inválida")
        rest = digits[2:]
        if rest.startswith("9"):
            rest = rest[1:]
            if len(rest) == 10:
                return _ok(raw, rest, [])
            if len(rest) == 12 and (n := _strip_15(rest)):
                return _ok(raw, n, ["Quité el 15: en formato internacional no va."])
            if len(rest) == 11 and rest.startswith("0"):
                return _ok(raw, rest[1:], ["Quité el 0 del código de área."])
            return PhoneResult(input=raw, status="invalid", message="El número argentino no tiene la longitud esperada")
        if rest.startswith("0"):
            rest = rest[1:]
        if len(rest) == 12 and (n := _strip_15(rest)):
            return _ok(raw, n, ["Quité el 15 y agregué el 9 de celular."])
        if len(rest) == 10:
            return _ok(raw, rest, ["Agregué el 9 de celular: WhatsApp lo necesita para móviles argentinos. Si es un fijo, no va a funcionar."])
        return PhoneResult(input=raw, status="invalid", message="El número argentino no tiene la longitud esperada")
    # Formato nacional
    if digits.startswith("0"):
        national = digits[1:]
        if len(national) == 12 and (n := _strip_15(national)):
            return _ok(raw, n, [])
        if len(national) == 10:
            return _ok(raw, national, ["No tiene 15: asumí que es un celular."])
        return PhoneResult(input=raw, status="invalid", message="El número nacional no tiene la longitud esperada")
    if len(digits) == 12 and (n := _strip_15(digits)):
        return _ok(raw, n, [])
    if len(digits) == 10:
        if digits.startswith("15"):
            return _area_needed(raw, digits[2:], default_area_code, ["Quité el 15."])
        return _ok(raw, digits, ["Asumí que es un celular con código de área."])
    if len(digits) in (6, 7, 8):
        return _area_needed(raw, digits, default_area_code, [])
    return PhoneResult(input=raw, status="invalid", message="No reconozco el formato del número")


def _area_needed(raw: str, local: str, default_area: str | None, assumptions: list[str]) -> PhoneResult:
    area = (default_area or "").lstrip("0")
    if area and area.isdigit() and len(area + local) == 10:
        return _ok(raw, area + local, [*assumptions, f"Usé tu código de área predeterminado ({area})."])
    return PhoneResult(input=raw, status="needs_area_code", country="AR", assumptions=assumptions,
                       message="Falta el código de área. ¿De qué ciudad es el número?")


def wa_link(e164: str, text: str) -> str:
    from urllib.parse import quote

    return f"https://wa.me/{e164}?text={quote(text, safe='')}" if text else f"https://wa.me/{e164}"
