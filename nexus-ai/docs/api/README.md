# API v1

Base: `/api/v1`. Autenticación: `Authorization: Bearer <access_token>` (salvo registro, login y refresh).
Documentación interactiva (OpenAPI) en `/docs` cuando `NEXUS_ENV` no es `production`.

## Errores

```json
{"error": "budget_exceeded", "message": "Límite diario alcanzado (USD 1.0000 de 1.00)"}
```
Códigos usados: 400 validación de dominio, 401 sesión, 402 presupuesto, 403 permiso, 404 no encontrado (también para recursos de otro usuario), 409 conflicto de estado, 422 validación de entrada, 423 STOP ALL activo, 429 rate limit, 502 proveedor de IA.

## Tiempo real (WebSocket `/api/v1/ws`)

1. Conectar y enviar `{"type":"auth","token":"<access_token>"}` en menos de 10 s (el token no viaja en la URL).
2. El servidor responde `{"type":"ready"}` y luego envía eventos `{"id","type","ts","data"}` del usuario autenticado.
3. `{"type":"ping"}` → `{"type":"pong"}`. La sesión se revalida cada 60 s; si se revoca, se cierra con código 4401.

Eventos: `agent.status`, `agent.updated`, `mission.updated`, `task.updated`, `message.created`, `chat.delta` (streaming), `meeting.updated`, `activity.created`, `notification.created`, `approval.created`, `system.emergency_stop`.

Eventos 2.0: `jarvis.state` (estado real del asistente: `idle`, `listening`, `thinking`, `executing`, `waiting_confirmation`, `collaborating`, `error`, con `entity` cuando aplica), `voice.state`, `action.updated` (ciclo de vida de una acción), `automation.updated`, `automation.run`, `whatsapp.business.status` (estados recibidos por webhook firmado). Cada evento tiene `id` único: la app descarta los repetidos tras una reconexión.


## Módulos 2.0 (resumen)

- **JARVIS** (`/jarvis/*`): `POST /jarvis/message` recibe `{text, conversation_id?, source: "text"|"voice"}` y
  recorre las etapas del pipeline (entrada → intención → contexto → memoria → plan → herramientas/modelo →
  verificación → respuesta → acción → aprendizaje); cada etapa queda en la traza
  (`GET /jarvis/messages/{id}/trace`). `POST /jarvis/intent` clasifica sin ejecutar nada. `DELETE /jarvis/history`
  exige `?confirm=true`.
- **Acciones** (`/actions/*`): catálogo con clase de riesgo (`READ_ONLY`, `LOCAL_REVERSIBLE`,
  `EXTERNAL_COMMUNICATION`, `SENSITIVE`, `IRREVERSIBLE`). Las de comunicación externa, sensibles e irreversibles
  quedan en `awaiting_confirmation` hasta `POST /actions/{id}/confirm`. Las acciones del teléfono las ejecuta la app
  y su resultado real llega por `POST /actions/{id}/report`; las del servidor se verifican releyendo el estado.
- **Rutinas** (`/automations/*`): disparadores `schedule` (cron, mínimo 15 min), `date` y `event`; límites por
  día, totales, enfriamiento y tope horario; una rutina no puede dispararse con eventos que ella misma generó.
- **WhatsApp** (`/integrations/whatsapp/*`): ver [docs/setup/WHATSAPP.md](../setup/WHATSAPP.md). `normalize` y
  `prepare` nunca envían nada; el webhook de Business valida `X-Hub-Signature-256`.
- **Voz** (`/voice/*`): ajustes por usuario; `transcriptions` y `synthesis` solo funcionan con un modelo con
  capacidad `stt`/`tts` configurado (si no, `400 no_stt_model` / `no_tts_model`; la app usa entonces el reconocimiento y la voz del teléfono).
- **Calidad** (`GET /quality`): puntajes medidos por modelo y tipo de tarea que usa el router.
- **Privacidad** (`GET /memory/privacy`): categorías de memoria, conteos y estado de cada una.
- **Diagnóstico** (`/diagnostics/crash`): reportes de fallos solo con consentimiento; se filtran datos personales.

