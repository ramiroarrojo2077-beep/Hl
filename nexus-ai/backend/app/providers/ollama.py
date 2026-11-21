"""Adaptador para modelos locales servidos por Ollama."""

from __future__ import annotations

import uuid
from typing import Any

from app.providers.base import ChatRequest, ChatResponse, Message, ProviderAdapter, ProviderCallError, ToolCall, Usage


class OllamaAdapter(ProviderAdapter):
    kind = "ollama"
    label = "Ollama"
    default_base_url = "http://localhost:11434"
    requires_api_key = False

    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        return headers

    def _messages(self, system: str, messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = [{"role": "system", "content": system}]
        for m in messages:
            if m.role == "tool":
                out.append({"role": "tool", "content": m.content, "tool_name": m.tool_name})
            elif m.role == "assistant":
                msg: dict[str, Any] = {"role": "assistant", "content": m.content}
                if m.tool_calls:
                    msg["tool_calls"] = [{"function": {"name": tc.name, "arguments": tc.arguments}} for tc in m.tool_calls]
                out.append(msg)
            else:
                out.append({"role": "user", "content": m.content})
        return out

    async def chat(self, req: ChatRequest) -> ChatResponse:
        body: dict[str, Any] = {
            "model": req.model,
            "messages": self._messages(req.system, req.messages),
            "stream": False,
            "options": {"num_predict": req.max_tokens},
        }
        if req.temperature is not None:
            body["options"]["temperature"] = req.temperature
        if req.tools:
            body["tools"] = [
                {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
                for t in req.tools
            ]
        if req.json_output and not req.tools:
            body["format"] = "json"
        data = await self._post(f"{self.base_url}/api/chat", headers=self._headers(), json_body=body)
        msg = data.get("message")
        if not isinstance(msg, dict):
            raise ProviderCallError("Ollama: respuesta sin mensaje", retryable=True)
        calls = [
            ToolCall(
                id=f"call_{uuid.uuid4().hex[:12]}",
                name=(tc.get("function") or {}).get("name", ""),
                arguments=(tc.get("function") or {}).get("arguments") or {},
            )
            for tc in msg.get("tool_calls") or []
        ]
        return ChatResponse(
            text=msg.get("content") or "",
            tool_calls=calls,
            usage=Usage(int(data.get("prompt_eval_count", 0)), int(data.get("eval_count", 0))),
            stop_reason=data.get("done_reason", "stop"),
            model=data.get("model", req.model),
        )

    async def list_models(self) -> list[str]:
        data = await self._get(f"{self.base_url}/api/tags", headers=self._headers())
        return sorted(m["name"] for m in data.get("models", []) if "name" in m)

    async def embed(self, model: str, texts: list[str], dimensions: int) -> list[list[float]]:
        data = await self._post(f"{self.base_url}/api/embed", headers=self._headers(), json_body={"model": model, "input": texts})
        return data.get("embeddings", [])
