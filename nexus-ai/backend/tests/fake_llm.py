"""Doble de prueba de la API HTTP de Anthropic (Messages API, con y sin streaming).

Se inyecta como transport de httpx: el adaptador real de NEXUS construye y parsea las
solicitudes como lo haría contra el servicio verdadero. Las respuestas son guionadas
según el tipo de solicitud para poder verificar el orquestador de punta a punta.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Any

import httpx

PLAN_DEFAULT = {
    "analysis": "El usuario quiere una app de gestión de videojuegos.",
    "complexity": "complex",
    "needs_research": True,
    "strategy": "Investigar y diseñar en paralelo; luego arquitectura.",
    "risks": ["alcance"],
    "tasks": [
        {"key": "t1", "title": "Investigar tecnologías", "description": "Comparar stacks", "task_type": "research", "agent": "atlas", "depends_on": []},
        {"key": "t2", "title": "Prototipo visual", "description": "Proponer UI", "task_type": "design", "agent": "nova", "depends_on": []},
        {"key": "t3", "title": "Arquitectura", "description": "Diseñar arquitectura", "task_type": "code", "agent": "cipher", "depends_on": ["t1", "t2"]},
    ],
}


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") if isinstance(b, dict) and b.get("type") == "text" else
                         (str(b.get("content", "")) if isinstance(b, dict) and b.get("type") == "tool_result" else "")
                         for b in content)
    return ""


class FakeAnthropic:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.failures: dict[str, list[int]] = {}  # modelo -> lista de status a devolver en orden
        self.plan: dict[str, Any] = json.loads(json.dumps(PLAN_DEFAULT))
        self.review_verdicts: list[dict[str, Any]] = []
        self.security = {"status": "ok", "summary": "Sin hallazgos", "findings": []}
        # clave de tarea -> lista de (tool_name, input) que el agente pedirá antes de responder
        self.task_tools: dict[str, list[tuple[str, dict[str, Any]]]] = {}
        self.meeting_continue = False
        self.chat_tool: tuple[str, dict[str, Any]] | None = None
        self.custom: Callable[[dict[str, Any]], dict[str, Any] | None] | None = None
        # Devuelve un status HTTP de error para inyectar fallas selectivas (o None).
        self.fail_when: Callable[[dict[str, Any]], int | None] | None = None
        self.models = ["claude-test-opus", "claude-test-haiku"]

    # ------------------------------------------------------------ transport
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/v1/models"):
            if request.headers.get("x-api-key") == "bad-key":
                return httpx.Response(401, json={"error": {"type": "authentication_error", "message": "invalid x-api-key"}})
            return httpx.Response(200, json={"data": [{"id": m} for m in self.models]})
        body = json.loads(request.content)
        self.calls.append(body)
        if request.headers.get("x-api-key") == "bad-key":
            return httpx.Response(401, json={"error": {"type": "authentication_error", "message": "invalid x-api-key"}})
        if self.fail_when and (status := self.fail_when(body)):
            return httpx.Response(status, json={"error": {"type": "api_error", "message": "Internal error"}})
        queue = self.failures.get(body["model"])
        if queue:
            status = queue.pop(0)
            return httpx.Response(status, json={"error": {"type": "overloaded_error", "message": "Overloaded"}})
        reply = self.respond(body)
        message = self._message(body["model"], reply)
        if body.get("stream"):
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=self._sse(message))
        return httpx.Response(200, json=message)

    # ------------------------------------------------------------ guion
    def respond(self, body: dict[str, Any]) -> dict[str, Any]:
        if self.custom and (r := self.custom(body)) is not None:
            return r
        messages = body["messages"]
        first = _text_of(messages[0]["content"])
        last = messages[-1]
        last_is_tool_result = isinstance(last["content"], list) and any(
            isinstance(b, dict) and b.get("type") == "tool_result" for b in last["content"]
        )
        tool_names = {t.get("name") for t in body.get("tools", [])}
        system = body.get("system", "")

        if "diseñá el plan de ejecución" in first:
            return {"text": json.dumps(self.plan)}
        if "Revisá el trabajo del equipo" in first:
            verdict = self.review_verdicts.pop(0) if self.review_verdicts else {"verdict": "approve", "score": 8, "summary": "Cumple el objetivo", "issues": []}
            return {"text": json.dumps(verdict)}
        if "Auditá la seguridad" in first:
            return {"text": json.dumps(self.security)}
        if "Consolidá el resultado final" in first:
            return {"text": "# Informe final\n\nResumen ejecutivo: misión cumplida con los entregables del equipo.\n\n"
                            "```json\n" + json.dumps({"learnings": [
                                {"content": "Para apps de gestión de videojuegos conviene separar catálogo y biblioteca del usuario.",
                                 "kind": "learning", "scope": "shared", "confidence": 0.7}]}) + "\n```"}
        if "hace falta otra ronda" in first:
            return {"text": json.dumps({"continue": self.meeting_continue, "reason": "suficiente", "focus": "cerrar"})}
        if "Redactá el acta" in first:
            return {"text": json.dumps({"summary": "Se acordó un enfoque modular.", "decisions": ["Usar arquitectura modular"],
                                        "arguments": [{"agent": "atlas", "point": "evidencia"}], "disagreements": [],
                                        "derived_tasks": [{"title": "Prototipo", "description": "Armar prototipo", "agent": "cipher", "priority": 2}],
                                        "next_steps": ["Crear prototipo"]})}
        if "te consulta:" in first:
            return {"text": "Respuesta especializada: recomiendo validar con datos reales."}
        if "Ronda " in first and "de " in first and "Empezá tu intervención" in first:
            return {"text": "[PROPUESTA] Desde mi especialidad propongo un enfoque modular y verificable."}
        if "Tu tarea (" in first:
            key = first.split("Tu tarea (", 1)[1].split(")", 1)[0]
            planned = self.task_tools.get(key, [])
            used = sum(1 for m in messages if m["role"] == "assistant")
            if used < len(planned):
                name, args = planned[used]
                if name in tool_names:
                    return {"tool": (name, args)}
            return {"text": f"Resultado de {key}: entregable completo y verificable."}
        if "Contexto del chat" in system:
            if self.chat_tool and not last_is_tool_result and self.chat_tool[0] in tool_names:
                return {"tool": self.chat_tool}
            if last_is_tool_result:
                return {"text": "Listo: " + _text_of(last["content"])[:200]}
            return {"text": "Hola, soy NEXUS. ¿En qué trabajamos hoy?"}
        return {"text": "OK"}

    # ------------------------------------------------------------ formato Anthropic
    def _message(self, model: str, reply: dict[str, Any]) -> dict[str, Any]:
        content: list[dict[str, Any]] = []
        stop = "end_turn"
        if reply.get("text"):
            content.append({"type": "text", "text": reply["text"]})
        if reply.get("tool"):
            name, args = reply["tool"]
            content.append({"type": "tool_use", "id": f"toolu_{uuid.uuid4().hex[:10]}", "name": name, "input": args})
            stop = "tool_use"
        return {
            "id": f"msg_{uuid.uuid4().hex[:10]}", "type": "message", "role": "assistant", "model": model,
            "content": content, "stop_reason": stop,
            "usage": {"input_tokens": 1200, "output_tokens": 300},
        }

    def _sse(self, message: dict[str, Any]) -> bytes:
        events = [("message_start", {"type": "message_start", "message": {**message, "content": [], "usage": {"input_tokens": 1200, "output_tokens": 0}}})]
        for i, block in enumerate(message["content"]):
            if block["type"] == "text":
                events.append(("content_block_start", {"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}}))
                text = block["text"]
                for chunk in [text[j:j + 12] for j in range(0, len(text), 12)]:
                    events.append(("content_block_delta", {"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": chunk}}))
            else:
                events.append(("content_block_start", {"type": "content_block_start", "index": i,
                                                       "content_block": {"type": "tool_use", "id": block["id"], "name": block["name"], "input": {}}}))
                events.append(("content_block_delta", {"type": "content_block_delta", "index": i,
                                                       "delta": {"type": "input_json_delta", "partial_json": json.dumps(block["input"])}}))
            events.append(("content_block_stop", {"type": "content_block_stop", "index": i}))
        events.append(("message_delta", {"type": "message_delta", "delta": {"stop_reason": message["stop_reason"]}, "usage": {"output_tokens": 300}}))
        events.append(("message_stop", {"type": "message_stop"}))
        return "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in events).encode()

    # ------------------------------------------------------------ consultas
    def calls_matching(self, needle: str) -> list[dict[str, Any]]:
        return [c for c in self.calls if needle in _text_of(c["messages"][0]["content"])]
