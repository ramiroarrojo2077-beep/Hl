"""Planificador: NEXUS convierte un objetivo en un grafo de tareas validado."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Agent, Mission, Project
from app.models.enums import TaskType
from app.orchestrator.jsonutil import JSONExtractionError, extract_json

KEY_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,40}$")


class PlanValidationError(ValueError):
    pass


@dataclass
class PlannedTask:
    key: str
    title: str
    description: str
    task_type: str
    agent_slug: str
    depends_on: list[str]
    priority: int = 3
    requires_approval: bool = False


@dataclass
class Plan:
    analysis: str
    complexity: str
    needs_research: bool
    strategy: str
    tasks: list[PlannedTask]
    risks: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "analysis": self.analysis,
            "complexity": self.complexity,
            "needs_research": self.needs_research,
            "strategy": self.strategy,
            "risks": self.risks,
            "tasks": [t.__dict__ for t in self.tasks],
        }


def roster_text(agents: list[Agent]) -> str:
    return "\n".join(
        f"- {a.slug}: {a.name}, {a.role}. Especialidades: {', '.join(a.profile.specialties)}." for a in agents
    )


async def planning_prompt(session: AsyncSession, mission: Mission, agents: list[Agent]) -> str:
    settings = get_settings()
    project_block = ""
    if mission.project_id:
        project = await session.get(Project, mission.project_id)
        if project:
            project_block = f"\nProyecto: {project.name}\nObjetivo del proyecto: {project.objective}\nDescripción: {project.description}\n"
    task_types = ", ".join(t.value for t in TaskType if t != TaskType.REVISION)
    return f"""Recibiste una misión del usuario. Analizala y diseñá el plan de ejecución del equipo.

Misión: {mission.title}
Objetivo: {mission.objective}
{f'Detalle: {mission.description}' if mission.description else ''}{project_block}
Equipo disponible:
{roster_text(agents)}

Instrucciones:
1. Analizá el objetivo real, su complejidad y si requiere investigación.
2. Si es simple, un plan de 1 tarea (asignada a vos mismo, "nexus", o al especialista idóneo) es correcto. No delegues por delegar.
3. Si es compleja, dividila en tareas con entregables concretos y verificables. Máximo {settings.max_tasks_per_mission} tareas.
4. Declará dependencias reales: una tarea depende de otra solo si necesita su resultado. Las independientes correrán en paralelo.
5. No incluyas tareas de revisión final ni de auditoría de seguridad: ORACLE y GUARDIAN las hacen automáticamente después.
6. Marcá requires_approval=true solo para tareas que impliquen acciones sensibles (modificar archivos importantes, comunicaciones externas).
7. task_type debe ser uno de: {task_types}.

Respondé SOLO con un objeto JSON con esta forma exacta:
{{
  "analysis": "qué pide realmente el usuario y qué implica",
  "complexity": "simple" | "moderate" | "complex",
  "needs_research": true | false,
  "strategy": "cómo se va a abordar",
  "risks": ["riesgo 1", "..."],
  "tasks": [
    {{"key": "t1", "title": "...", "description": "qué hacer y qué entregable concreto producir",
      "task_type": "research", "agent": "atlas", "depends_on": [], "priority": 2, "requires_approval": false}}
  ]
}}"""


def parse_plan(text: str, agent_slugs: set[str]) -> Plan:
    try:
        data = extract_json(text)
    except JSONExtractionError as exc:
        raise PlanValidationError(str(exc)) from exc
    if not isinstance(data, dict):
        raise PlanValidationError("El plan debe ser un objeto JSON")
    raw_tasks = data.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        raise PlanValidationError("El plan no contiene tareas")
    max_tasks = get_settings().max_tasks_per_mission
    if len(raw_tasks) > max_tasks:
        raise PlanValidationError(f"El plan tiene {len(raw_tasks)} tareas; el máximo es {max_tasks}")
    valid_types = {t.value for t in TaskType}
    tasks: list[PlannedTask] = []
    keys: set[str] = set()
    for i, raw in enumerate(raw_tasks):
        if not isinstance(raw, dict):
            raise PlanValidationError(f"La tarea {i + 1} no es un objeto")
        key = str(raw.get("key") or f"t{i + 1}").strip()
        if not KEY_RE.match(key) or key in keys:
            raise PlanValidationError(f"Clave de tarea inválida o repetida: {key!r}")
        keys.add(key)
        title = str(raw.get("title") or "").strip()
        description = str(raw.get("description") or "").strip()
        if not title or not description:
            raise PlanValidationError(f"La tarea {key} necesita título y descripción")
        agent = str(raw.get("agent") or "nexus").strip().lower()
        if agent not in agent_slugs:
            raise PlanValidationError(f"La tarea {key} está asignada a un agente inexistente: {agent}")
        task_type = str(raw.get("task_type") or "general").strip().lower()
        if task_type not in valid_types:
            task_type = "general"
        deps = raw.get("depends_on") or []
        if not isinstance(deps, list):
            raise PlanValidationError(f"depends_on de {key} debe ser una lista")
        priority = raw.get("priority", 3)
        tasks.append(
            PlannedTask(
                key=key, title=title[:200], description=description, task_type=task_type, agent_slug=agent,
                depends_on=[str(d) for d in deps], priority=max(1, min(int(priority) if isinstance(priority, (int, float)) else 3, 5)),
                requires_approval=bool(raw.get("requires_approval", False)),
            )
        )
    for t in tasks:
        for dep in t.depends_on:
            if dep not in keys:
                raise PlanValidationError(f"La tarea {t.key} depende de una tarea inexistente: {dep}")
            if dep == t.key:
                raise PlanValidationError(f"La tarea {t.key} depende de sí misma")
    assert_acyclic(tasks)
    complexity = str(data.get("complexity") or "moderate")
    return Plan(
        analysis=str(data.get("analysis") or ""),
        complexity=complexity if complexity in ("simple", "moderate", "complex") else "moderate",
        needs_research=bool(data.get("needs_research", False)),
        strategy=str(data.get("strategy") or ""),
        tasks=tasks,
        risks=[str(r) for r in data.get("risks") or []][:10],
    )


def assert_acyclic(tasks: list[PlannedTask]) -> list[str]:
    """Orden topológico (Kahn). Lanza PlanValidationError si hay ciclos."""
    indegree = {t.key: len(set(t.depends_on)) for t in tasks}
    dependents: dict[str, list[str]] = {t.key: [] for t in tasks}
    for t in tasks:
        for dep in set(t.depends_on):
            dependents[dep].append(t.key)
    queue = [k for k, d in indegree.items() if d == 0]
    order: list[str] = []
    while queue:
        key = queue.pop(0)
        order.append(key)
        for nxt in dependents[key]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
    if len(order) != len(tasks):
        raise PlanValidationError("Las dependencias del plan forman un ciclo")
    return order


async def available_agents(session: AsyncSession, user_id) -> list[Agent]:
    return list(
        (await session.scalars(select(Agent).where(Agent.user_id == user_id, Agent.is_enabled.is_(True)).order_by(Agent.created_at))).all()
    )
