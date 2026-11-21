"""Adaptador para la Messages API de Anthropic (Claude)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.providers.base import (
    ChatRequest,
    ChatResponse,
    Citation,
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

API_VERSION = "2023-06-01"
WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}


class AnthropicAdapter(ProviderAdapter):
    kind = "anthropic"
    label = "Anthropic"
    default_base_url = "https://api.anthropic.com"

    def _headers(self) -> dict[str, str]:
        return {"x-api-key": self.api_key or "", "anthropic-version": API_VERSION, "content-type": "application/json"}

    def _messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "tool":
                block = {
                    "type": "tool_result",
                    "tool_use_id": m.tool_call_id,
                    "content": m.content or "(sin contenido)",
                    "is_error": m.is_error,
                }
                # Los resultados de herramientas van en un mensaje de usuario; se agrupan si son consecutivos.
                if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list) and all(
                    b.get("type") == "tool_result" for b in out[-1]["content"]
                ):
                    out[-1]["content"].append(block)
                else:
                    out.append({"role": "user", "content": [block]})
            elif m.role == "assistant":
                if m.provider_kind == self.kind and m.provider_raw:
                    out.append({"role": "assistant", "content": m.provider_raw})
                    continue
                blocks: list[dict[str, Any]] = []
                if m.content:
                    blocks.append({"type": "text", "text": m.content})
                for tc in m.tool_calls:
                    blocks.append({"type": "tool_use", "id": tc.id, "name": tc.name, "input": tc.arguments})
                out.append({"role": "assistant", "content": blocks or [{"type": "text", "text": "(vacío)"}]})
            else:
                out.append({"role": "user", "content": m.content or "(vacío)"})
        return out

    def _body(self, req: ChatRequest, *, stream: bool, with_effort: bool = True) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": req.model,
            "max_tokens": req.max_tokens,
            "system": req.system,
            "messages": self._messages(req.messages),
        }
        tools: list[dict[str, Any]] = [
            {"name": t.name, "description": t.description, "input_schema": t.parameters} for t in req.tools
        ]
        if req.native_web_search:
            tools.append(dict(WEB_SEARCH_TOOL))
        if tools:
            body["tools"] = tools
        if req.temperature is not None and not req.reasoning:
            body["temperature"] = req.temperature
        if req.reasoning and with_effort:
            body["output_config"] = {"effort": req.reasoning}
        if stream:
            body["stream"] = True
        return body

    def _parse_content(self, content: list[dict[str, Any]]) -> tuple[str, list[ToolCall], list[Citation]]:
        texts: list[str] = []
        calls: list[ToolCall] = []
        citations: list[Citation] = []
        for block in content:
            btype = block.get("type")
            if btype == "text":
                texts.append(block.get("text", ""))
                for c in block.get("citations") or []:
                    if c.get("url"):
                        citations.append(Citation(url=c["url"], title=c.get("title")))
            elif btype == "tool_use":
                calls.append(ToolCall(id=block["id"], name=block["name"], arguments=block.get("input") or {}))
            elif btype == "web_search_tool_result":
                for r in block.get("content") or []:
                    if isinstance(r, dict) and r.get("url"):
                        citations.append(Citation(url=r["url"], title=r.get("title")))
        return "".join(texts), calls, citations

    async def chat(self, req: ChatRequest) -> ChatResponse:
        url = f"{self.base_url}/v1/messages"
        try:
            data = await self._post(url, headers=self._headers(), json_body=self._body(req, stream=False))
        except ProviderCallError as exc:
            # Modelos sin soporte de "effort": se reintenta una vez sin ese parámetro.
            if exc.status == 400 and req.reasoning and ("effort" in exc.message or "output_config" in exc.message):
                data = await self._post(url, headers=self._headers(), json_body=self._body(req, stream=False, with_effort=False))
            else:
                raise
        content = data.get("content") or []
        text, calls, citations = self._parse_content(content)
        usage = data.get("usage") or {}
        return ChatResponse(
            text=text,
            tool_calls=calls,
            usage=Usage(
                input_tokens=int(usage.get("input_tokens", 0))
                + int(usage.get("cache_read_input_tokens", 0) or 0)
                + int(usage.get("cache_creation_input_tokens", 0) or 0),
                output_tokens=int(usage.get("output_tokens", 0)),
            ),
            stop_reason=data.get("stop_reason") or "end_turn",
            model=data.get("model", req.model),
            provider_raw=content,
            citations=citations,
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[StreamEvent]:
        url = f"{self.base_url}/v1/messages"
        blocks: dict[int, dict[str, Any]] = {}
        partial_json: dict[int, list[str]] = {}
        usage = Usage()
        stop_reason = "end_turn"
        model = req.model
        try:
            async with self.client.stream("POST", url, headers=self._headers(), json=self._body(req, stream=True)) as resp:
                if resp.status_code >= 400:
                    await resp.aread()
                    raise error_from_response(resp, self.label)
                async for event, data in iter_sse(resp):
                    if not data:
                        continue
                    payload = json.loads(data)
                    etype = payload.get("type") or event
                    if etype == "message_start":
                        msg = payload.get("message", {})
                        model = msg.get("model", model)
                        u = msg.get("usage") or {}
                        usage.input_tokens = int(u.get("input_tokens", 0)) + int(u.get("cache_read_input_tokens", 0) or 0)
                    elif etype == "content_block_start":
                        idx = payload["index"]
                        blocks[idx] = dict(payload.get("content_block") or {})
                        if blocks[idx].get("type") == "text":
                            blocks[idx]["text"] = blocks[idx].get("text", "")
                    elif etype == "content_block_delta":
                        idx = payload["index"]
                        delta = payload.get("delta") or {}
                        if delta.get("type") == "text_delta":
                            blocks.setdefault(idx, {"type": "text", "text": ""})
                            blocks[idx]["text"] = blocks[idx].get("text", "") + delta.get("text", "")
                            yield StreamEvent(type="text_delta", text=delta.get("text", ""))
                        elif delta.get("type") == "input_json_delta":
                            partial_json.setdefault(idx, []).append(delta.get("partial_json", ""))
                        elif delta.get("type") == "citations_delta":
                            blocks.setdefault(idx, {"type": "text", "text": ""}).setdefault("citations", []).append(
                                delta.get("citation")
                            )
                    elif etype == "content_block_stop":
                        idx = payload["index"]
                        if idx in partial_json and idx in blocks:
                            blocks[idx]["input"] = safe_json_loads("".join(partial_json.pop(idx)))
                    elif etype == "message_delta":
                        stop_reason = (payload.get("delta") or {}).get("stop_reason") or stop_reason
                        u = payload.get("usage") or {}
                        if "output_tokens" in u:
                            usage.output_tokens = int(u["output_tokens"])
                    elif etype == "error":
                        err = payload.get("error") or {}
                        raise ProviderCallError(
                            f"Anthropic stream error: {err.get('message', 'desconocido')}",
                            retryable=err.get("type") in ("overloaded_error", "api_error", "rate_limit_error"),
                        )
        except httpx.HTTPError as exc:
            raise error_from_exception(exc, self.label) from exc
        content = [blocks[i] for i in sorted(blocks)]
        for block in content:
            if block.get("type") == "tool_use" and "input" not in block:
                block["input"] = {}
        text, calls, citations = self._parse_content(content)
        yield StreamEvent(
            type="done",
            response=ChatResponse(
                text=text, tool_calls=calls, usage=usage, stop_reason=stop_reason, model=model,
                provider_raw=content, citations=citations,
            ),
        )

    async def list_models(self) -> list[str]:
        data = await self._get(f"{self.base_url}/v1/models?limit=100", headers=self._headers())
        return [m["id"] for m in data.get("data", []) if "id" in m]
