# Integración con WhatsApp — NEXUS 2.0

NEXUS ofrece dos caminos. Ninguno usa automatización de la interfaz, scraping ni métodos no oficiales.

## 1. WhatsApp personal (Click to Chat) — sin configuración

1. Pedilo como quieras: «Mandale un mensaje a papá diciendo que llego tarde», «decile a Juan que ya salgo»,
   o con la acción rápida **Enviar WhatsApp**.
2. **Contacto**: NEXUS busca el alias entre los contactos que vos guardaste en NEXUS (cifrados en el teléfono).
   Si no lo tiene, te pide elegirlo con el selector nativo de Android o escribir el número. Si hay varios
   posibles, te pregunta cuál.
3. **Número**: se valida y normaliza para Argentina (`54 9 <área> <número>`): quita el 0 y el 15, agrega el 9 de
   celular y te muestra cualquier suposición («Agregué el 9 de celular…») para que la confirmes. Si falta el
   código de área, te lo pide.
4. **Vista previa obligatoria**: destinatario con número parcialmente oculto, app (WhatsApp o Business), texto
   completo, tonos (informal, formal, amistoso, breve, profesional, explicativo), corregir y traducir. Mejorar el
   texto usa tu modelo de IA **sin inventar datos** y solo si lo pedís.
5. **Confirmar y abrir WhatsApp** abre `https://wa.me/<número>?text=<texto>` con el mensaje listo.
6. **El envío lo hacés vos** tocando Enviar en WhatsApp. NEXUS registra `WHATSAPP_OPENED` y te dice
   «Todavía no está enviado». Nunca afirma que un mensaje se envió, entregó o leyó.

Estados: `DRAFT_CREATED`, `CONTACT_RESOLVED`, `AWAITING_CONFIRMATION`, `READY_TO_OPEN`, `WHATSAPP_OPENED`,
`CANCELLED`, `ERROR`. Podés cancelar en cualquier paso y volver a preparar.

**Privacidad**: el número de un contacto personal no se guarda en claro en el servidor (cifrado y enmascarado en la
acción) y la agenda nunca se sube. El texto llega al servidor solo si vos lo escribiste en el chat de NEXUS o
pediste mejorarlo con IA.

## 2. WhatsApp Business Platform (Cloud API oficial) — opcional

Para enviar desde el servidor (p. ej. rutinas que avisan a clientes que aceptaron recibir mensajes).

### Configuración (solo en el servidor, nunca en la app)

| Variable | Valor |
|---|---|
| `NEXUS_WHATSAPP_BUSINESS_TOKEN` | Token de sistema de Meta con permiso `whatsapp_business_messaging` |
| `NEXUS_WHATSAPP_PHONE_NUMBER_ID` | ID del número en el WhatsApp Manager |
| `NEXUS_WHATSAPP_APP_SECRET` | App Secret de la app de Meta (valida la firma `X-Hub-Signature-256`) |
| `NEXUS_WHATSAPP_VERIFY_TOKEN` | Texto que elegís para verificar el webhook |
| `NEXUS_WHATSAPP_BUSINESS_OWNER_EMAIL` | Email de tu usuario de NEXUS titular de la cuenta |
| `NEXUS_WHATSAPP_GRAPH_VERSION` | Versión de la Graph API (por defecto `v21.0`; actualizala según Meta) |

Webhook en Meta: `https://<tu-servidor>/api/v1/integrations/whatsapp/business/webhook` (suscribí `messages`).

### Reglas que aplica NEXUS

- Cada envío es una acción de **comunicación externa**: siempre requiere tu confirmación.
- **Consentimiento**: tenés que declarar que el destinatario aceptó recibir mensajes (`opt_in_confirmed`).
- **Ventana de 24 h**: texto libre solo si la persona te escribió en las últimas 24 h; si no, plantilla aprobada.
- **Estados reales**: `ACCEPTED` (respuesta de la API) y luego `sent`/`delivered`/`read`/`failed` únicamente por
  webhooks firmados. Los webhooks repetidos se ignoran; nada se infiere.
- Los números se guardan cifrados; para la ventana de 24 h se usa un HMAC del número.

Estado de la integración en la app: Más → Integraciones.
