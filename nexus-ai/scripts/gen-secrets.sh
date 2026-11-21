#!/usr/bin/env bash
# Genera secretos aleatorios para .env
set -euo pipefail
python3 - <<'PY'
import base64, os, secrets
print("NEXUS_SECRET_KEY=" + secrets.token_urlsafe(48))
print("NEXUS_ENCRYPTION_KEYS=" + base64.urlsafe_b64encode(os.urandom(32)).decode())
print("POSTGRES_PASSWORD=" + secrets.token_urlsafe(24))
PY