## Endpoints
### auth

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/login` | Login |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Me |
| POST | `/auth/refresh` | Refresh |
| POST | `/auth/register` | Register |
| GET | `/auth/sessions` | Sessions |
| DELETE | `/auth/sessions/{family_id}` | Revoke Session |

### agents

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/agents` | List Agents |
| POST | `/agents` | Create Agent |
| GET | `/agents/persona-catalog` | Get Persona Catalog |
| DELETE | `/agents/{agent_id}` | Delete Agent |
| GET | `/agents/{agent_id}` | Get Agent |
| PATCH | `/agents/{agent_id}` | Update Agent |
| POST | `/agents/{agent_id}/conversation` | Open Conversation |
| GET | `/agents/{agent_id}/instructions` | Instruction Versions |
| PUT | `/agents/{agent_id}/models` | Set Models |
| PUT | `/agents/{agent_id}/permissions` | Set Permissions |
| GET | `/agents/{agent_id}/tasks` | Agent Tasks |

### missions

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/approvals` | List Approvals |
| POST | `/approvals/{approval_id}/decision` | Decide Approval |
| GET | `/missions` | List Missions |
| POST | `/missions` | Create Mission |
| GET | `/missions/{mission_id}` | Get Mission |
| PATCH | `/missions/{mission_id}` | Update Mission |
| POST | `/missions/{mission_id}/cancel` | Cancel |
| GET | `/missions/{mission_id}/messages` | Mission Messages |
| POST | `/missions/{mission_id}/pause` | Pause |
| POST | `/missions/{mission_id}/resume` | Resume |
| GET | `/missions/{mission_id}/tasks/{task_id}/attempts` | Task Attempts |
| POST | `/missions/{mission_id}/tasks/{task_id}/cancel` | Cancel Task |
| POST | `/missions/{mission_id}/tasks/{task_id}/retry` | Retry Task |
| POST | `/missions/{mission_id}/tasks/{task_id}/skip` | Skip Task |

### meetings

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/meetings` | List Meetings |
| POST | `/meetings` | Create |
| GET | `/meetings/{meeting_id}` | Get |
| POST | `/meetings/{meeting_id}/cancel` | Cancel |
| POST | `/meetings/{meeting_id}/mission` | Mission From Meeting |

### memory

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/memory` | List Memory |
| POST | `/memory` | Create |
| POST | `/memory/bulk-delete` | Bulk Delete |
| GET | `/memory/privacy` | Privacy |
| POST | `/memory/search` | Search |
| GET | `/memory/stats` | Stats |
| DELETE | `/memory/{memory_id}` | Delete |
| PATCH | `/memory/{memory_id}` | Update |

### providers

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/evals` | List Evals |
| POST | `/evals` | Create Eval |
| GET | `/evals/{run_id}` | Get Eval |
| GET | `/models` | List Models |
| POST | `/models` | Create Model |
| DELETE | `/models/{model_id}` | Delete Model |
| PATCH | `/models/{model_id}` | Update Model |
| GET | `/providers` | List Providers |
| POST | `/providers` | Create Provider |
| GET | `/providers/kinds` | Provider Kinds |
| DELETE | `/providers/{provider_id}` | Delete Provider |
| PATCH | `/providers/{provider_id}` | Update Provider |
| POST | `/providers/{provider_id}/test` | Test Provider |
| GET | `/quality` | Quality Summary |

