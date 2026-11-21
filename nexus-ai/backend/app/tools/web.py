"""Acceso web seguro: búsqueda mediante proveedores autorizados y lectura de páginas con
protección contra SSRF (solo destinos públicos, redirecciones verificadas, límites)."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from app.memory.extract import html_to_text

MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
USER_AGENT = "NEXUS-AI/1.0 (+research agent)"
# En tests se inyecta un transport simulado de la red externa.
transport_override: httpx.AsyncBaseTransport | None = None
resolver_override = None


class BlockedDestination(Exception):
    pass


async def _resolve(host: str) -> list[str]:
    if resolver_override is not None:
        return resolver_override(host)
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


async def assert_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise BlockedDestination("Solo se permiten URLs http(s)")
    if not parsed.hostname:
        raise BlockedDestination("URL sin host")
    if parsed.username or parsed.password:
        raise BlockedDestination("No se permiten credenciales en la URL")
    host = parsed.hostname
    try:
        addresses = [host] if _is_ip(host) else await _resolve(host)
    except OSError as exc:
        raise BlockedDestination(f"No se pudo resolver {host}") from exc
    for addr in addresses:
        ip = ipaddress.ip_address(addr)
        if not ip.is_global or ip.is_multicast:
            raise BlockedDestination(f"Destino no público bloqueado ({host} → {addr})")


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


async def fetch_page(url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(
        transport=transport_override, timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=False,
        headers={"user-agent": USER_AGENT, "accept": "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5"},
    ) as client:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            await assert_public_url(current)
            async with client.stream("GET", current) as resp:
                if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                    current = urljoin(current, resp.headers["location"])
                    continue
                chunks: list[bytes] = []
                size = 0
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        break
                    chunks.append(chunk)
                body = b"".join(chunks)
                ctype = resp.headers.get("content-type", "").split(";")[0].strip()
                text = body.decode(resp.encoding or "utf-8", errors="replace")
                if "html" in ctype:
                    text = html_to_text(text)
                return {
                    "url": current,
                    "status": resp.status_code,
                    "content_type": ctype,
                    "text": text,
                    "truncated": size > MAX_BYTES,
                    "fetched_at": datetime.now(UTC).isoformat(),
                }
        raise BlockedDestination("Demasiadas redirecciones")


async def brave_search(api_key: str, query: str, count: int) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(transport=transport_override, timeout=20) as client:
        resp = await client.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": count},
            headers={"X-Subscription-Token": api_key, "accept": "application/json"},
        )
        resp.raise_for_status()
        results = (resp.json().get("web") or {}).get("results") or []
        return [{"title": r.get("title"), "url": r.get("url"), "snippet": r.get("description"), "age": r.get("age")} for r in results]


async def tavily_search(api_key: str, query: str, count: int) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(transport=transport_override, timeout=30) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={"query": query, "max_results": count, "search_depth": "advanced"},
            headers={"authorization": f"Bearer {api_key}"},
        )
        resp.raise_for_status()
        return [
            {"title": r.get("title"), "url": r.get("url"), "snippet": r.get("content"), "age": r.get("published_date")}
            for r in resp.json().get("results") or []
        ]
