# Instalación y despliegue

## Requisitos

- Servidor Linux con Docker y Docker Compose (o Python 3.12 + PostgreSQL 16 con la extensión `vector` + Redis 7).
- Para el sandbox de código: Docker en el host del worker.
- Para compilar la app: JDK 17+ y Android SDK (platform 36, build-tools 35+).

## Desarrollo con Docker Compose

```bash
cd nexus-ai
./scripts/gen-secrets.sh > .env     # NEXUS_SECRET_KEY, NEXUS_ENCRYPTION_KEYS, POSTGRES_PASSWORD
cat .env.example >> .env            # y ajustá lo que necesites (sin duplicar claves)
docker compose up --build
```

Servicios: `postgres` (pgvector), `redis`, `migrate` (aplica Alembic y termina), `api` (puerto 8000, documentación
interactiva en `/docs`) y `worker`. Escalar workers: `docker compose up --scale worker=3`.

### Actualizar desde NEXUS AI 1.0

La 2.0 agrega las migraciones `0004` (JARVIS CORE: acciones, rutinas, voz, WhatsApp Business, puntajes de calidad,
reportes de fallos, categorías de memoria) y `0005` (orden estable de los mensajes). El servicio `migrate` las aplica
solo; sin Docker: `cd backend && .venv/bin/alembic upgrade head`. No borran datos: todo lo nuevo es aditivo.

## Desarrollo sin Docker

```bash
cd nexus-ai/backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
# .env con NEXUS_DATABASE_URL, NEXUS_REDIS_URL, NEXUS_SECRET_KEY y NEXUS_ENCRYPTION_KEYS
../scripts/dev.sh                    # migra, inicia el worker y la API con recarga
```

## Producción

1. Dominio apuntando al servidor (registro A/AAAA) y puertos 80/443 abiertos.
2. `.env` con `NEXUS_ENV=production`, `NEXUS_REQUIRE_HTTPS=true`, `NEXUS_DOMAIN`, secretos generados y
   `POSTGRES_PASSWORD` propio. Recomendado: `NEXUS_ALLOW_REGISTRATION=false` después de crear tu cuenta.
3. Levantar:
   ```bash
   docker compose -f docker-compose.yml -f infrastructure/deployment/docker-compose.prod.yml up -d --build
   ```
   Caddy obtiene y renueva el certificado TLS automáticamente. Base de datos y Redis no exponen puertos.
4. Sandbox de código: el worker usa el socket de Docker del host y el directorio compartido `/srv/nexus-sandbox`
   (`NEXUS_SANDBOX_WORKDIR`). Pre-descargá las imágenes: `docker pull python:3.12-slim node:22-slim`. Para
   desactivarlo: `NEXUS_SANDBOX_ENABLED=false`.
5. Backups cifrados (AES-256, retención configurable con `KEEP_DAYS`):
   ```bash
   BACKUP_PASSPHRASE='...' ./infrastructure/backups/backup.sh /srv/backups     # p. ej. en cron diario
   BACKUP_PASSPHRASE='...' ./infrastructure/backups/restore.sh /srv/backups/nexus-db-<fecha>.sql.gz.enc
   ```
6. Monitoreo: `/health` (vivo), `/ready` (base y Redis), `/metrics` (Prometheus; bloqueado en el proxy público) y
   métricas del worker en el puerto 9101. `infrastructure/monitoring/prometheus.yml` ya los recolecta.

### Rotación de la clave de cifrado

Agregá la clave nueva **al principio** de `NEXUS_ENCRYPTION_KEYS` (separadas por coma) y reiniciá: lo nuevo se cifra
con ella y lo anterior se sigue descifrando con las viejas.

### Detener agentes, workers o el servidor

| Qué | Cómo |
|---|---|
| Una tarea | App › misión › tarea › Cancelar (`POST /missions/{id}/tasks/{task}/cancel`) |
| Todos los agentes de un usuario | Botón **STOP ALL** (`POST /system/emergency-stop`) |
| Los workers | `docker compose stop worker` (SIGTERM: termina lo seguro y libera el resto) |
| El servidor | `docker compose down` |

## Notificaciones push (opcional)

1. Creá un proyecto en Firebase y una app Android con el id `ai.nexus.app`.
2. Servidor: descargá la clave de una **cuenta de servicio** (Configuración › Cuentas de servicio), montala en el
   contenedor y configurá `NEXUS_FCM_SERVICE_ACCOUNT_FILE`.
3. App: completá en `android/gradle.properties` `nexus.firebase.applicationId`, `apiKey`, `projectId` y `senderId`
   (valores públicos de la app Firebase) y recompilá.

