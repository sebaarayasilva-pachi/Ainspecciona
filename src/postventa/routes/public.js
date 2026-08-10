import OpenAI from 'openai';
import { publicWebAppUrl } from '../normalize.js';
import { lookupOwnerUnit } from '../services/lookupUnit.js';
import { validatePostventaWarranty } from '../services/validateWarranty.js';
import { createPostventaTicket } from '../services/createTicket.js';
import { createCaptureSession } from '../services/createCaptureSession.js';
import { getTicketStatus } from '../services/ticketStatus.js';
import { VALID_CATEGORIES } from '../capture/slotTemplates.js';

/**
 * @param {string} raw
 * @returns {string}
 */
function sanitizePostventaAgentId(raw) {
  const s = String(raw || '').trim();
  const match = s.match(/(agent_[a-zA-Z0-9]+)/);
  if (match) return match[1];
  return s.split('&')[0].split('?')[0].trim();
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ prisma?: import('@prisma/client').PrismaClient | null }} [deps]
 */
/** Voz por defecto del agente postventa (Maya - LatAm es). */
const DEFAULT_TTS_VOICE_ID = 'nbcvT3C2tyOd2OsRAtUf';
/** Modelo TTS: multilingual_v2 da la mejor calidad para español (no streaming). */
const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
const TTS_MAX_CHARS = 1200;

const VOICE_CHAT_MAX_MSGS = 16;
const VOICE_CHAT_MAX_TOOL_ROUNDS = 5;
const VOICE_CHAT_DEFAULT_TENANT = 'demo-inmobiliaria';
const VOICE_CHAT_SYSTEM_PROMPT = [
  'Eres la asistente de postventa de Ainspecciona, una plataforma chilena de inspección y postventa inmobiliaria.',
  'Hablas por voz, en español de Chile, con un tono cercano, claro y profesional.',
  'Tu objetivo es ayudar al propietario a reportar un problema de postventa de su departamento o casa.',
  '',
  'Reglas de estilo (importante porque te van a escuchar, no leer):',
  '- Respuestas BREVES: 1 a 3 frases. Nada de listas largas ni textos extensos.',
  '- Una sola pregunta a la vez.',
  '- No uses emojis, viñetas, asteriscos ni markdown.',
  '- Usa números y palabras simples de pronunciar.',
  '',
  'Flujo que debes seguir paso a paso (usa las herramientas disponibles):',
  '1. Saluda y pide comuna, calle con número y número de departamento (torre solo si la mencionan).',
  '   Cuando tengas dirección y depto, llama a la herramienta buscar_unidad y confirma con el propietario.',
  '2. Pregunta brevemente el tipo de problema (1–2 frases) solo para categoría; no pidas fotos aún.',
  '3. Con unitId y categoría, llama a validar_garantia y comunica el resultado con disclaimer.',
  '4. Registra con crear_ticket.',
  '5. Al final, llama a crear_captura y abre la captura guiada de fotos (evidencia).',
  '',
  'No inventes datos de garantía ni plazos legales específicos; si te preguntan, di que un especialista lo confirmará.',
  'No vuelvas a preguntar datos que ya están en el contexto conocido del caso.',
  'Si una herramienta no encuentra la unidad, pide amablemente que verifique calle, número y comuna.'
].join('\n');

/**
 * Bloque de contexto persistente del caso, inyectado en el system para que el
 * modelo recuerde datos entre turnos (el cliente solo guarda user/assistant).
 * @param {Record<string, any>} state
 */
function buildVoiceContextBlock(state) {
  if (!state || typeof state !== 'object') return '';
  const map = [
    ['unitId', 'unitId'],
    ['unitLabel', 'unidad'],
    ['projectName', 'proyecto'],
    ['tenantSlug', 'tenantSlug'],
    ['preliminaryCategory', 'categoria'],
    ['warrantyStatus', 'garantia'],
    ['ticketShortId', 'ticket'],
    ['captureUrl', 'enlaceFotos']
  ];
  const lines = map
    .filter(([k]) => state[k])
    .map(([k, label]) => `- ${label}: ${state[k]}`);
  if (!lines.length) return '';
  return '\n\nContexto conocido del caso (no lo vuelvas a preguntar):\n' + lines.join('\n');
}

