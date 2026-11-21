"""Ejecución de código en contenedores Docker aislados.

Cada ejecución corre en un contenedor efímero: sin red, sistema de archivos de solo
lectura (salvo /tmp y /work), límites de memoria, CPU, procesos y tiempo. Si Docker no
está disponible, la herramienta lo informa: nunca se simula una ejecución.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path

from app.core.config import get_settings

RUNNERS = {
    "python": ("python:3.12-slim", ["python", "/work/main.py"], "main.py"),
    "bash": ("python:3.12-slim", ["bash", "/work/main.sh"], "main.sh"),
    "node": ("node:22-slim", ["node", "/work/main.js"], "main.js"),
}
MAX_OUTPUT = 20_000


class SandboxUnavailable(Exception):
    pass


async def docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    proc = await asyncio.create_subprocess_exec(
        "docker", "info", "--format", "{{.ServerVersion}}",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        await asyncio.wait_for(proc.communicate(), timeout=10)
    except TimeoutError:
        proc.kill()
        return False
    return proc.returncode == 0


async def run_code(language: str, code: str, files: dict[str, str] | None = None) -> dict:
    settings = get_settings()
    if not settings.sandbox_enabled:
        raise SandboxUnavailable("El sandbox está deshabilitado en este servidor (NEXUS_SANDBOX_ENABLED=false)")
    if language not in RUNNERS:
        raise ValueError(f"Lenguaje no soportado: {language}")
    if not await docker_available():
        raise SandboxUnavailable("Docker no está disponible en este servidor; no se puede ejecutar código")
    image, cmd, entry = RUNNERS[language]
    with tempfile.TemporaryDirectory(prefix="nexus-sbx-", dir=settings.sandbox_workdir) as tmp:
        work = Path(tmp)
        os.chmod(work, 0o755)  # el contenedor corre como usuario sin privilegios (nobody)
        (work / entry).write_text(code, encoding="utf-8")
        for name, content in (files or {}).items():
            safe = Path(name).name
            if safe and safe != entry and isinstance(content, str):
                (work / safe).write_text(content, encoding="utf-8")
        for f in work.iterdir():
            os.chmod(f, 0o644)
        args = [
            "docker", "run", "--rm", "--network", "none",
            "--memory", f"{settings.sandbox_memory_mb}m", "--cpus", "1", "--pids-limit", "128",
            "--read-only", "--tmpfs", "/tmp:rw,size=64m", "--security-opt", "no-new-privileges",
            "--cap-drop", "ALL", "--user", "65534:65534",
            "-v", f"{work}:/work:ro", "-w", "/work", image, *cmd,
        ]
        proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=settings.sandbox_timeout_seconds)
            timed_out = False
        except TimeoutError:
            proc.kill()
            stdout, stderr = await proc.communicate()
            timed_out = True
    return {
        "exit_code": proc.returncode,
        "timed_out": timed_out,
        "stdout": stdout.decode(errors="replace")[:MAX_OUTPUT],
        "stderr": stderr.decode(errors="replace")[:MAX_OUTPUT],
        "image": image,
    }
