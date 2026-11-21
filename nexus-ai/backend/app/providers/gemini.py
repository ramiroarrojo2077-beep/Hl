"""Adaptador para la API de Google Gemini (generateContent)."""

from __future__ import annotations

import uuid
from typing import Any

from app.providers.base import ChatRequest, ChatResponse, Message, ProviderAdapter, ProviderCallError, ToolCall, Usage

_UNSUPPORTED_SCHEMA_KEYS = {"additionalProperties", "$schema", "default", "examples", "title"}


def clean_schema(schema: Any) -> Any:
    """Gemini acepta un subconjunto de OpenAPI: se quitan claves no soportadas."""
    if isinstance(schema, dict):
        return {k: clean_schema(v) for k, v in schema.items() if k not in _UNSUPPORTED_SCHEMA_KEYS}
    if isinstance(schema, list):
        return [clean_schema(v) for v in schema]
    return schema


class GeminiAdapter(ProviderAdapter):
    kind = "gemini"
    label = "Google Gemini"
    default_base_url = "https://generativelanguage.googleapis.com/v1beta"

    def _headers(self) -> dict[str, str]:
        return {"x-goog-api-key": self.api_key or "", "content-type": "application/json"}

    def _contents(self, messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "tool":
                part = {"functionResponse": {"name": m.tool_name or "tool", "response": {"result": m.content, "is_error": m.is_error}}}
                if out and out[-1]["role"] == "user" and all("functionResponse" in p for p in out[-1]["parts"]):
                    out[-1]["parts"].append(part)
                else:
                    out.append({"role": "user", "parts": [part]})
            elif m.role == "assistant":
                parts: list[dict[str, Any]] = []
                if m.content:
                    parts.append({"text": m.content})
                for tc in m.tool_calls:
                    parts.append({"functionCall": {"name": tc.name, "args": tc.arguments}})
                out.append({"role": "model", "parts": parts or [{"text": "(vacío)"}]})
            else:
                out.append({"role": "user", "parts": [{"text": m.content or "(vacío)"}]})
        return out

    async def chat(self, req: ChatRequest) -> ChatResponse:
        body: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": req.system}]},
            "contents": self._contents(req.messages),
            "generationConfig": {"maxOutputTokens": req.max_tokens},
        }
        if req.temperature is not None:
            body["generationConfig"]["temperature"] = req.temperature
        if req.json_output and not req.tools:
            body["generationConfig"]["responseMimeType"] = "application/json"
        if req.tools:
            declarations = []
            for t in req.tools:
                decl: dict[str, Any] = {"name": t.name, "description": t.description}
                if t.parameters.get("properties"):
                    decl["parameters"] = clean_schema(t.parameters)
                declarations.append(decl)
            body["tools"] = [{"functionDeclarations": declarations}]
        data = await self._post(f"{self.base_url}/models/{req.model}:generateContent", headers=self._headers(), json_body=body)
        candidates = data.get("candidates") or []
        if not candidates:
            reason = (data.get("promptFeedback") or {}).get("blockReason", "sin candidatos")
            raise ProviderCallError(f"Gemini no devolvió respuesta ({reason})", retryable=False)
        parts = (candidates[0].get("content") or {}).get("parts") or []
        texts, calls = [], []
        for p in parts:
            if "text" in p and not p.get("thought"):
                texts.append(p["text"])
            if "functionCall" in p:
                fc = p["functionCall"]
                calls.append(ToolCall(id=f"call_{uuid.uuid4().hex[:12]}", name=fc.get("name", ""), arguments=fc.get("args") or {}))
        meta = data.get("usageMetadata") or {}
        return ChatResponse(
            text="".join(texts),
            tool_calls=calls,
            usage=Usage(int(meta.get("promptTokenCount", 0)), int(meta.get("candidatesTokenCount", 0)) + int(meta.get("thoughtsTokenCount", 0))),
            stop_reason=candidates[0].get("finishReason", "STOP"),
            model=data.get("modelVersion", req.model),
        )

    async def list_models(self) -> list[str]:
        data = await self._get(f"{self.base_url}/models?pageSize=200", headers=self._headers())
        return sorted(m["name"].removeprefix("models/") for m in data.get("models", []) if "name" in m)

    async def embed(self, model: str, texts: list[str], dimensions: int) -> list[list[float]]:
        body = {
            "requests": [
                {"model": f"models/{model}", "content": {"parts": [{"text": t}]}, "outputDimensionality": dimensions}
                for t in texts
            ]
        }
        data = await self._post(f"{self.base_url}/models/{model}:batchEmbedContents", headers=self._headers(), json_body=body)
        return [e["values"] for e in data.get("embeddings", [])]
