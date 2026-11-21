"""Formato neutro de mensajes y contrato que implementa cada adaptador de proveedor.

Los agentes nunca hablan con una API concreta: construyen un ChatRequest neutro y el
adaptador lo traduce al formato del proveedor (Anthropic, OpenAI, Gemini, Ollama...).
"""

from __future__ import annotations

import abc
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx


@dataclass
class ToolSpec:
    name: str  # ya saneado: [a-zA-Z0-9_-]
    description: str
    parameters: dict[str, Any]


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class Message:
    role: Literal["user", "assistant", "tool"]
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: str | None = None
    tool_name: str | None = None
    is_error: bool = False
    # Contenido nativo del proveedor (p.ej. bloques de búsqueda web de Anthropic) para
    # reenviarlo tal cual si la conversación sigue con el mismo proveedor.
    provider_raw: Any = None
    provider_kind: str | None = None


@dataclass
class ChatRequest:
    model: str
    system: str
    messages: list[Message]
    tools: list[ToolSpec] = field(default_factory=list)
    max_tokens: int = 4096
    temperature: float | None = None
    reasoning: str | None = None  # low | medium | high (solo modelos con capacidad "reasoning")
    native_web_search: bool = False  # búsqueda web del lado del proveedor si la soporta
    json_output: bool = False


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def total(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class Citation:
    url: str
    title: str | None = None


@dataclass
class ChatResponse:
    text: str
    tool_calls: list[ToolCall]
    usage: Usage
    stop_reason: str
    model: str
    provider_raw: Any = None
    citations: list[Citation] = field(default_factory=list)


@dataclass
class StreamEvent:
    type: Literal["text_delta", "done"]
    text: str = ""
    response: ChatResponse | None = None


class ProviderCallError(Exception):
    def __init__(self, message: str, *, retryable: bool, status: int | None = None, auth_error: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        self.status = status
        self.auth_error = auth_error


RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 529}


def error_from_response(resp: httpx.Response, provider: str) -> ProviderCallError:
    try:
        body = resp.json()
        detail = body.get("error", body)
        if isinstance(detail, dict):
            detail = detail.get("message") or json.dumps(detail)[:300]
    except ValueError:
        detail = resp.text[:300]
    status = resp.status_code
    return ProviderCallError(
        f"{provider} respondió {status}: {detail}",
        retryable=status in RETRYABLE_STATUS,
        status=status,
        auth_error=status in (401, 403),
    )


def error_from_exception(exc: Exception, provider: str) -> ProviderCallError:
    if isinstance(exc, httpx.TimeoutException):
        return ProviderCallError(f"{provider}: tiempo de espera agotado", retryable=True)
    if isinstance(exc, httpx.TransportError):
        return ProviderCallError(f"{provider}: error de conexión ({type(exc).__name__})", retryable=True)
    return ProviderCallError(f"{provider}: {exc}", retryable=False)


class ProviderAdapter(abc.ABC):
    kind: str = ""
    label: str = ""
    default_base_url: str = ""
    requires_api_key: bool = True

    def __init__(self, *, api_key: str | None, base_url: str | None, client: httpx.AsyncClient) -> None:
        self.api_key = api_key
        self.base_url = (base_url or self.default_base_url).rstrip("/")
        self.client = client

    @abc.abstractmethod
    async def chat(self, req: ChatRequest) -> ChatResponse: ...

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamEvent]:
        """Por defecto, sin streaming nativo: entrega la respuesta completa en un solo evento."""
        response = await self.chat(req)
        if response.text:
            yield StreamEvent(type="text_delta", text=response.text)
        yield StreamEvent(type="done", response=response)

    @abc.abstractmethod
    async def list_models(self) -> list[str]: ...

    async def embed(self, model: str, texts: list[str], dimensions: int) -> list[list[float]]:
        raise ProviderCallError(f"{self.label} no implementa embeddings", retryable=False)

    async def _post(self, url: str, *, headers: dict[str, str], json_body: dict[str, Any], timeout: float | None = None) -> dict[str, Any]:
        try:
            resp = await self.client.post(url, headers=headers, json=json_body, timeout=timeout)
        except httpx.HTTPError as exc:
            raise error_from_exception(exc, self.label) from exc
        if resp.status_code >= 400:
            raise error_from_response(resp, self.label)
        try:
            return resp.json()
        except ValueError as exc:
            raise ProviderCallError(f"{self.label}: respuesta no es JSON", retryable=True) from exc

    async def _get(self, url: str, *, headers: dict[str, str]) -> dict[str, Any]:
        try:
            resp = await self.client.get(url, headers=headers, timeout=30)
        except httpx.HTTPError as exc:
            raise error_from_exception(exc, self.label) from exc
        if resp.status_code >= 400:
            raise error_from_response(resp, self.label)
        return resp.json()


def parse_sse_lines(lines: list[str]) -> tuple[str | None, str]:
    event = None
    data_parts = []
    for line in lines:
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data_parts.append(line[5:].lstrip())
    return event, "\n".join(data_parts)


async def iter_sse(resp: httpx.Response) -> AsyncIterator[tuple[str | None, str]]:
    buffer: list[str] = []
    async for line in resp.aiter_lines():
        if line == "":
            if buffer:
                yield parse_sse_lines(buffer)
                buffer = []
            continue
        buffer.append(line)
    if buffer:
        yield parse_sse_lines(buffer)


def safe_json_loads(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except ValueError:
        return {"_raw": raw}
    return value if isinstance(value, dict) else {"value": value}
