import OpenAI from 'openai';
import { findTenantIdByWaId } from './tenantLookup.js';
import { getConversationFactsBlock } from './conversationFacts.js';
import { sanitizeWhatsAppOutboundText } from './sanitizeOutbound.js';

const MAX_TOOL_ROUNDS = 4;
const MAX_CONTEXT_MSGS = 16;

function toolsDef() {
  return [
    {
      type: 'function',
      function: {
        name: 'lookup_tenant_by_phone',
        description:
          'Indica si el número de WhatsApp está asociado a una corredora registrada en Ainspecciona.',
        parameters: {
          type: 'object',
          properties: {
            wa_id: { type: 'string', description: 'ID de usuario WhatsApp (solo dígitos)' }
          },
          required: ['wa_id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'count_open_cases',
        description:
          'Cantidad de casos del tenant que aún no están en estado DONE (borradores o en curso).',
        parameters: {
          type: 'object',
          properties: {
            tenant_id: { type: 'string', description: 'UUID del tenant' }
          },
          required: ['tenant_id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_recent_cases',
        description:
          'Lista breve de los últimos casos de inspección del tenant (código corto, estado, dirección si existe). Usar cuando pregunten por "mis casos", "estado", "última inspección".',
        parameters: {
          type: 'object',
          properties: {
            tenant_id: { type: 'string', description: 'UUID del tenant' },
            limit: { type: 'integer', description: 'Máximo de filas (1-8)', default: 5 }
          },
          required: ['tenant_id']
        }
      }
    }
  ];
}

async function runTool(name, args, ctx) {
  const { prisma, waId } = ctx;
  if (name === 'lookup_tenant_by_phone') {
    const id = String(args.wa_id || waId || '');
    const hit = await findTenantIdByWaId(prisma, id);
    if (!hit) return { encontrado: false };
    return {
      encontrado: true,
      tenant_id: hit.tenantId,
      nombre: hit.tenantName,
      estado: hit.tenantStatus
    };
  }
  if (name === 'count_open_cases') {
    const tenantId = String(args.tenant_id || '');
    if (!tenantId) return { error: 'tenant_id requerido' };
    const n = await prisma.case.count({
      where: { tenantId, status: { not: 'DONE' } }
    });
    return { casos_abiertos: n };
  }
  if (name === 'list_recent_cases') {
    const tenantId = String(args.tenant_id || '');
    if (!tenantId) return { error: 'tenant_id requerido' };
    let lim = Number(args.limit) || 5;
    if (lim < 1) lim = 1;
    if (lim > 8) lim = 8;
    const rows = await prisma.case.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: lim,
      select: {
        shortId: true,
        status: true,
        property: { select: { address: true } }
      }
    });
    return {
      casos: rows.map((r) => ({
        codigo: r.shortId || null,
        estado: r.status,
        direccion: r.property?.address || null
      }))
    };
  }
  return { error: 'unknown_tool' };
}

/**
 * @param {{ id?: string, name?: string } | null | undefined} tenantHint
 * @param {{ contactName?: string | null, contactEmail?: string | null, advisoryOffered?: boolean } | null | undefined} convHints
 */
function buildSystemPrompt(tenantHint, convHints) {
  const facts = getConversationFactsBlock();
  let ctx = '';
  if (tenantHint?.id && tenantHint?.name) {
    ctx =
      `\n## Contexto de esta conversación\n` +
      `- Este WhatsApp parece estar vinculado a la corredora: *${tenantHint.name}* (tenant_id interno: ${tenantHint.id}). ` +
      `Puedes usar herramientas con ese tenant_id si hace falta. Saluda por nombre solo si encaja con el tono.\n`;
  } else if (tenantHint?.id) {
    ctx =
      `\n## Contexto de esta conversación\n` +
      `- Hay un tenant vinculado (id ${tenantHint.id}). Usa las herramientas con ese id si aplican.\n`;
  }

  let convo = '';
  const cn = convHints?.contactName ? String(convHints.contactName).trim() : '';
  const ce = convHints?.contactEmail ? String(convHints.contactEmail).trim() : '';
  if (cn || ce) {
    convo += `\n## Datos confirmados en esta conversación\n`;
    if (cn) {
      convo +=
        `- El usuario dijo que se llama *${cn}*. Trátalo por ese nombre. **No** vuelvas a pedir el nombre ni preguntes “¿cómo te llamas?” salvo que el usuario corrija o niegue ese dato.\n`;
    }
    if (ce) {
      convo +=
        `- Correo de contacto registrado: *${ce}*. **No** vuelvas a pedir el correo salvo que el usuario lo corrija.\n`;
    }
  }
  if (!ce) {
    convo +=
      `\n## Lead / correo\n` +
      `- Aún **no** consta correo en esta conversación. Si hay **interés comercial claro** (corredora o equipo, quiere agendar o asesoría) y el momento lo permite, pedí **un** correo para seguimiento, de forma breve. **No** lo pidas en saludos genéricos ni repitas la petición en mensajes seguidos si ya preguntaste o si el usuario evitó el tema.\n`;
  }
  if (convHints?.advisoryOffered) {
    convo +=
      `\n## Asesoría / agendar (ya ofrecido)\n` +
      `- En este chat **ya** se ofreció la asesoría gratuita de 30 min o enviar enlace para agendar. **No** lo repitas ni lo insinúes de nuevo salvo que el usuario pida explícitamente el enlace, agendar o hablar con ventas/comercial.\n`;
  } else {
    convo +=
      `\n## Asesoría gratuita 30 min (oferta comercial)\n` +
      `- Solo ofrécela si hay **señal clara** de interés B2B o alta intención (corredora, equipo, varias propiedades, high ticket), según el playbook. **Como máximo una invitación** hasta que el usuario responda; no repitas en mensajes seguidos ni al responder dudas simples sobre precios o producto.\n`;
  }

  return (
    `Eres el asistente de WhatsApp de *Ainspecciona* (Chile). Sigue el playbook anterior al pie; las reglas de *Saludos y primer mensaje* tienen prioridad ante un simple saludo.\n\n` +
    facts +
    ctx +
    convo +
    `\n## Formato de cada respuesta\n` +
    `- **Sin emoticones ni emojis** en ningún mensaje (incluye caritas y símbolos decorativos; tampoco ASCII tipo :-) o : ) ).\n` +
    `- **Tildes y ortografía (Chile):** escribe en español de Chile con acentuación correcta (á, é, í, ó, ú, ñ); no quites tildes ni uses grafías de otros países si contradice el uso estándar en Chile.\n` +
    `- Un solo mensaje de WhatsApp, claro y breve salvo que el usuario pida detalle. Herramientas cuando hagan falta datos de cuenta o casos; no inventes estados ni cifras.\n` +
    `- En un saludo inicial sin más texto, tu primera pregunta es el *nombre* **solo** si aún no consta en *Datos confirmados*; tono cálido, no frío. Cuando ya tengas el nombre, usa la preferida del playbook: *Hola, [nombre]. ¿En qué puedo ayudarte hoy?* (sin emojis); opcionalmente una alternativa del playbook; no fuerces de inmediato «¿propietario o corredor?».\n` +
    `- No ofrezcas ejecutivo ni “¿te conecto?” como cierre en saludos, definiciones de producto ni preguntas de precio (ahí: enlace a /precios primero).\n` +
    `- **Coherencia de turno:** si *tú* preguntaste si querían que les contaras cómo funciona el proceso y el usuario aceptó, el siguiente mensaje **debe** ser esa explicación (pasos reales del producto). **No** ofrezcas en ese turno solo el enlace a /precios en lugar de explicar.\n` +
    `- No repitas la misma frase de apertura en mensajes consecutivos; no inventes que “un profesional visita la propiedad” como flujo por defecto: el modelo habitual es captura guiada (quien esté en terreno con el enlace, a menudo el corredor).\n` +
    `- Si el usuario parece *persona natural* (Starter), no lo mandes al portal /tenant como paso principal; ese enlace es para *corredoras*. Para dudas de correo/informe en Starter, alinea con el flujo público del sitio, no con login de corredor.\n` +
    `- Si no puedes resolver con el playbook y las herramientas, indica enlace o *menú*; *humano* solo cuando el playbook lo marque explícitamente.\n` +
    `- **Enlaces clickeables (obligatorio en WhatsApp):** las URLs (**https://...**) deben ir en **texto plano**, sin envolver en \`**\` ni en negritas de markdown. Pon el enlace completo en una línea o entre espacios (ej. el de agendar reunión HubSpot). Si rodeás el enlace con asteriscos, en WhatsApp **no** se vuelve clickeable.\n`
  );
}

/**
 * @param {object} opts
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {string} opts.waId
 * @param {string} opts.userText
 * @param {{ role: string; content: string }[]} opts.priorMessages
 * @param {{ id?: string; name?: string } | null} [opts.tenantHint]
 * @param {{ contactName?: string | null, contactEmail?: string | null, advisoryOffered?: boolean } | null} [opts.conversationHints]
 * @param {import('pino').Logger} [opts.log]
 */
export async function runOpenAiDialog({
  prisma,
  waId,
  userText,
  priorMessages,
  tenantHint,
  conversationHints,
  log
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'NO_OPENAI_KEY' };
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const maxTokens = Number(process.env.WHATSAPP_OPENAI_MAX_TOKENS || 600);
  const temperature = Number(process.env.WHATSAPP_OPENAI_TEMPERATURE ?? 0.4);
  const client = new OpenAI({ apiKey });

  const messages = [
    { role: 'system', content: buildSystemPrompt(tenantHint, conversationHints) },
    ...priorMessages.slice(-MAX_CONTEXT_MSGS),
    { role: 'user', content: String(userText || '').slice(0, 4000) }
  ];

  let completion = await client.chat.completions.create({
    model,
    messages,
    tools: toolsDef(),
    tool_choice: 'auto',
    max_tokens: maxTokens,
    temperature: Number.isFinite(temperature) ? temperature : 0.4
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const msg = completion.choices[0]?.message;
    if (!msg) break;

    if (!msg.tool_calls?.length) {
      const text = sanitizeWhatsAppOutboundText(String(msg.content || '').trim());
      return { ok: true, text: text || 'Gracias por tu mensaje.' };
    }

    messages.push(msg);
    for (const call of msg.tool_calls) {
      const name = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await runTool(name, args, { prisma, waId });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }

    completion = await client.chat.completions.create({
      model,
      messages,
      tools: toolsDef(),
      tool_choice: 'auto',
      max_tokens: maxTokens,
      temperature: Number.isFinite(temperature) ? temperature : 0.4
    });
  }

  log?.warn('whatsapp-openai-tool-rounds-exhausted');
  return {
    ok: true,
    text: sanitizeWhatsAppOutboundText(
      'No pude cerrar la consulta con las herramientas. Escribe *humano* y te ayuda el equipo.'
    )
  };
}
