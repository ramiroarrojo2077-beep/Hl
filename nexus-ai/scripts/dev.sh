#!/usr/bin/env bash
# Desarrollo local sin Docker: requiere PostgreSQL 16 con pgvector y Redis corriendo.
set -euo pipefail
cd "$(dirname "$0")/../backend"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt; }
.venv/bin/alembic upgrade head
.venv/bin/python -m app.worker &
WORKER=$!
trap 'kill $WORKER' EXIT
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
