# WhatsApp (360dialog / Cloud API)

## Webhook

- `GET /api/whatsapp/webhook` — verificación Meta (`hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`).
- `POST /api/whatsapp/webhook` — eventos; firma `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET` (omitir en local solo si no defines secret).
- Rate limit: ~200 POST/min por IP (memoria proceso).

## Variables de entorno


| Variable                              | Uso                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_VERIFY_TOKEN`               | Token de verificación del panel                                                                                            |
| `WHATSAPP_APP_SECRET`                 | App Secret para firma de webhook                                                                                           |
| `WHATSAPP_ACCESS_TOKEN`               | Token de envío de mensajes                                                                                                 |
| `WHATSAPP_PHONE_NUMBER_ID`            | ID del número                                                                                                              |
| `WHATSAPP_API_BASE`                   | Opcional (default Graph API v21)                                                                                           |
| `WHATSAPP_TEMPLATE_NAME`              | Plantilla HSM por defecto                                                                                                  |
| `WHATSAPP_TEMPLATE_REENGAGEMENT_NAME` | Plantilla si falla sesión (fuera de 24h)                                                                                   |
| `WHATSAPP_TEMPLATE_LANG`              | Código idioma (ej. `es`)                                                                                                   |
| `WHATSAPP_OPENAI`                     | `0` para desactivar LLM en el canal                                                                                        |
| `WHATSAPP_OPENAI_MAX_TOKENS`          | Tope de tokens por respuesta                                                                                               |
| `WHATSAPP_OPENAI_TEMPERATURE`         | Creatividad del modelo (default ~0.4)                                                                                      |
| `WHATSAPP_BOT_KNOWLEDGE_PATH`         | Ruta a un `.txt` con FAQ / comercial (default: `config/whatsapp-knowledge.txt`). `off` / `0` / `false` = no cargar archivo |
| `WHATSAPP_BOT_KNOWLEDGE`              | Texto corto extra en `.env` (opcional; se concatena con el archivo si ambos existen)                                       |
| `WHATSAPP_BOT_EXTRA_INSTRUCTIONS`     | Reglas finas (tono, excepciones); va al final del system prompt                                                            |
| `WHATSAPP_BOT_SUPPORT_NOTE`           | Una línea junto a *humano* (ej. horario de ejecutivos)                                                                     |
| `OPENAI_API_KEY` / `OPENAI_MODEL`     | Ya usados por el resto del proyecto                                                                                        |


### Más contexto para que el bot responda mejor

1. **Playbook fijo** en código: `src/whatsapp/conversationFacts.js` (límites, rol, orden para dudas). Cambiar aquí si quieres ajustar el comportamiento base para todos los entornos.
2. **Base de conocimiento** (FAQ, comercial, políticas): por defecto se carga `**config/whatsapp-knowledge.txt*`* sin definir variables. Opcional: otro path en `WHATSAPP_BOT_KNOWLEDGE_PATH`, o `off` para desactivar. El modelo lo ve en *Base de conocimiento adicional*. El servidor **lee el archivo en cada mensaje** (no hace falta reiniciar al editarlo).
3. **Proceso iterativo**: los ajustes al texto se van haciendo sobre `config/whatsapp-knowledge.txt` (comentarios en el equipo / asistente → mismo archivo).
4. **Ajustes rápidos** en `.env`: `WHATSAPP_BOT_KNOWLEDGE` para un párrafo puntual; `WHATSAPP_BOT_EXTRA_INSTRUCTIONS` para reglas de tono o “nunca digas X”; `WHATSAPP_BOT_SUPPORT_NOTE` para horario/canal humano.
5. **Datos dinámicos** (casos, cuenta): herramientas OpenAI + Prisma; no hace falta duplicarlos en el `.txt`.

`docs/whatsapp-bot-knowledge.example.txt` solo indica la ruta del archivo vivo; el contenido está en `config/whatsapp-knowledge.txt`.

## Comportamiento

1. **FSM**: menú (`menú`, `ayuda`), opciones 1–3, derivación a humano (`humano`, `agente`, etc.).
2. **Handoff**: estado `human_handoff` + `handoffAt`; respuestas acotadas hasta que el usuario escribe `menú`.
3. **OpenAI**: herramientas `lookup_tenant_by_phone`, `count_open_cases` y `list_recent_cases` (Prisma); playbook en `conversationFacts.js` + conocimiento opcional vía `WHATSAPP_BOT_KNOWLEDGE_`*.
4. **Plantillas**: si el envío de texto falla por ventana de 24h (p. ej. código 131047), se intenta `WHATSAPP_TEMPLATE_REENGAGEMENT_NAME` o `WHATSAPP_TEMPLATE_NAME`.

## Migraciones

Aplicar migraciones Prisma que añaden tablas `WhatsApp`* y el campo `handoffAt`.