Sin FCM la app recibe eventos en tiempo real mientras está abierta y revisa notificaciones cada ~15 minutos en
segundo plano.

## Compilar la app Android

```bash
cd nexus-ai/android
echo "sdk.dir=/ruta/al/android-sdk" > local.properties
./gradlew :app:assembleDebug           # app/build/outputs/apk/debug/app-debug.apk (permite HTTP local)
./gradlew :app:testDebugUnitTest       # tests de lógica y UI de punta a punta (capturas en app/build/screenshots)
```

Release firmada: creá tu keystore y `android/keystore.properties` (no se versiona):

```bash
keytool -genkeypair -keystore keystore/nexus-release.jks -alias nexus -keyalg RSA -keysize 4096 -validity 9125
cat > keystore.properties <<EOF
storeFile=keystore/nexus-release.jks
storePassword=...
keyAlias=nexus
keyPassword=...
EOF
./gradlew :app:assembleRelease          # exige HTTPS; minificada con R8
```

Guardá el keystore: sin él no podrás publicar actualizaciones que se instalen encima de la versión anterior.

La URL por defecto del servidor se define con `nexus.defaultServerUrl` en `gradle.properties` (también se puede
cambiar desde la pantalla de inicio de sesión y en Ajustes › Conexión).

## Variables de entorno del backend

| Variable | Default | Descripción |
|---|---|---|
| `NEXUS_ENV` | development | `production` activa validaciones estrictas |
| `NEXUS_DATABASE_URL` | postgresql+asyncpg://nexus:nexus@localhost:5432/nexus | PostgreSQL con pgvector |
| `NEXUS_REDIS_URL` | redis://localhost:6379/0 | eventos entre procesos y rate limiting |
| `NEXUS_SECRET_KEY` | — | firma JWT (obligatoria) |
| `NEXUS_ENCRYPTION_KEYS` | — | claves Fernet (obligatoria) |
| `NEXUS_ACCESS_TOKEN_TTL_SECONDS` | 900 | vida del access token |
| `NEXUS_REFRESH_TOKEN_TTL_DAYS` | 30 | vida del refresh token |
| `NEXUS_ALLOW_REGISTRATION` | true | registro abierto |
| `NEXUS_REQUIRE_HTTPS` | false | rechaza HTTP (respeta `X-Forwarded-Proto`) |
| `NEXUS_RATE_LIMIT_PER_MINUTE` / `NEXUS_AUTH_RATE_LIMIT_PER_MINUTE` | 240 / 12 | límites por usuario / por IP en auth |
| `NEXUS_STORAGE_DIR` | ./storage | archivos de proyectos |
| `NEXUS_WORKER_CONCURRENCY` | 4 | trabajos simultáneos por worker |
| `NEXUS_JOB_LEASE_SECONDS` | 120 | lease de cada trabajo |
| `NEXUS_JOB_MAX_ATTEMPTS` | 3 | reintentos por trabajo/tarea |
| `NEXUS_MAX_TASKS_PER_MISSION` | 12 | tope del plan |
| `NEXUS_MAX_AGENT_STEPS` | 8 | pasos de herramientas por ejecución |
| `NEXUS_MAX_REVIEW_ROUNDS` | 1 | rondas de corrección pedidas por ORACLE |
| `NEXUS_LLM_TIMEOUT_SECONDS` / `NEXUS_LLM_MAX_RETRIES` | 240 / 2 | llamadas a modelos |
| `NEXUS_MEMORY_TOP_K` | 6 | recuerdos por ejecución |
| `NEXUS_SANDBOX_*` | enabled, 60 s, 512 MB | sandbox de código |
| `NEXUS_FCM_SERVICE_ACCOUNT_FILE` | — | push FCM |
| `NEXUS_WHATSAPP_BUSINESS_TOKEN`, `NEXUS_WHATSAPP_PHONE_NUMBER_ID` | — | WhatsApp Business Platform (opcional, ver [WHATSAPP.md](WHATSAPP.md)) |
| `NEXUS_WHATSAPP_APP_SECRET`, `NEXUS_WHATSAPP_VERIFY_TOKEN` | — | firma y verificación del webhook de Business |
| `NEXUS_WHATSAPP_BUSINESS_OWNER_EMAIL` | — | usuario de NEXUS titular de la cuenta Business |
| `NEXUS_WHATSAPP_GRAPH_VERSION` | v21.0 | versión de la Graph API de Meta |

Permisos de la app y qué hace NEXUS con cada uno: [PERMISSIONS.md](PERMISSIONS.md).
