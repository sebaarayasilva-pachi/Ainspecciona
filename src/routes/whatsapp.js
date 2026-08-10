import crypto from 'node:crypto';
import { getWhatsAppKnowledgeFileStatus } from '../whatsapp/conversationFacts.js';
import { sanitizeWhatsAppOutboundText } from '../whatsapp/sanitizeOutbound.js';
import { verifyMetaSignature, extractInboundTextMessages } from '../whatsapp/metaWebhook.js';
import { trySendTextWithTemplateFallback } from '../whatsapp/send.js';
import { resolveInboundReply } from '../whatsapp/handler.js';
import { webhookRateLimitOk } from '../whatsapp/webhookRateLimit.js';

async function loadPriorTurns(prisma, conversationId, excludeExternalId) {
  const where = { conversationId };
  if (excludeExternalId) {
    where.NOT = { externalId: excludeExternalId };
  }
  const rows = await prisma.whatsAppMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 14,
    select: { direction: true, body: true }
  });
  return rows
    .reverse()
    .map((r) => ({
      role: r.direction === 'OUTBOUND' ? 'assistant' : 'user',
      content: String(r.body || '').slice(0, 2000)
    }))
    .filter((t) => t.content.length > 0);
}

/**
 * Procesa un único mensaje entrante (webhook o simulación).
 * @returns {Promise<{ ok: boolean, replyText?: string, sent?: boolean, error?: string, skipped?: string }>}
 */
export async function processOneInbound(log, prisma, msg) {
  if (!msg.messageId || !msg.from) {
    return { ok: false, error: 'INVALID_MESSAGE' };
  }

  try {
    const already = await prisma.whatsAppProcessedEvent.findUnique({
      where: { externalId: msg.messageId }
    });
    if (already) {
      log.info({ messageId: msg.messageId }, 'whatsapp-dedupe-skip');
      return { ok: true, skipped: 'already_processed' };
    }

    const existingInbound = await prisma.whatsAppMessage.findUnique({
      where: { externalId: msg.messageId },
      include: { conversation: true }
    });

    let conv;
    let replyAfter;
    if (existingInbound) {
      conv = existingInbound.conversation;
      replyAfter = existingInbound.createdAt;
    } else {
      conv = await prisma.whatsAppConversation.upsert({
        where: { waId: msg.from },
        create: {
          waId: msg.from,
          lastInboundAt: new Date()
        },
        update: { lastInboundAt: new Date() }
      });
      const created = await prisma.whatsAppMessage.create({
        data: {
          conversationId: conv.id,
          direction: 'INBOUND',
          body: msg.text,
          externalId: msg.messageId,
          meta: { timestamp: msg.timestamp, ...(msg.meta || {}) }
        }
      });
      replyAfter = created.createdAt;
    }

    const alreadyReplied = await prisma.whatsAppMessage.findFirst({
      where: {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        createdAt: { gte: replyAfter }
      }
    });
    if (alreadyReplied) {
      await prisma.whatsAppProcessedEvent
        .create({ data: { externalId: msg.messageId } })
        .catch(() => {});
      return { ok: true, skipped: 'already_replied' };
    }

    const priorTurns = await loadPriorTurns(prisma, conv.id, existingInbound?.externalId || null);
    const inboundCount = await prisma.whatsAppMessage.count({
      where: { conversationId: conv.id, direction: 'INBOUND' }
    });
    /** Primer mensaje entrante de esta conversación (para saludo fijo que pide nombre). */
    const isFirstInbound = inboundCount === 1;
    const freshConv = await prisma.whatsAppConversation.findUnique({
      where: { id: conv.id }
    });
    if (!freshConv) {
      return { ok: false, error: 'CONVERSATION_NOT_FOUND' };
    }

    const resolved = await resolveInboundReply({
      prisma,
      conversation: freshConv,
      waId: msg.from,
      text: msg.text,
      priorTurns,
      isFirstInbound,
      log
    });
    const replyText = sanitizeWhatsAppOutboundText(resolved.text);

    const testMode =
      process.env.WHATSAPP_TEST_MODE === '1' || process.env.WHATSAPP_TEST_MODE === 'true';
    const hasWaSendCreds = !!(
      process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
    );
    const isTestSimulation = String(msg.messageId || '').startsWith('test:');

    if (testMode && !hasWaSendCreds && isTestSimulation) {
      log.info('whatsapp-test-skip-send-no-credentials');
      await prisma.whatsAppMessage.create({
        data: {
          conversationId: conv.id,
          direction: 'OUTBOUND',
          body: replyText,
          externalId: null,
          meta: { testModeSkippedSend: true, reason: 'MISSING_WHATSAPP_CREDENTIALS' }
        }
      });
      await prisma.whatsAppProcessedEvent.create({
        data: { externalId: msg.messageId }
      });
      return {
        ok: true,
        replyText,
        sent: false,
        whatsappSkipped: true,
        hint: 'Modo prueba: sin credenciales WhatsApp; la respuesta quedó guardada en BD. Configura WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID para envío real.'
      };
    }

    const sent = await trySendTextWithTemplateFallback({
      to: msg.from,
      text: replyText,
      log
    });

    if (!sent.ok) {
      log.warn({ err: sent.error }, 'whatsapp-outbound-failed');
      return { ok: false, error: sent.error || 'SEND_FAILED', replyText };
    }

    await prisma.whatsAppMessage.create({
      data: {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: replyText,
        externalId: sent.messageId || null,
        meta: sent.raw ? { api: sent.raw } : undefined
      }
    });

    await prisma.whatsAppProcessedEvent.create({
      data: { externalId: msg.messageId }
    });

    return { ok: true, replyText, sent: true };
  } catch (err) {
    log.error(err, 'whatsapp-inbound-process-error');
    return { ok: false, error: err?.message || 'PROCESS_ERROR' };
  }
}