/** Definiciones de tools para function-calling del cliente de voz. */
function voiceChatTools() {
  const categories = Array.from(VALID_CATEGORIES);
  return [
    {
      type: 'function',
      function: {
        name: 'buscar_unidad',
        description:
          'Busca la unidad (departamento) del propietario por dirección del edificio, comuna y número de depto. Llamar cuando tengas dirección, comuna y número de departamento.',
        parameters: {
          type: 'object',
          properties: {
            address: { type: 'string', description: 'Dirección del edificio (calle y número).' },
            comuna: { type: 'string', description: 'Comuna del edificio.' },
            unitNumber: { type: 'string', description: 'Número de departamento, ej. 402.' },
            tower: { type: 'string', description: 'Torre o bloque (opcional).' },
            ownerRut: { type: 'string', description: 'RUT del propietario (opcional).' }
          },
          required: ['address', 'comuna', 'unitNumber']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'validar_garantia',
        description:
          'Valida si el problema está dentro del plazo de garantía. Requiere haber encontrado antes la unidad (usa el unitId del contexto).',
        parameters: {
          type: 'object',
          properties: {
            preliminaryCategory: { type: 'string', enum: categories, description: 'Categoría del problema.' }
          },
          required: ['preliminaryCategory']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'crear_ticket',
        description:
          'Crea el ticket de postventa con el resumen del problema. Llamar después de tener la unidad y la descripción del problema.',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Resumen claro del problema reportado.' },
            preliminaryCategory: { type: 'string', enum: categories },
            roomHint: { type: 'string', description: 'Recinto donde ocurre (ej. baño, cocina).' }
          },
          required: ['summary', 'preliminaryCategory']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'crear_captura',
        description:
          'Genera el enlace para que el propietario suba las fotos del problema. Llamar después de crear el ticket.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'estado_ticket',
        description: 'Consulta el estado de un ticket existente por su código (ej. PV-XXXX).',
        parameters: {
          type: 'object',
          properties: { ticketId: { type: 'string', description: 'Código del ticket.' } },
          required: ['ticketId']
        }
      }
    }
  ];
}

/**
 * Ejecuta una tool del flujo de postventa reutilizando los servicios existentes.
 * Devuelve el resultado para el modelo y un patch del estado del caso.
 * @returns {Promise<{ result: any, patch: Record<string, any> }>}
 */
async function runVoiceChatTool(name, args, { prisma, state }) {
  const tenantSlug = state.tenantSlug || VOICE_CHAT_DEFAULT_TENANT;

  if (name === 'buscar_unidad') {
    const r = await lookupOwnerUnit(prisma, { ...args, tenantSlug: state.tenantSlug || undefined });
    const patch = {};
    if (r.found) {
      patch.unitId = r.unitId;
      patch.projectId = r.projectId;
      patch.ownerId = r.ownerId;
      patch.tenantSlug = r.tenantSlug;
      patch.unitLabel = r.unitLabel;
      patch.projectName = r.projectName;
    }
    return { result: r, patch };
  }

  if (name === 'validar_garantia') {
    if (!state.unitId) {
      return { result: { ok: false, error: 'NO_UNIT', message: 'Primero busca la unidad con buscar_unidad.' }, patch: {} };
    }
    const r = await validatePostventaWarranty(prisma, {
      unitId: state.unitId,
      preliminaryCategory: args.preliminaryCategory
    });
    const patch = { preliminaryCategory: args.preliminaryCategory };
    const ws = r.warrantyStatus || r.status;
    if (ws) patch.warrantyStatus = ws;
    return { result: r, patch };
  }

  if (name === 'crear_ticket') {
    const r = await createPostventaTicket(prisma, {
      tenantSlug,
      summary: args.summary,
      preliminaryCategory: args.preliminaryCategory,
      unitId: state.unitId || null,
      ownerId: state.ownerId || null,
      projectId: state.projectId || null,
      roomHint: args.roomHint || null,
      contactName: args.contactName || state.contactName || null,
      contactPhone: args.contactPhone || state.contactPhone || null,
      source: 'voice_prueba'
    });
    const patch = {};
    if (r.ok) {
      patch.ticketId = r.ticketId;
      patch.ticketShortId = r.ticketShortId;
      patch.preliminaryCategory = args.preliminaryCategory;
    }
    return { result: r, patch };
  }

  if (name === 'crear_captura') {
    if (!state.ticketId) {
      return { result: { ok: false, error: 'NO_TICKET', message: 'Primero crea el ticket con crear_ticket.' }, patch: {} };
    }
    const r = await createCaptureSession(prisma, { ticketId: state.ticketId });
    const patch = {};
    if (r.ok) {
      patch.captureUrl = r.captureUrl;
      patch.captureToken = r.token;
    }
    return { result: r, patch };
  }

  if (name === 'estado_ticket') {
    const r = await getTicketStatus(prisma, args.ticketId, { tenantSlug: state.tenantSlug });
    return { result: r, patch: {} };
  }

  return { result: { ok: false, error: 'UNKNOWN_TOOL' }, patch: {} };
}

export async function registerPostventaPublicRoutes(app, { prisma } = {}) {
  // Capa 1 del cliente de voz propio: TTS directo vía API de ElevenLabs.
  // Devuelve el audio completo (mp3) para que el navegador lo reproduzca sin
  // el pipeline de streaming del widget (que entrecorta el arranque).
  app.post('/api/postventa/public/tts', async (req, reply) => {
    const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
    if (!key) {
      return reply.code(503).send({ ok: false, error: 'TTS_NOT_CONFIGURED' });
    }

    const text = String(req.body?.text || '').trim();
    if (!text) {
      return reply.code(400).send({ ok: false, error: 'TEXT_REQUIRED' });
    }
    if (text.length > TTS_MAX_CHARS) {
      return reply.code(400).send({ ok: false, error: 'TEXT_TOO_LONG', max: TTS_MAX_CHARS });
    }

    const voiceId = String(req.body?.voiceId || DEFAULT_TTS_VOICE_ID).trim();
    const modelId = String(req.body?.modelId || DEFAULT_TTS_MODEL).trim();

    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
      const elRes = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true }
        })
      });

      if (!elRes.ok) {
        const detail = await elRes.text().catch(() => '');
        req.log.error({ status: elRes.status, detail }, 'ElevenLabs TTS error');
        return reply.code(502).send({ ok: false, error: 'TTS_UPSTREAM', status: elRes.status });
      }

      const buf = Buffer.from(await elRes.arrayBuffer());
      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Cache-Control', 'no-store')
        .send(buf);
    } catch (err) {
      req.log.error(err, 'POST /api/postventa/public/tts');
      return reply.code(500).send({ ok: false, error: 'TTS_FAILED' });
    }
  });

  // Capa 2 + 4: cerebro conversacional (OpenAI) con tools del flujo postventa.
  // Recibe el historial + el estado del caso, ejecuta las herramientas necesarias
  // y devuelve una respuesta breve (lista para TTS) más el estado actualizado.
  app.post('/api/postventa/public/voice-chat', async (req, reply) => {
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      return reply.code(503).send({ ok: false, error: 'BRAIN_NOT_CONFIGURED' });
    }

    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const history = incoming
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-VOICE_CHAT_MAX_MSGS)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

    if (!history.length) {
      return reply.code(400).send({ ok: false, error: 'MESSAGES_REQUIRED' });
    }

    let state = req.body?.state && typeof req.body.state === 'object' ? { ...req.body.state } : {};
    const tenantSlugReq = String(req.body?.tenantSlug || '').trim();
    if (tenantSlugReq) state.tenantSlug = tenantSlugReq;

    try {
      const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
      const client = new OpenAI({ apiKey, timeout: 25000, maxRetries: 1 });
      const tools = prisma ? voiceChatTools() : undefined;

      const messages = [
        { role: 'system', content: VOICE_CHAT_SYSTEM_PROMPT + buildVoiceContextBlock(state) },
        ...history
      ];

      let replyText = '';
      for (let round = 0; round < VOICE_CHAT_MAX_TOOL_ROUNDS; round++) {
        const completion = await client.chat.completions.create({
          model,
          messages,
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
          max_tokens: 300,
          temperature: 0.5
        });

        const msg = completion.choices?.[0]?.message;
        if (!msg) break;

        if (!msg.tool_calls?.length) {
          replyText = String(msg.content || '').trim();
          break;
        }

        messages.push(msg);
        for (const call of msg.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(call.function?.arguments || '{}');
          } catch {
            args = {};
          }
          const { result, patch } = await runVoiceChatTool(call.function?.name, args, { prisma, state });
          state = { ...state, ...patch };
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        // Refrescar el contexto del system con el estado actualizado.
        messages[0] = { role: 'system', content: VOICE_CHAT_SYSTEM_PROMPT + buildVoiceContextBlock(state) };
      }

      return reply.send({
        ok: true,
        reply: replyText || '¿Podrías repetirlo, por favor?',
        state
      });
    } catch (err) {
      req.log.error(err, 'POST /api/postventa/public/voice-chat');
      return reply.code(500).send({ ok: false, error: 'BRAIN_FAILED' });
    }
  });

  app.get('/api/postventa/public/elevenlabs-agent', async (req, reply) => {
    const agentId = sanitizePostventaAgentId(process.env.ELEVENLABS_POSTVENTA_AGENT_ID || '');
    if (!agentId) {
      return reply.send({ ok: true, enabled: false, agentId: null });
    }

    const variant = String(process.env.ELEVENLABS_POSTVENTA_WIDGET_VARIANT || 'expanded').trim();
    const dismissible = process.env.ELEVENLABS_POSTVENTA_WIDGET_DISMISSIBLE !== '0';

    let tenantName = null;
    const tenantSlug = String(req.query?.tenant || '').trim();
    if (tenantSlug && prisma?.pvTenant) {
      try {
        const tenant = await prisma.pvTenant.findFirst({
          where: { slug: tenantSlug, status: 'ACTIVE' },
          select: { name: true }
        });
        tenantName = tenant?.name || null;
      } catch {
        /* ignore */
      }
    }

    return reply.send({
      ok: true,
      enabled: true,
      agentId,
      variant,
      dismissible,
      // Fallback en nuestra web (client tools como open_capture solo existen en /postventa/captura).
      talkUrl: agentId
        ? `${publicWebAppUrl()}/postventa/captura?start=1`
        : null,
      tenantSlug: tenantSlug || null,
      tenantName
    });
  });
}