### activity

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/activity` | Activity |
| GET | `/dashboard` | Dashboard |
| GET | `/system/status` | System Status |
| GET | `/usage/records` | Usage Records |
| GET | `/usage/summary` | Usage Summary |

### settings

| Método | Ruta | Descripción |
|---|---|---|
| DELETE | `/devices` | Unregister Device |
| POST | `/devices` | Register Device |
| GET | `/export` | Export Data |
| GET | `/notifications` | Notifications |
| POST | `/notifications/read-all` | Read All |
| POST | `/notifications/{notification_id}/read` | Read Notification |
| GET | `/plugins` | Plugins |
| PATCH | `/plugins/{key}` | Update Plugin |
| GET | `/plugins/{key}/activity` | Plugin Activity |
| PUT | `/plugins/{key}/permissions` | Set Plugin Permission |
| GET | `/schedules` | Schedules |
| POST | `/schedules` | Create Schedule |
| DELETE | `/schedules/{schedule_id}` | Delete Schedule |
| PATCH | `/schedules/{schedule_id}` | Update Schedule |
| GET | `/settings` | Get Settings  |
| PATCH | `/settings` | Update Settings |
| DELETE | `/system/emergency-stop` | Clear Emergency Stop |
| POST | `/system/emergency-stop` | Emergency Stop |
| GET | `/tools` | Tools |

### projects

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/projects` | List Projects |
| POST | `/projects` | Create Project |
| DELETE | `/projects/{project_id}` | Delete Project |
| GET | `/projects/{project_id}` | Get Project |
| PATCH | `/projects/{project_id}` | Update Project |
| GET | `/projects/{project_id}/files` | List Files |
| POST | `/projects/{project_id}/files` | Upload File |
| GET | `/projects/{project_id}/files/{file_id}/content` | Download File |

### chat

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/conversations` | List Conversations |
| POST | `/conversations` | Create Conversation |
| DELETE | `/conversations/{conversation_id}` | Delete Conversation |
| GET | `/conversations/{conversation_id}/messages` | Messages |
| POST | `/conversations/{conversation_id}/messages` | Send |

### jarvis

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/jarvis/context` | Context |
| DELETE | `/jarvis/history` | Delete History |
| POST | `/jarvis/intent` | Intent |
| POST | `/jarvis/message` | Message |
| POST | `/jarvis/messages/{message_id}/feedback` | Feedback |
| GET | `/jarvis/messages/{message_id}/trace` | Trace |
| GET | `/jarvis/settings` | Get Jarvis Settings |
| GET | `/jarvis/state` | State |
| POST | `/jarvis/voice/session` | Voice Session |

### actions

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/actions` | List Actions |
| GET | `/actions/catalog` | Catalog |
| POST | `/actions/execute` | Execute |
| GET | `/actions/{action_id}` | Get Action |
| POST | `/actions/{action_id}/cancel` | Cancel |
| POST | `/actions/{action_id}/confirm` | Confirm |
| POST | `/actions/{action_id}/report` | Report |

### automations

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/automations` | List Automations |
| POST | `/automations` | Create |
| GET | `/automations/events` | Event Catalog |
| DELETE | `/automations/{automation_id}` | Delete |
| GET | `/automations/{automation_id}` | Get One |
| PATCH | `/automations/{automation_id}` | Update |
| POST | `/automations/{automation_id}/pause` | Pause |
| POST | `/automations/{automation_id}/resume` | Resume |
| POST | `/automations/{automation_id}/run` | Run Now |
| GET | `/automations/{automation_id}/runs` | Runs |

### whatsapp

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/integrations/whatsapp/business/status` | Business Status |
| GET | `/integrations/whatsapp/business/webhook` | Webhook Verify |
| POST | `/integrations/whatsapp/business/webhook` | Webhook Receive |
| POST | `/integrations/whatsapp/contact/resolve` | Resolve Contact |
| POST | `/integrations/whatsapp/draft` | Draft |
| POST | `/integrations/whatsapp/normalize` | Normalize Number |
| POST | `/integrations/whatsapp/prepare` | Prepare |
| GET | `/integrations/whatsapp/status` | Wa Status |

### voice

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/voice/settings` | Get Settings  |
| PATCH | `/voice/settings` | Patch Settings |
| POST | `/voice/synthesis` | Synthesis |
| POST | `/voice/transcriptions` | Transcriptions |

### diagnostics

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/diagnostics/crash` | List Crashes |
| POST | `/diagnostics/crash` | Report Crash |

Total: 136 operaciones. Además: `GET /health`, `GET /ready`, `GET /metrics`.
