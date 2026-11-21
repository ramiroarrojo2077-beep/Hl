"""Métricas Prometheus de la API y del worker."""

from __future__ import annotations

import os

from prometheus_client import Counter, Histogram, start_http_server

REQUESTS = Counter("nexus_http_requests_total", "Solicitudes HTTP", ["method", "route", "status"])
REQUEST_SECONDS = Histogram("nexus_http_request_seconds", "Duración de solicitudes HTTP", ["route"])
JOBS = Counter("nexus_jobs_total", "Trabajos procesados", ["kind", "outcome"])
JOB_SECONDS = Histogram("nexus_job_seconds", "Duración de trabajos", ["kind"], buckets=(0.5, 1, 5, 15, 30, 60, 120, 300, 900))
WS_CONNECTIONS = Counter("nexus_ws_connections_total", "Conexiones WebSocket aceptadas")


def start_worker_metrics_server() -> None:
    port = int(os.environ.get("NEXUS_WORKER_METRICS_PORT", "9101"))
    if port > 0:
        start_http_server(port)
