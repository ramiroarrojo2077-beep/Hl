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

Total: 93 operaciones. Además: `GET /health`, `GET /ready`, `GET /metrics`.
