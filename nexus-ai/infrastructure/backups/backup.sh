#!/usr/bin/env bash
# Backup cifrado de PostgreSQL y de los archivos de proyectos.
#   BACKUP_PASSPHRASE=... ./infrastructure/backups/backup.sh [directorio_destino]
# Restaurar: ./infrastructure/backups/restore.sh archivo.sql.gz.enc
set -euo pipefail
: "${BACKUP_PASSPHRASE:?Definí BACKUP_PASSPHRASE (se usa para cifrar con AES-256)}"
DEST="${1:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"
COMPOSE="docker compose"

$COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}" --format=plain --no-owner \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
  > "$DEST/nexus-db-$STAMP.sql.gz.enc"

$COMPOSE exec -T api tar -C /data -czf - storage \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
  > "$DEST/nexus-storage-$STAMP.tar.gz.enc"

find "$DEST" -name 'nexus-*.enc' -mtime +"$KEEP_DAYS" -delete
echo "Backup listo en $DEST ($STAMP)"
