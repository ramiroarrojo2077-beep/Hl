"""Adaptador para OpenAI Chat Completions y cualquier API compatible (OpenRouter, Groq,
vLLM, LM Studio, Together, DeepSeek...)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.providers.base import (
    ChatRequest,
    ChatResponse,
    Message,
    ProviderAdapter,
    ProviderCallError,
    StreamEvent,
    ToolCall,
    Usage,
    error_from_exception,
    error_from_response,
    iter_sse,
    safe_json_loads,
)


class OpenAIAdapter(ProviderAdapter):
    kind = "openai"
    label = "OpenAI"
    default_base_url = "https://api.openai.com/v1"
    # La API oficial usa max_completion_tokens; muchas compatibles solo aceptan max_tokens.
    max_tokens_field = "max_completion_tokens"

    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        return headers

    def _messages(self, system: str, messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = [{"role": "system", "content": system}]
        for m in messages:
            if m.role == "tool":
                out.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content or "(sin contenido)"})
            elif m.role == "assistant":
                msg: dict[str, Any] = {"role": "assistant", "content": m.content or None}
                if m.tool_calls:
                    msg["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
                        }
                        for tc in m.tool_calls
                    ]
                out.append(msg)
            else:
                out.append({"role": "user", "content": m.content})
        return out

    def _body(self, req: ChatRequest, *, stream: bool) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": req.model,
            "messages": self._messages(req.system, req.messages),
            self.max_tokens_field: req.max_tokens,
        }
        if req.tools:
            body["tools"] = [
                {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
                for t in req.tools
            ]
        if req.reasoning:
            body["reasoning_effort"] = req.reasoning
        elif req.temperature is not None:
            body["temperature"] = req.temperature
        if req.json_output and not req.tools:
            body["response_format"] = {"type": "json_object"}
        if stream:
            body["stream"] = True
            body["stream_options"] = {"include_usage": True}
        return body

    async def chat(self, req: ChatRequest) -> ChatResponse:
        data = await self._post(f"{self.base_url}/chat/completions", headers=self._headers(), json_body=self._body(req, stream=False))
        choices = data.get("choices") or []
        if not choices:
            raise ProviderCallError(f"{self.label}: respuesta sin choices", retryable=True)
        msg = choices[0].get("message") or {}
        calls = [
            ToolCall(
                id=tc.get("id") or f"call_{i}",
                name=(tc.get("function") or {}).get("name", ""),
                arguments=safe_json_loads((tc.get("function") or {}).get("arguments")),
            )
            for i, tc in enumerate(msg.get("tool_calls") or [])
        ]
        usage = data.get("usage") or {}
        return ChatResponse(
            text=msg.get("content") or "",
            tool_calls=calls,
            usage=Usage(int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))),
            stop_reason=choices[0].get("finish_reason") or "stop",
            model=data.get("model", req.model),
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamEvent]:
        text_parts: list[str] = []
        calls: dict[int, dict[str, Any]] = {}
        usage = Usage()
        stop_reason = "stop"
        model = req.model
        try:
            async with self.client.stream(
                "POST", f"{self.base_url}/chat/completions", headers=self._headers(), json=self._body(req, stream=True)
            ) as resp:
                if resp.status_code >= 400:
                    await resp.aread()
                    raise error_from_response(resp, self.label)
                async for _, data in iter_sse(resp):
                    if not data or data == "[DONE]":
                        continue
                    chunk = json.loads(data)
                    model = chunk.get("model", model)
                    if chunk.get("usage"):
                        usage = Usage(int(chunk["usage"].get("prompt_tokens", 0)), int(chunk["usage"].get("completion_tokens", 0)))
                    for choice in chunk.get("choices") or []:
                        delta = choice.get("delta") or {}
                        if delta.get("content"):
                            text_parts.append(delta["content"])
                            yield StreamEvent(type="text_delta", text=delta["content"])
                        for tc in delta.get("tool_calls") or []:
                            slot = calls.setdefault(tc.get("index", 0), {"id": None, "name": "", "args": []})
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["name"] += fn["name"]
                            if fn.get("arguments"):
                                slot["args"].append(fn["arguments"])
                        if choice.get("finish_reason"):
                            stop_reason = choice["finish_reason"]
        except httpx.HTTPError as exc:
            raise error_from_exception(exc, self.label) from exc
        tool_calls = [
            ToolCall(id=c["id"] or f"call_{i}", name=c["name"], arguments=safe_json_loads("".join(c["args"])))
            for i, c in sorted(calls.items())
        ]
        yield StreamEvent(
            type="done",
            response=ChatResponse(text="".join(text_parts), tool_calls=tool_calls, usage=usage, stop_reason=stop_reason, model=model),
        )

    async def list_models(self) -> list[str]:
        data = await self._get(f"{self.base_url}/models", headers=self._headers())
        return sorted(m["id"] for m in data.get("data", []) if "id" in m)

    async def embed(self, model: str, texts: list[str], dimensions: int) -> list[list[float]]:
        body: dict[str, Any] = {"model": model, "input": texts}
        if "text-embedding-3" in model:
            body["dimensions"] = dimensions
        data = await self._post(f"{self.base_url}/embeddings", headers=self._headers(), json_body=body)
        rows = sorted(data.get("data", []), key=lambda r: r.get("index", 0))
        return [r["embedding"] for r in rows]


class OpenAICompatibleAdapter(OpenAIAdapter):
    kind = "openai_compatible"
    label = "OpenAI-compatible"
    default_base_url = "http://localhost:8000/v1"
    requires_api_key = False
    max_tokens_field = "max_tokens"
