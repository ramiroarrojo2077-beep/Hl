"""Prueba de carga de los endpoints internos de NEXUS 2.0 (sin llamadas a modelos de IA).

Uso:  python scripts/loadtest.py http://127.0.0.1:8000 --requests 1500 --concurrency 16
Mide p50/p95/p99 por endpoint contra un servidor real (API + PostgreSQL + Redis).
Para no medir el limitador de tasa, levantar la API con NEXUS_RATE_LIMIT_PER_MINUTE alto.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import time
import uuid

import httpx

ENDPOINTS = [
    ("GET", "/jarvis/state", None),
    ("GET", "/jarvis/context?timezone=America/Argentina/Buenos_Aires", None),
    ("POST", "/jarvis/intent", {"content": "Recordame mañana a las 9 llamar al médico", "timezone": "America/Argentina/Buenos_Aires"}),
    ("GET", "/actions?status=awaiting_confirmation", None),
    ("GET", "/automations", None),
    ("GET", "/voice/settings", None),
    ("GET", "/dashboard", None),
    ("GET", "/agents", None),
    ("POST", "/jarvis/message", {"content": "Abrí la configuración de bluetooth", "timezone": "America/Argentina/Buenos_Aires"}),
]


def pct(values: list[float], p: float) -> float:
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(p / 100 * (len(s) - 1)))))
    return s[k]


async def main(base: str, total: int, concurrency: int) -> dict:
    async with httpx.AsyncClient(base_url=base, timeout=30) as c:
        email = f"load-{uuid.uuid4().hex[:8]}@example.com"
        r = await c.post("/api/v1/auth/register", json={"email": email, "password": "Segura12345", "display_name": "Carga"})
        r.raise_for_status()
        token = r.json()["tokens"]["access_token"]
        headers = {"authorization": f"Bearer {token}"}
        lat: dict[str, list[float]] = {f"{m} {p.split('?')[0]}": [] for m, p, _ in ENDPOINTS}
        errors: dict[str, int] = {k: 0 for k in lat}
        sem = asyncio.Semaphore(concurrency)

        async def one(i: int) -> None:
            m, p, body = ENDPOINTS[i % len(ENDPOINTS)] if i < len(ENDPOINTS) * 3 else random.choice(ENDPOINTS)
            key = f"{m} {p.split('?')[0]}"
            async with sem:
                t0 = time.perf_counter()
                resp = await c.request(m, "/api/v1" + p, headers=headers, json=body)
                lat[key].append((time.perf_counter() - t0) * 1000)
                if resp.status_code >= 400:
                    errors[key] += 1

        t0 = time.perf_counter()
        await asyncio.gather(*(one(i) for i in range(total)))
        elapsed = time.perf_counter() - t0
        out = {"requests": total, "concurrency": concurrency, "seconds": round(elapsed, 2), "rps": round(total / elapsed, 1), "endpoints": {}}
        for k, v in lat.items():
            if v:
                out["endpoints"][k] = {"n": len(v), "p50_ms": round(statistics.median(v), 1), "p95_ms": round(pct(v, 95), 1),
                                       "p99_ms": round(pct(v, 99), 1), "errors": errors[k]}
        allv = [x for v in lat.values() for x in v]
        out["overall"] = {"p50_ms": round(statistics.median(allv), 1), "p95_ms": round(pct(allv, 95), 1), "p99_ms": round(pct(allv, 99), 1),
                          "errors": sum(errors.values())}
        return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--requests", type=int, default=1500)
    ap.add_argument("--concurrency", type=int, default=16)
    a = ap.parse_args()
    print(json.dumps(asyncio.run(main(a.base, a.requests, a.concurrency)), indent=1))
