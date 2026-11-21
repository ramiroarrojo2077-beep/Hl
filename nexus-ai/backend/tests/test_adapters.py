"""Traducción del formato neutro a cada API de proveedor y de vuelta."""

from __future__ import annotations

import json

import httpx
import pytest

from app.providers.base import ChatRequest, Message, ProviderCallError, ToolCall, ToolSpec
from app.providers.gemini import GeminiAdapter
from app.providers.ollama import OllamaAdapter
from app.providers.openai import OpenAIAdapter, OpenAICompatibleAdapter

TOOL = ToolSpec(name="memory__search", description="Busca", parameters={
    "type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"], "additionalProperties": False})
HISTORY = [
    Message(role="user", content="Buscá algo"),
    Message(role="assistant", content="", tool_calls=[ToolCall(id="call_1", name="memory__search", arguments={"query": "x"})]),
    Message(role="tool", content="resultado", tool_call_id="call_1", tool_name="memory__search"),
]


def capture(response_json, status=200):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content) if request.content else None
        return httpx.Response(status, json=response_json)

    return seen, httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_openai_translation_and_tool_calls():
    seen, client = capture({"model": "gpt-x", "choices": [{"message": {"content": None, "tool_calls": [
        {"id": "call_9", "type": "function", "function": {"name": "memory__search", "arguments": '{"query": "y"}'}}]},
        "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
    adapter = OpenAIAdapter(api_key="sk-test", base_url=None, client=client)
    res = await adapter.chat(ChatRequest(model="gpt-x", system="sys", messages=HISTORY, tools=[TOOL], reasoning="high"))
    body = seen["body"]
    assert seen["url"] == "https://api.openai.com/v1/chat/completions" and seen["headers"]["authorization"] == "Bearer sk-test"
    assert body["messages"][0] == {"role": "system", "content": "sys"}
    assert body["messages"][2]["tool_calls"][0]["function"]["arguments"] == '{"query": "x"}'
    assert body["messages"][3] == {"role": "tool", "tool_call_id": "call_1", "content": "resultado"}
    assert body["max_completion_tokens"] == 4096 and body["reasoning_effort"] == "high" and "temperature" not in body
    assert res.tool_calls[0].arguments == {"query": "y"} and res.usage.total == 15


async def test_openai_compatible_uses_max_tokens_and_custom_url():
    seen, client = capture({"choices": [{"message": {"content": "hola"}, "finish_reason": "stop"}], "usage": {}})
    adapter = OpenAICompatibleAdapter(api_key=None, base_url="http://vllm.local:8000/v1", client=client)
    res = await adapter.chat(ChatRequest(model="llama", system="s", messages=[Message(role="user", content="hi")], temperature=0.3))
    assert seen["url"] == "http://vllm.local:8000/v1/chat/completions" and "authorization" not in seen["headers"]
    assert seen["body"]["max_tokens"] == 4096 and seen["body"]["temperature"] == 0.3 and res.text == "hola"


async def test_gemini_translation_and_schema_cleaning():
    seen, client = capture({"candidates": [{"content": {"parts": [{"text": "pienso", "thought": True}, {"text": "listo"},
                                                                  {"functionCall": {"name": "memory__search", "args": {"query": "z"}}}]},
                                            "finishReason": "STOP"}],
                            "usageMetadata": {"promptTokenCount": 7, "candidatesTokenCount": 3}})
    adapter = GeminiAdapter(api_key="AIza-test", base_url=None, client=client)
    res = await adapter.chat(ChatRequest(model="gemini-x", system="sys", messages=HISTORY, tools=[TOOL]))
    body = seen["body"]
    assert seen["url"].endswith("/models/gemini-x:generateContent") and seen["headers"]["x-goog-api-key"] == "AIza-test"
    assert body["systemInstruction"]["parts"][0]["text"] == "sys"
    assert [c["role"] for c in body["contents"]] == ["user", "model", "user"]
    assert body["contents"][2]["parts"][0]["functionResponse"]["name"] == "memory__search"
    params = body["tools"][0]["functionDeclarations"][0]["parameters"]
    assert "additionalProperties" not in params
    assert res.text == "listo" and res.tool_calls[0].arguments == {"query": "z"} and res.usage.total == 10


async def test_ollama_translation():
    seen, client = capture({"model": "qwen", "message": {"content": "", "tool_calls": [{"function": {"name": "memory__search", "arguments": {"query": "q"}}}]},
                            "prompt_eval_count": 4, "eval_count": 2, "done_reason": "stop"})
    adapter = OllamaAdapter(api_key=None, base_url=None, client=client)
    res = await adapter.chat(ChatRequest(model="qwen", system="s", messages=HISTORY, tools=[TOOL]))
    assert seen["url"] == "http://localhost:11434/api/chat" and seen["body"]["stream"] is False
    assert seen["body"]["messages"][3] == {"role": "tool", "content": "resultado", "tool_name": "memory__search"}
    assert res.tool_calls[0].name == "memory__search" and res.usage.total == 6


@pytest.mark.parametrize("status,retryable,auth", [(429, True, False), (503, True, False), (401, False, True), (400, False, False)])
async def test_error_classification(status, retryable, auth):
    _, client = capture({"error": {"message": "boom"}}, status=status)
    adapter = OpenAIAdapter(api_key="k", base_url=None, client=client)
    with pytest.raises(ProviderCallError) as exc:
        await adapter.chat(ChatRequest(model="m", system="s", messages=[Message(role="user", content="x")]))
    assert exc.value.retryable is retryable and exc.value.auth_error is auth and "boom" in exc.value.message
