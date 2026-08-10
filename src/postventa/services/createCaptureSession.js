import { buildSanitaryCapturePlan } from '../capture/sanitaryCatalog.js';
import {
  buildSingleCaptureGuide,
  buildSingleCaptureSlot
} from '../capture/singleCaptureSlot.js';
import { VALID_CATEGORIES } from '../capture/slotTemplates.js';
import { generateCaptureToken } from '../ids.js';
import { publicWebAppUrl } from '../normalize.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function createCaptureSession(prisma, body) {
  const ticketId = String(body.ticketId || '').trim();
  const expiresInHours = Number(body.expiresInHours || 72);

  if (!ticketId) {
    return {
      ok: false,
      status: 400,
      error: 'MISSING_FIELDS',
      message: 'ticketId es obligatorio.'
    };
  }

  const ticket = await prisma.pvTicket.findFirst({
    where: {
      OR: [{ id: ticketId }, { shortId: ticketId }]
    }
  });

  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND', message: 'Ticket no encontrado.' };
  }

  // La categoría del ticket manda — evita mezclar plantillas (p. ej. humedad vs pintura).
  const ticketCategory = String(ticket.preliminaryCategory || '').trim();
  const requestedCategory = String(body.category || '').trim();
  const category = ticketCategory || requestedCategory;
  const categoryCorrected = Boolean(
    requestedCategory && ticketCategory && requestedCategory !== ticketCategory
  );

  if (!category) {
    return {
      ok: false,
      status: 400,
      error: 'MISSING_CATEGORY',
      message: 'El ticket no tiene preliminaryCategory.'
    };
  }

  if (requestedCategory && ticketCategory && requestedCategory !== ticketCategory) {
    // Ignoramos categoría distinta en el body (suele ser alucinación o contexto viejo).
  }

  if (!VALID_CATEGORIES.has(category)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_CATEGORY',
      message: `Categoría no válida: ${category}`
    };
  }

  const hours = Number.isFinite(expiresInHours) && expiresInHours > 0 ? expiresInHours : 72;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const token = generateCaptureToken();
  let sanitaryPlan = null;
  const slotContext = {
    summary: ticket.summary || '',
    roomHint: ticket.roomHint || '',
    category
  };
  if (category === 'sanitarios') {
    sanitaryPlan = buildSanitaryCapturePlan(ticket.summary, ticket.roomHint);
  }
  const singleSlot = buildSingleCaptureSlot(slotContext);
  const slotDefs = [singleSlot];

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.pvCaptureSession.create({
      data: {
        ticketId: ticket.id,
        token,
        category,
        expiresAt
      }
    });

    await tx.pvCaptureSlot.createMany({
      data: slotDefs.map((slot, index) => ({
        captureSessionId: created.id,
        slotCode: slot.slotCode,
        title: slot.title,
        instructions: slot.instructions || null,
        sortOrder: index
      }))
    });

    await tx.pvTicket.update({
      where: { id: ticket.id },
      data: { status: 'pending_evidence' }
    });

    await tx.pvTicketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: 'capture_session_created',
        payload: {
          captureSessionId: created.id,
          token,
          category,
          requestedCategory: requestedCategory || null,
          categoryCorrected,
          expiresAt: expiresAt.toISOString(),
          sanitaryFinding: sanitaryPlan
            ? {
                code: sanitaryPlan.findingCode,
                label: sanitaryPlan.findingLabel,
                urgency: sanitaryPlan.urgency
              }
            : null
        }
      }
    });

    return created;
  });

  const base = publicWebAppUrl();
  const captureUrl = `${base}/postventa/capture/${session.token}`;
  const captureGuide = buildSingleCaptureGuide(slotContext).map((g) => ({
    step: g.step,
    title: g.title,
    instructions: g.instructions,
    spoken: g.spoken.replace(/\*\*/g, ''),
    captureLabel: g.captureLabel
  }));

  return {
    ok: true,
    captureSessionId: session.id,
    token: session.token,
    captureUrl,
    captureGuide,
    expiresAt: session.expiresAt.toISOString(),
    slotsCount: slotDefs.length,
    category,
    categoryUsed: category,
    categoryCorrected,
    sanitaryFinding: sanitaryPlan
      ? {
          code: sanitaryPlan.findingCode,
          label: sanitaryPlan.findingLabel,
          urgency: sanitaryPlan.urgency
        }
      : null,
    ticketStatus: 'pending_evidence'
  };
}
