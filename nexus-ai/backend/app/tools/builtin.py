"""Herramientas incorporadas. Cada una declara su clase de operación; el motor de
políticas decide si se permite, si requiere aprobación o si se bloquea."""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select

from app.core.crypto import decrypt_json
from app.memory import service as memory
from app.memory.extract import UnsupportedDocument, extract_text
from app.models import Agent, Mission, MissionTask, Plugin, ProjectFile, ScheduledJob
from app.models.enums import MemoryKind, MemoryScope, OperationClass
from app.projects import storage
from app.tools import sandbox, web
from app.tools.registry import ToolContext, ToolDef, ToolOutput, register


def _schema(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required, "additionalProperties": False}


async def _plugin_config(ctx: ToolContext, key: str) -> dict[str, Any]:
    plugin = await ctx.session.scalar(select(Plugin).where(Plugin.user_id == ctx.user_id, Plugin.key == key))
    if plugin is None:
        return {}
    plugin.last_used_at = datetime.now(UTC)
    return {**plugin.config_public, **decrypt_json(plugin.config_encrypted)}


# ---------------------------------------------------------------- memoria

async def _memory_search(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    hits = await memory.search(
        ctx.session, ctx.user_id, args["query"], agent_id=ctx.agent.id, project_id=ctx.project_id,
        scopes=args.get("scopes"), limit=min(int(args.get("limit", 6)), 12),
    )
    if not hits:
        return ToolOutput("No se encontraron recuerdos relevantes.")
    return ToolOutput(memory.format_for_prompt(hits), data={"ids": [str(h.item.id) for h in hits]})


async def _memory_propose(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    scope = args.get("scope", MemoryScope.AGENT)
    if scope == MemoryScope.PROJECT and ctx.project_id is None:
        return ToolOutput("No hay un proyecto activo para guardar memoria de proyecto.", is_error=True)
    item = await memory.create_memory(
        ctx.session, ctx.user_id, scope=scope, content=args["content"], kind=args.get("kind", MemoryKind.LEARNING),
        title=args.get("title"), agent_id=ctx.agent.id if scope == MemoryScope.AGENT else None,
        project_id=ctx.project_id if scope == MemoryScope.PROJECT else None, mission_id=ctx.mission_id,
        created_by_agent_id=ctx.agent.id, source="agent", source_ref=args.get("source_ref"),
        confidence=float(args.get("confidence", 0.5)),
    )
    return ToolOutput(
        f"Recuerdo propuesto ({item.id}) con estado «no verificado». El usuario puede revisarlo, corregirlo o borrarlo.",
        data={"memory_id": str(item.id)},
    )


register(ToolDef(
    key="memory.search", name="Buscar en memoria", category="memoria", operation_class=OperationClass.READ,
    description="Busca recuerdos relevantes (memoria del agente, compartida, del usuario y del proyecto actual).",
    parameters=_schema({
        "query": {"type": "string", "maxLength": 500},
        "scopes": {"type": "array", "items": {"type": "string", "enum": ["agent", "shared", "user", "project"]}},
        "limit": {"type": "integer"},
    }, ["query"]),
    handler=_memory_search,
))
register(ToolDef(
    key="memory.propose", name="Proponer recuerdo", category="memoria", operation_class=OperationClass.CREATION,
    description=(
        "Propone guardar un conocimiento útil y duradero (no datos triviales). Queda como no verificado hasta que "
        "el usuario lo revise. Indicá confianza (0-1) y fuente si existe."
    ),
    parameters=_schema({
        "content": {"type": "string", "maxLength": 4000},
        "title": {"type": "string", "maxLength": 200},
        "kind": {"type": "string", "enum": ["fact", "decision", "experience", "error", "preference", "learning", "result"]},
        "scope": {"type": "string", "enum": ["agent", "shared", "user", "project"]},
        "confidence": {"type": "number"},
        "source_ref": {"type": "string", "maxLength": 500},
    }, ["content"]),
    handler=_memory_propose, side_effects=True,
))


# ---------------------------------------------------------------- web

async def _web_search(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    config = await _plugin_config(ctx, "web_search")
    api_key = config.get("api_key")
    provider = config.get("provider", "brave")
    if not api_key:
        return ToolOutput("El plugin de búsqueda web no tiene API key configurada.", is_error=True)
    count = max(1, min(int(args.get("count", 6)), 10))
    try:
        if provider == "tavily":
            results = await web.tavily_search(api_key, args["query"], count)
        else:
            results = await web.brave_search(api_key, args["query"], count)
    except httpx.HTTPError as exc:
        return ToolOutput(f"Error del proveedor de búsqueda ({provider}): {exc}", is_error=True)
    consulted = datetime.now(UTC).isoformat(timespec="minutes")
    lines = [f"Resultados de búsqueda ({provider}, consultado {consulted}) para: {args['query']}"]
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r['title']}\n   URL: {r['url']}\n   {r.get('snippet') or ''}")
    return ToolOutput("\n".join(lines), data={"results": results, "consulted_at": consulted, "provider": provider}, untrusted=True)


async def _web_fetch(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    try:
        page = await web.fetch_page(args["url"])
    except web.BlockedDestination as exc:
        return ToolOutput(f"URL bloqueada por seguridad: {exc}", is_error=True)
    except httpx.HTTPError as exc:
        return ToolOutput(f"No se pudo leer la página: {exc}", is_error=True)
    text = page["text"]
    start = int(args.get("offset", 0))
    excerpt = text[start : start + 12_000]
    header = f"URL: {page['url']} (HTTP {page['status']}, {page['content_type']}, consultado {page['fetched_at']})"
    more = f"\n[Hay más contenido: usá offset={start + 12_000}]" if len(text) > start + 12_000 else ""
    return ToolOutput(f"{header}\n\n{excerpt}{more}", data={"url": page["url"], "fetched_at": page["fetched_at"]}, untrusted=True)


register(ToolDef(
    key="web.search", name="Búsqueda web", category="investigación", operation_class=OperationClass.READ,
    description="Busca en la web mediante el proveedor de búsqueda autorizado. Devuelve títulos, URLs y fragmentos.",
    parameters=_schema({"query": {"type": "string", "maxLength": 400}, "count": {"type": "integer"}}, ["query"]),
    handler=_web_search, requires_plugin="web_search", limits={"max_results": 10},
))
register(ToolDef(
    key="web.fetch", name="Leer página web", category="investigación", operation_class=OperationClass.READ,
    description="Descarga y extrae el texto de una página web pública (http/https). Destinos privados bloqueados.",
    parameters=_schema({"url": {"type": "string", "maxLength": 2000}, "offset": {"type": "integer"}}, ["url"]),
    handler=_web_fetch, limits={"max_bytes": web.MAX_BYTES},
))


# ---------------------------------------------------------------- documentos y proyectos

def _require_project(ctx: ToolContext) -> ToolOutput | None:
    if ctx.project_id is None:
        return ToolOutput("Esta tarea no está asociada a un proyecto: no hay archivos autorizados.", is_error=True)
    return None


async def _list_files(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    if err := _require_project(ctx):
        return err
    files = (
        await ctx.session.scalars(
            select(ProjectFile).where(ProjectFile.project_id == ctx.project_id, ProjectFile.is_latest.is_(True)).order_by(ProjectFile.path)
        )
    ).all()
    if not files:
        return ToolOutput("El proyecto no tiene archivos.")
    return ToolOutput(
        "\n".join(f"- {f.path} (v{f.version}, {f.size_bytes} bytes, {f.content_type})" for f in files),
        data={"files": [f.path for f in files]},
    )


async def _read_document(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    if err := _require_project(ctx):
        return err
    pfile = await storage.latest_file(ctx.session, ctx.project_id, args["path"])  # type: ignore[arg-type]
    if pfile is None:
        return ToolOutput(f"No existe el archivo {args['path']} en el proyecto.", is_error=True)
    data = await storage.read_bytes(pfile.storage_key)
    try:
        text = extract_text(data, pfile.content_type, pfile.path)
    except UnsupportedDocument as exc:
        return ToolOutput(str(exc), is_error=True)
    start = int(args.get("offset", 0))
    chunk = text[start : start + 12_000]
    more = f"\n[Continúa: offset={start + 12_000}]" if len(text) > start + 12_000 else ""
    # Los documentos pueden venir de terceros: se tratan como datos no confiables.
    return ToolOutput(f"Archivo {pfile.path} v{pfile.version}:\n\n{chunk}{more}", data={"file_id": str(pfile.id)}, untrusted=True)


async def _write_file(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    if err := _require_project(ctx):
        return err
    project = await storage.get_project(ctx.session, ctx.user_id, ctx.project_id)  # type: ignore[arg-type]
    pfile = await storage.save_file(
        ctx.session, project, args["path"], args["content"].encode("utf-8"), agent_id=ctx.agent.id,
        mission_id=ctx.mission_id, change_note=args.get("change_note"),
    )
    return ToolOutput(
        f"Guardado {pfile.path} como versión {pfile.version}. Las versiones anteriores se conservan para revisión.",
        data={"file_id": str(pfile.id), "version": pfile.version},
    )


async def _delete_file(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    if err := _require_project(ctx):
        return err
    files = (
        await ctx.session.scalars(
            select(ProjectFile).where(ProjectFile.project_id == ctx.project_id, ProjectFile.path == storage.normalize_path(args["path"]))
        )
    ).all()
    if not files:
        return ToolOutput(f"No existe {args['path']}", is_error=True)
    for f in files:
        await ctx.session.delete(f)
    return ToolOutput(f"Eliminado {args['path']} ({len(files)} versiones).")


register(ToolDef(
    key="project.list_files", name="Listar archivos del proyecto", category="documentos", operation_class=OperationClass.READ,
    description="Lista los archivos (última versión) del proyecto asociado a la tarea.",
    parameters=_schema({}, []), handler=_list_files,
))
register(ToolDef(
    key="documents.read", name="Leer documento", category="documentos", operation_class=OperationClass.READ,
    description="Lee un archivo del proyecto (PDF, DOCX, TXT, Markdown, código...). Soporta paginación con offset.",
    parameters=_schema({"path": {"type": "string", "maxLength": 400}, "offset": {"type": "integer"}}, ["path"]),
    handler=_read_document,
))
register(ToolDef(
    key="project.write_file", name="Escribir archivo del proyecto", category="programación", operation_class=OperationClass.MODIFICATION,
    description="Crea o modifica un archivo de texto del proyecto. Cada escritura genera una versión nueva revisable.",
    parameters=_schema({
        "path": {"type": "string", "maxLength": 400},
        "content": {"type": "string", "maxLength": 400_000},
        "change_note": {"type": "string", "maxLength": 500},
    }, ["path", "content"]),
    handler=_write_file, side_effects=True,
))
register(ToolDef(
    key="project.delete_file", name="Eliminar archivo", category="documentos", operation_class=OperationClass.IRREVERSIBLE,
    description="Elimina un archivo del proyecto con todas sus versiones. Irreversible: requiere confirmación explícita.",
    parameters=_schema({"path": {"type": "string", "maxLength": 400}}, ["path"]),
    handler=_delete_file, side_effects=True,
))


# ---------------------------------------------------------------- borradores

_SLUG = re.compile(r"[^a-z0-9]+")


async def _create_draft(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    fmt = args.get("format", "md")
    title = args["title"].strip()
    data = {"title": title, "format": fmt, "content": args["content"], "agent": ctx.agent.name,
            "created_at": datetime.now(UTC).isoformat()}
    if ctx.task_id:
        task = await ctx.session.get(MissionTask, ctx.task_id)
        if task is not None:
            drafts = list(task.result_data.get("drafts", []))
            drafts.append(data)
            task.result_data = {**task.result_data, "drafts": drafts}
    location = "resultado de la tarea"
    if ctx.project_id:
        project = await storage.get_project(ctx.session, ctx.user_id, ctx.project_id)
        slug = _SLUG.sub("-", title.lower()).strip("-")[:60] or "borrador"
        pfile = await storage.save_file(
            ctx.session, project, f"drafts/{slug}.{fmt}", args["content"].encode("utf-8"),
            agent_id=ctx.agent.id, mission_id=ctx.mission_id, change_note="Borrador generado por agente",
        )
        location = f"proyecto: {pfile.path} v{pfile.version}"
    return ToolOutput(f"Borrador «{title}» guardado ({location}).", data={"title": title})


register(ToolDef(
    key="drafts.create", name="Crear borrador", category="documentos", operation_class=OperationClass.CREATION,
    description="Guarda un entregable como borrador (informe, documento, propuesta, código). No modifica nada existente.",
    parameters=_schema({
        "title": {"type": "string", "maxLength": 200},
        "content": {"type": "string", "maxLength": 200_000},
        "format": {"type": "string", "enum": ["md", "txt", "json", "html", "py", "kt", "ts", "js", "sql", "csv"]},
    }, ["title", "content"]),
    handler=_create_draft, side_effects=True,
))


# ---------------------------------------------------------------- sandbox

async def _code_execute(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    try:
        result = await sandbox.run_code(args["language"], args["code"], args.get("files"))
    except sandbox.SandboxUnavailable as exc:
        return ToolOutput(f"Sandbox no disponible: {exc}. El código NO se ejecutó.", is_error=True)
    status = "tiempo agotado" if result["timed_out"] else f"código de salida {result['exit_code']}"
    return ToolOutput(
        f"Ejecución en sandbox ({result['image']}, sin red): {status}\n--- stdout ---\n{result['stdout']}\n--- stderr ---\n{result['stderr']}",
        data=result, untrusted=True,
    )


register(ToolDef(
    key="code.execute", name="Ejecutar código en sandbox", category="programación", operation_class=OperationClass.MODIFICATION,
    description="Ejecuta código (python, bash o node) en un contenedor aislado sin red, con límites de recursos y tiempo.",
    parameters=_schema({
        "language": {"type": "string", "enum": ["python", "bash", "node"]},
        "code": {"type": "string", "maxLength": 100_000},
        "files": {"type": "object"},
    }, ["language", "code"]),
    handler=_code_execute, requires_plugin="code_sandbox", side_effects=True,
))


# ---------------------------------------------------------------- productividad

async def _notify_user(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    from app.notifications.service import notify

    event = "agent_needs_info" if args.get("needs_input") else "report_ready"
    n = await notify(
        ctx.session, ctx.user_id, event, f"{ctx.agent.name}: {args['title']}", args["body"],
        {"agent_id": str(ctx.agent.id), **({"mission_id": str(ctx.mission_id)} if ctx.mission_id else {})},
    )
    return ToolOutput("Notificación enviada al usuario." if n else "El usuario desactivó este tipo de notificación.")


async def _create_reminder(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    try:
        at = datetime.fromisoformat(args["at"])
    except ValueError:
        return ToolOutput("Fecha inválida: usá formato ISO 8601, p.ej. 2026-12-01T09:00:00-03:00", is_error=True)
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    if at <= datetime.now(UTC):
        return ToolOutput("La fecha del recordatorio debe ser futura.", is_error=True)
    job = ScheduledJob(
        user_id=ctx.user_id, kind="reminder", name=args["title"][:200], run_once_at=at, next_run_at=at,
        payload={"title": args["title"], "body": args.get("body", "")}, created_by_agent_id=ctx.agent.id,
    )
    ctx.session.add(job)
    await ctx.session.flush()
    return ToolOutput(f"Recordatorio programado para {at.isoformat()} (id {job.id}).", data={"scheduled_job_id": str(job.id)})


register(ToolDef(
    key="notifications.notify_user", name="Notificar al usuario", category="productividad", operation_class=OperationClass.CREATION,
    description="Envía una notificación al usuario (push y en la app). Usá needs_input=true si necesitás información suya.",
    parameters=_schema({
        "title": {"type": "string", "maxLength": 120},
        "body": {"type": "string", "maxLength": 1000},
        "needs_input": {"type": "boolean"},
    }, ["title", "body"]),
    handler=_notify_user, side_effects=True,
))
register(ToolDef(
    key="reminders.create", name="Crear recordatorio", category="productividad", operation_class=OperationClass.CREATION,
    description="Programa un recordatorio para el usuario en una fecha y hora (ISO 8601).",
    parameters=_schema({
        "title": {"type": "string", "maxLength": 200},
        "body": {"type": "string", "maxLength": 1000},
        "at": {"type": "string", "maxLength": 40},
    }, ["title", "at"]),
    handler=_create_reminder, side_effects=True,
))


# ---------------------------------------------------------------- comunicación externa

async def _webhook_send(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    config = await _plugin_config(ctx, "webhook")
    url = config.get("url")
    if not url or not url.startswith("https://"):
        return ToolOutput("El webhook no tiene una URL https configurada.", is_error=True)
    try:
        await web.assert_public_url(url)
    except web.BlockedDestination as exc:
        return ToolOutput(f"Webhook bloqueado: {exc}", is_error=True)
    headers = {"content-type": "application/json"}
    if config.get("secret_header"):
        headers["x-nexus-signature"] = config["secret_header"]
    payload = {"text": args["message"], "agent": ctx.agent.name, "sent_at": datetime.now(UTC).isoformat()}
    async with httpx.AsyncClient(transport=web.transport_override, timeout=20) as client:
        try:
            resp = await client.post(url, content=json.dumps(payload), headers=headers)
        except httpx.HTTPError as exc:
            return ToolOutput(f"Error enviando webhook: {exc}", is_error=True)
    if resp.status_code >= 400:
        return ToolOutput(f"El webhook respondió HTTP {resp.status_code}", is_error=True)
    return ToolOutput(f"Mensaje enviado al webhook (HTTP {resp.status_code}).")


register(ToolDef(
    key="webhook.send", name="Enviar mensaje por webhook", category="comunicación",
    operation_class=OperationClass.EXTERNAL_COMMUNICATION,
    description="Envía un mensaje al webhook externo configurado por el usuario (Slack, Discord, n8n...).",
    parameters=_schema({"message": {"type": "string", "maxLength": 4000}}, ["message"]),
    handler=_webhook_send, requires_plugin="webhook", side_effects=True,
))


# ---------------------------------------------------------------- equipo

async def _agents_list(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    agents = (await ctx.session.scalars(select(Agent).where(Agent.user_id == ctx.user_id, Agent.is_enabled.is_(True)))).all()
    lines = [
        f"- {a.slug} · {a.name} — {a.role}. Especialidades: {', '.join(a.profile.specialties)}. Estado: {a.status}"
        for a in agents
    ]
    return ToolOutput("\n".join(lines), data={"agents": [a.slug for a in agents]})


async def _agents_ask(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    from app.agents.runtime import consult_agent

    if ctx.depth >= 1:
        return ToolOutput("No se permiten consultas encadenadas entre agentes.", is_error=True)
    target = await ctx.session.scalar(
        select(Agent).where(Agent.user_id == ctx.user_id, Agent.slug == args["agent"].lower(), Agent.is_enabled.is_(True))
    )
    if target is None:
        return ToolOutput(f"No existe el agente «{args['agent']}».", is_error=True)
    if target.id == ctx.agent.id:
        return ToolOutput("Un agente no puede consultarse a sí mismo.", is_error=True)
    answer = await consult_agent(ctx, target, args["question"])
    return ToolOutput(f"Respuesta de {target.name}:\n{answer}", data={"agent": target.slug})


register(ToolDef(
    key="agents.list", name="Listar agentes", category="equipo", operation_class=OperationClass.READ,
    description="Lista los agentes del equipo con su rol, especialidades y estado actual.",
    parameters=_schema({}, []), handler=_agents_list,
))
register(ToolDef(
    key="agents.ask", name="Consultar a otro agente", category="equipo", operation_class=OperationClass.ANALYSIS,
    description="Hace una pregunta concreta a otro agente del equipo y recibe su respuesta (ejecución real de su modelo).",
    parameters=_schema({"agent": {"type": "string", "maxLength": 40}, "question": {"type": "string", "maxLength": 4000}}, ["agent", "question"]),
    handler=_agents_ask,
))


# ---------------------------------------------------------------- misiones y reuniones (NEXUS)

async def _missions_create(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    from app.missions.service import create_mission

    project_id = uuid.UUID(args["project_id"]) if args.get("project_id") else ctx.project_id
    mission = await create_mission(
        ctx.session, ctx.user_id, title=args["title"], objective=args["objective"], project_id=project_id,
        priority=int(args.get("priority", 3)), created_by_agent=ctx.agent,
    )
    return ToolOutput(
        f"Misión creada: «{mission.title}» (id {mission.id}). NEXUS la está planificando; el usuario puede seguirla en Misiones.",
        data={"mission_id": str(mission.id)},
    )


async def _missions_list(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    q = select(Mission).where(Mission.user_id == ctx.user_id).order_by(Mission.created_at.desc()).limit(15)
    if args.get("status"):
        q = q.where(Mission.status == args["status"])
    missions = (await ctx.session.scalars(q)).all()
    if not missions:
        return ToolOutput("No hay misiones.")
    return ToolOutput("\n".join(f"- {m.id} · {m.title} · {m.status} · creada {m.created_at:%Y-%m-%d %H:%M}" for m in missions))


async def _missions_status(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    try:
        mid = uuid.UUID(args["mission_id"])
    except ValueError:
        return ToolOutput("ID de misión inválido", is_error=True)
    mission = await ctx.session.get(Mission, mid)
    if mission is None or mission.user_id != ctx.user_id:
        return ToolOutput("Misión no encontrada", is_error=True)
    tasks = (await ctx.session.scalars(select(MissionTask).where(MissionTask.mission_id == mid).order_by(MissionTask.key))).all()
    lines = [f"Misión «{mission.title}»: {mission.status}. Gasto USD {mission.spent_usd:.4f}, tokens {mission.tokens_used}."]
    for t in tasks:
        lines.append(f"- [{t.status}] {t.key} {t.title}" + (f" — error: {t.error}" if t.error else ""))
    if mission.result:
        lines.append(f"\nResultado final:\n{mission.result[:4000]}")
    return ToolOutput("\n".join(lines))


async def _meetings_request(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    from app.meetings.service import create_meeting

    meeting = await create_meeting(
        ctx.session, ctx.user_id, topic=args["topic"], objective=args["objective"],
        meeting_type=args.get("meeting_type", "planning"), participant_slugs=args.get("participants") or [],
        max_rounds=int(args.get("max_rounds", 2)), project_id=ctx.project_id, mission_id=ctx.mission_id,
    )
    return ToolOutput(f"Reunión convocada: «{meeting.topic}» (id {meeting.id}).", data={"meeting_id": str(meeting.id)})


register(ToolDef(
    key="missions.create", name="Crear misión", category="misiones", operation_class=OperationClass.CREATION,
    description="Crea una misión para el equipo cuando el usuario pide un objetivo que requiere trabajo planificado.",
    parameters=_schema({
        "title": {"type": "string", "maxLength": 200},
        "objective": {"type": "string", "maxLength": 8000},
        "priority": {"type": "integer"},
        "project_id": {"type": "string", "maxLength": 40},
    }, ["title", "objective"]),
    handler=_missions_create, side_effects=True,
))
register(ToolDef(
    key="missions.list", name="Listar misiones", category="misiones", operation_class=OperationClass.READ,
    description="Lista las misiones recientes del usuario, opcionalmente filtradas por estado.",
    parameters=_schema({"status": {"type": "string", "maxLength": 30}}, []), handler=_missions_list,
))
register(ToolDef(
    key="missions.status", name="Estado de misión", category="misiones", operation_class=OperationClass.READ,
    description="Muestra el estado real de una misión, sus tareas y su resultado.",
    parameters=_schema({"mission_id": {"type": "string", "maxLength": 40}}, ["mission_id"]), handler=_missions_status,
))
register(ToolDef(
    key="meetings.request", name="Convocar reunión", category="reuniones", operation_class=OperationClass.CREATION,
    description="Convoca una reunión entre agentes sobre un tema, con participantes y límite de rondas.",
    parameters=_schema({
        "topic": {"type": "string", "maxLength": 300},
        "objective": {"type": "string", "maxLength": 4000},
        "meeting_type": {"type": "string", "enum": ["planning", "research", "technical", "review", "problem_solving", "evaluation"]},
        "participants": {"type": "array", "items": {"type": "string"}},
        "max_rounds": {"type": "integer"},
    }, ["topic", "objective"]),
    handler=_meetings_request, side_effects=True,
))


# NEXUS 2.0: herramientas de JARVIS CORE (Action Registry).
from app.jarvis import tools as _jarvis_tools  # noqa: E402,F401
