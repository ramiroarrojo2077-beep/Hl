#!/usr/bin/env bash
# Restaura un backup de base de datos cifrado. Detené la API y el worker antes.
#   BACKUP_PASSPHRASE=... ./infrastructure/backups/restore.sh backups/nexus-db-XXXX.sql.gz.enc
set -euo pipefail
: "${BACKUP_PASSPHRASE:?Definí BACKUP_PASSPHRASE}"
FILE="${1:?Indicá el archivo .sql.gz.enc}"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
  | gunzip \
  | docker compose exec -T postgres psql -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}" -v ON_ERROR_STOP=1
echo "Restauración completa"
