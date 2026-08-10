/**
 * Orquestación: FSM, handoff, menú y OpenAI con herramientas (lógica de dominio propia).
 */

import {
  WA_STATES,
  nextStateFromInput,
  getStaticMenuText,
  replyForMenuChoice,
  handoffAckText,
  detectMenuIntent
} from './fsm.js';
import { runOpenAiDialog } from './openaiDialog.js';
import { findTenantIdByWaId } from './tenantLookup.js';
import {
  extractContactNameFromMessage,
  extractContactEmailFromMessage,
  messageSuggestsAdvisoryOffer
} from './contactName.js';

function openAiEnabled() {
  if (process.env.WHATSAPP_OPENAI === '0' || process.env.WHATSAPP_OPENAI === 'false') return false;
  return !!process.env.OPENAI_API_KEY;
}

function fallbackReply() {
  return (
    `Gracias por escribirnos. Para opciones automáticas escribe *menú*. ` +
    `Para hablar con una persona, escribe *humano*.`
  );
}

/** Saludo muy corto sin pregunta concreta (primer mensaje → pedir nombre; no depender del LLM). */
function isBareGreeting(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (raw.length > 56) return false;
  const normalized = raw.replace(/^[!¡¿?\s]+|[!¡?.…,\s]+$/g, '').trim();
  if (!normalized) return false;
  return /^(hola|holaa+|buenas|buen[oa]s?\s*d[ií]as?|hey|qu[eé]\s*tal|buen[oa]s?\s*tardes?|buen[oa]s?\s*noches?)$/i.test(
    normalized
  );
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string | null | undefined} tenantId
 */
async function loadTenantHint(prisma, tenantId) {
  if (!tenantId) return null;
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true }
  });
  return t ? { id: t.id, name: t.name } : null;
}

/**
 * @param {object} opts
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {import('@prisma/client').WhatsAppConversation & { tenantId?: string | null }} opts.conversation
 * @param {string} opts.waId
 * @param {string} opts.text
 * @param {{ role: 'user' | 'assistant'; content: string }[]} opts.priorTurns
 * @param {boolean} [opts.isFirstInbound] Primer mensaje entrante en esta conversación (BD).
 * @param {import('pino').Logger} [opts.log]
 */
export async function resolveInboundReply({
  prisma,
  conversation,
  waId,
  text,
  priorTurns,
  isFirstInbound,
  log
}) {
  let conv = { ...conversation };

  if (!conv.tenantId) {
    const hit = await findTenantIdByWaId(prisma, waId);
    if (hit) {
      await prisma.whatsAppConversation.update({
        where: { id: conv.id },
        data: { tenantId: hit.tenantId }
      });
      conv.tenantId = hit.tenantId;
    }
  }

  const state = conv.state || WA_STATES.DEFAULT;

  if (state === WA_STATES.HUMAN_HANDOFF && detectMenuIntent(text)) {
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { state: WA_STATES.MENU, handoffAt: null }
    });
    return { text: getStaticMenuText(), newState: WA_STATES.MENU };
  }

  if (state === WA_STATES.HUMAN_HANDOFF) {
    return {
      text:
        `Tu consulta está en manos del equipo. Si quieres volver al menú automático, escribe *menú*.`,
      newState: WA_STATES.HUMAN_HANDOFF
    };
  }

  const next = nextStateFromInput(state, text);

  if (next === WA_STATES.HUMAN_HANDOFF) {
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { state: WA_STATES.HUMAN_HANDOFF, handoffAt: new Date() }
    });
    return { text: handoffAckText(), newState: WA_STATES.HUMAN_HANDOFF };
  }

  if (next === WA_STATES.MENU || detectMenuIntent(text)) {
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { state: WA_STATES.MENU }
    });
    return { text: getStaticMenuText(), newState: WA_STATES.MENU };
  }

  const menuPick = replyForMenuChoice(text, { state });
  if (menuPick) {
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { state: WA_STATES.DEFAULT }
    });
    return { text: menuPick, newState: WA_STATES.DEFAULT };
  }

  if (!conv.contactName) {
    const extracted = extractContactNameFromMessage(text, priorTurns);
    if (extracted) {
      await prisma.whatsAppConversation.update({
        where: { id: conv.id },
        data: { contactName: extracted }
      });
      conv.contactName = extracted;
    }
  }

  if (!conv.contactEmail) {
    const extractedEmail = extractContactEmailFromMessage(text);
    if (extractedEmail) {
      await prisma.whatsAppConversation.update({
        where: { id: conv.id },
        data: { contactEmail: extractedEmail }
      });
      conv.contactEmail = extractedEmail;
    }
  }

  const askNameFirst =
    process.env.WHATSAPP_ASK_NAME_FIRST === '0' || process.env.WHATSAPP_ASK_NAME_FIRST === 'false'
      ? false
      : true;
  if (askNameFirst && isFirstInbound && isBareGreeting(text) && !conv.contactName) {
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { state: WA_STATES.DEFAULT }
    });
    return {
      text:
        '¡Hola! Gracias por escribirnos. Somos el equipo de Ainspecciona. ¿Cómo te llamo?',
      newState: WA_STATES.DEFAULT
    };
  }

  if (openAiEnabled()) {
    const priorMessages = priorTurns.map((t) => ({
      role: t.role === 'assistant' ? 'assistant' : 'user',
      content: t.content
    }));
    const tenantHint = await loadTenantHint(prisma, conv.tenantId);
    const ai = await runOpenAiDialog({
      prisma,
      waId,
      userText: text,
      priorMessages,
      tenantHint,
      conversationHints: {
        contactName: conv.contactName ?? null,
        contactEmail: conv.contactEmail ?? null,
        advisoryOffered: !!conv.advisoryOffered
      },
      log
    });
    if (ai.ok && ai.text) {
      const data = { state: WA_STATES.DEFAULT };
      if (!conv.advisoryOffered && messageSuggestsAdvisoryOffer(ai.text)) {
        data.advisoryOffered = true;
      }
      await prisma.whatsAppConversation.update({
        where: { id: conv.id },
        data
      });
      return { text: ai.text, newState: WA_STATES.DEFAULT };
    }
    log?.warn({ err: ai.error }, 'whatsapp-openai-skip');
  }

  await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: { state: WA_STATES.DEFAULT }
  });
  return { text: fallbackReply(), newState: WA_STATES.DEFAULT };
}

export async function buildReplyText({ text }) {
  const preview = String(text || '').trim().slice(0, 280);
  if (!preview) {
    return 'Hola. ¿En qué podemos ayudarte? Escribe *menú* para ver opciones.';
  }
  return fallbackReply();
}
