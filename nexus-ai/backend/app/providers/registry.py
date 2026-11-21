"""Registro de adaptadores y cliente HTTP compartido."""

from __future__ import annotations

import re

import httpx

from app.core.config import get_settings
from app.core.crypto import decrypt_str
from app.models import AIProvider
from app.providers.anthropic import AnthropicAdapter
from app.providers.base import ProviderAdapter
from app.providers.gemini import GeminiAdapter
from app.providers.ollama import OllamaAdapter
from app.providers.openai import OpenAIAdapter, OpenAICompatibleAdapter

ADAPTERS: dict[str, type[ProviderAdapter]] = {
    a.kind: a for a in (AnthropicAdapter, OpenAIAdapter, OpenAICompatibleAdapter, GeminiAdapter, OllamaAdapter)
}

_client: httpx.AsyncClient | None = None
# Los tests inyectan aquí un httpx.MockTransport que emula las APIs de los proveedores.
_transport_override: httpx.AsyncBaseTransport | None = None


def set_transport_override(transport: httpx.AsyncBaseTransport | None) -> None:
    global _transport_override, _client
    _transport_override = transport
    _client = None


def http_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        timeout = httpx.Timeout(get_settings().llm_timeout_seconds, connect=15.0)
        _client = httpx.AsyncClient(timeout=timeout, transport=_transport_override, follow_redirects=False)
    return _client


async def close_http_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
    _client = None


def adapter_for(provider: AIProvider) -> ProviderAdapter:
    cls = ADAPTERS.get(provider.kind)
    if cls is None:
        raise ValueError(f"Proveedor no soportado: {provider.kind}")
    api_key = decrypt_str(provider.api_key_encrypted) if provider.api_key_encrypted else None
    return cls(api_key=api_key, base_url=provider.base_url, client=http_client())


# Capacidades sugeridas al importar un modelo por nombre. Son una ayuda inicial: el
# usuario las revisa y corrige desde Ajustes > Modelos.
_PRESETS: list[tuple[re.Pattern[str], list[str], int]] = [
    (re.compile(r"embed", re.I), ["embedding"], 3),
    (re.compile(r"claude.*(opus|fable)", re.I), ["chat", "tools", "reasoning", "code", "vision", "long_context", "web_search"], 5),
    (re.compile(r"claude.*sonnet", re.I), ["chat", "tools", "reasoning", "code", "vision", "long_context", "web_search"], 4),
    (re.compile(r"claude.*haiku", re.I), ["chat", "tools", "code", "vision", "long_context"], 3),
    (re.compile(r"^(o\d|gpt-5)", re.I), ["chat", "tools", "reasoning", "code", "vision", "long_context"], 5),
    (re.compile(r"gpt-4\.1|gpt-4o", re.I), ["chat", "tools", "code", "vision", "long_context"], 4),
    (re.compile(r"mini|nano|flash-lite", re.I), ["chat", "tools"], 2),
    (re.compile(r"gemini.*pro", re.I), ["chat", "tools", "reasoning", "code", "vision", "long_context"], 4),
    (re.compile(r"gemini.*flash", re.I), ["chat", "tools", "vision", "long_context"], 3),
    (re.compile(r"coder|codestral|deepseek", re.I), ["chat", "tools", "code"], 3),
]


def suggest_capabilities(model_name: str) -> tuple[list[str], int]:
    for pattern, caps, tier in _PRESETS:
        if pattern.search(model_name):
            return list(caps), tier
    return ["chat"], 2