async function processInboundBatch(log, prisma, messages) {
  for (const msg of messages) {
    await processOneInbound(log, prisma, msg);
  }
}

function testModeEnabled() {
  return process.env.WHATSAPP_TEST_MODE === '1' || process.env.WHATSAPP_TEST_MODE === 'true';
}

/** Si está definido, /api/whatsapp/test/* exige este valor (header o Bearer). */
function getWhatsAppTestSecret() {
  return String(process.env.WHATSAPP_TEST_SECRET || '').trim();
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @param {import('fastify').FastifyRequest} req
 * @returns {{ ok: true } | { ok: false, status: 401 | 403, error: string, hint?: string }}
 */
function checkWhatsAppTestSecret(req) {
  const expected = getWhatsAppTestSecret();
  if (!expected) return { ok: true };

  const auth = String(req.headers.authorization || '');
  const bearer = /^Bearer\s+(\S+)/i.exec(auth);
  const fromHeader = String(req.headers['x-whatsapp-test-secret'] || '').trim();
  const provided = (bearer ? bearer[1] : fromHeader) || '';

  if (!provided) {
    return {
      ok: false,
      status: 401,
      error: 'TEST_SECRET_REQUIRED',
      hint: 'Configura WHATSAPP_TEST_SECRET en el servidor y envía la clave en el header X-WhatsApp-Test-Secret o Authorization: Bearer.'
    };
  }
  if (!timingSafeEqualStr(expected, provided)) {
    return {
      ok: false,
      status: 403,
      error: 'TEST_SECRET_INVALID',
      hint: 'Clave de prueba incorrecta.'
    };
  }
  return { ok: true };
}

export async function registerWhatsAppRoutes(app, { prisma }) {
  app.get('/api/whatsapp/test/status', async (req, reply) => {
    if (!testModeEnabled()) {
      return reply.code(403).send({ error: 'TEST_MODE_DISABLED', hint: 'Set WHATSAPP_TEST_MODE=1' });
    }
    const secretCheck = checkWhatsAppTestSecret(req);
    if (!secretCheck.ok) {
      return reply.code(secretCheck.status).send({
        error: secretCheck.error,
        hint: secretCheck.hint
      });
    }
    const knowledge = getWhatsAppKnowledgeFileStatus();
    const inlineKnowledge = !!String(process.env.WHATSAPP_BOT_KNOWLEDGE || '').trim();
    return reply.send({
      ok: true,
      testMode: true,
      secretRequired: !!getWhatsAppTestSecret(),
      env: {
        verifyToken: !!process.env.WHATSAPP_VERIFY_TOKEN,
        appSecret: !!process.env.WHATSAPP_APP_SECRET,
        accessToken: !!process.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
        openai: !!process.env.OPENAI_API_KEY,
        templateConfigured: !!(process.env.WHATSAPP_TEMPLATE_NAME || process.env.WHATSAPP_TEMPLATE_REENGAGEMENT_NAME)
      },
      knowledge: {
        ...knowledge,
        inlineEnv: inlineKnowledge
      }
    });
  });

  app.post('/api/whatsapp/test/simulate', async (req, reply) => {
    if (!testModeEnabled()) {
      return reply.code(403).send({ error: 'TEST_MODE_DISABLED', hint: 'Set WHATSAPP_TEST_MODE=1' });
    }
    const secretCheck = checkWhatsAppTestSecret(req);
    if (!secretCheck.ok) {
      return reply.code(secretCheck.status).send({
        error: secretCheck.error,
        hint: secretCheck.hint
      });
    }
    if (!prisma) return reply.code(500).send({ error: 'DATABASE_NOT_CONFIGURED' });

    const payload = req.body || {};
    const waId = String(payload.waId || '').replace(/\D/g, '');
    const text = String(payload.text || '').slice(0, 4000);
    if (!waId || waId.length < 8) {
      return reply.code(400).send({ error: 'INVALID_WA_ID', hint: 'Solo dígitos, ej. 56912345678' });
    }

    const messageId = `test:${crypto.randomUUID()}`;
    const msg = {
      messageId,
      from: waId,
      text,
      timestamp: Math.floor(Date.now() / 1000),
      meta: { source: 'whatsapp-test-page' }
    };

    const result = await processOneInbound(app.log, prisma, msg);
    return reply.send({
      ok: result.ok,
      messageId,
      replyText: result.replyText,
      sent: result.sent,
      skipped: result.skipped,
      whatsappSkipped: result.whatsappSkipped,
      hint: result.hint,
      error: result.error
    });
  });

  app.get('/api/whatsapp/webhook', async (req, reply) => {
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = req.query['hub.challenge'];
    const verify = process.env.WHATSAPP_VERIFY_TOKEN || '';

    if (mode === 'subscribe' && token && verify && token === verify) {
      return reply.code(200).type('text/plain').send(String(challenge ?? ''));
    }
    return reply.code(403).send({ error: 'FORBIDDEN' });
  });

  app.post('/api/whatsapp/webhook', async (req, reply) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!webhookRateLimitOk(ip)) {
      return reply.code(429).send({ error: 'RATE_LIMIT' });
    }

    const raw = req.rawBody;
    const appSecret = process.env.WHATSAPP_APP_SECRET || '';
    const sig = req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256'];

    if (appSecret && Buffer.isBuffer(raw)) {
      if (!verifyMetaSignature(raw, sig, appSecret)) {
        app.log.warn('whatsapp-webhook-signature-invalid');
        return reply.code(401).send({ error: 'INVALID_SIGNATURE' });
      }
    } else if (appSecret && !Buffer.isBuffer(raw)) {
      app.log.warn('whatsapp-webhook-missing-raw-body');
      return reply.code(500).send({ error: 'RAW_BODY_REQUIRED' });
    }

    const payload = req.body || {};
    const messages = extractInboundTextMessages(payload);

    reply.code(200).send({ ok: true, received: messages.length });

    if (!prisma || messages.length === 0) return;

    void processInboundBatch(app.log, prisma, messages);
  });
}
