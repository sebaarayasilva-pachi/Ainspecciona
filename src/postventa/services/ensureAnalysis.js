/**
 * Encola análisis IA si la captura terminó pero el ticket quedó sin informe
 * (p. ej. evidence_received / pending_evidence sin "finish").
 */

function captureIsComplete(slots = []) {
  if (!slots.length) return false;
  const pending = slots.filter((s) => String(s.status) === 'pending').length;
  const rejected = slots.filter((s) => String(s.status) === 'rejected').length;
  return pending === 0 && rejected === 0;
}

function hasUploadedPhotos(slots = []) {
  return slots.some((s) =>
    s.photoPath && ['uploaded', 'analyzed', 'skipped'].includes(String(s.status))
  );
}

const STALE_RUNNING_MS = 5 * 60 * 1000;

/** Estados desde los que se puede recuperar captura completa → análisis. */
const RECOVERABLE_STATUSES = new Set([
  'pending_evidence',
  'evidence_received',
  'pending_ai_analysis'
]);

const POST_ANALYSIS_STATUSES = new Set([
  'classified',
  'recibido',
  'asignada',
  'programado',
  'en_ejecucion',
  'terminado',
  'routed',
  'in_review',
  'closed',
  'rejected'
]);

/**
 * Marca el ticket como listo para IA y encola análisis (idempotente).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ id: string, shortId?: string, status: string }} ticket
 * @param {{ captureSessionId?: string, token?: string, slotsDone?: number, source?: string }} [meta]
 * @param {(args: { ticketId: string }) => void} [queueFn]
 */
export async function finalizeTicketCapture(prisma, ticket, meta = {}, queueFn) {
  if (!ticket?.id) return { ok: false, reason: 'no_ticket' };

  if (POST_ANALYSIS_STATUSES.has(ticket.status)) {
    return { ok: true, skipped: true, status: ticket.status };
  }

  if (ticket.status !== 'pending_ai_analysis') {
    await prisma.pvTicket.update({
      where: { id: ticket.id },
      data: { status: 'pending_ai_analysis' }
    });
    await prisma.pvTicketEvent
      .create({
        data: {
          ticketId: ticket.id,
          eventType: 'capture_completed',
          payload: {
            captureSessionId: meta.captureSessionId || null,
            token: meta.token || null,
            slotsDone: meta.slotsDone ?? null,
            source: meta.source || 'finalize',
            fromStatus: ticket.status
          }
        }
      })
      .catch(() => {});
  }

  if (typeof queueFn === 'function') {
    queueFn({ ticketId: ticket.id });
  }

  return {
    ok: true,
    ticketId: ticket.id,
    shortId: ticket.shortId,
    status: 'pending_ai_analysis'
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} ticketId
 * @param {(args: { ticketId: string }) => void} [queueFn]
 */
export async function ensurePostventaAnalysisQueued(prisma, ticketId, queueFn) {
  const ticket = await prisma.pvTicket.findUnique({
    where: { id: ticketId },
    include: {
      aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1 },
      captureSessions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { slots: true }
      }
    }
  });

  if (!ticket) return { queued: false, reason: 'not_found' };

  const session = ticket.captureSessions[0];
  if (!session || !captureIsComplete(session.slots) || !hasUploadedPhotos(session.slots)) {
    return { queued: false, reason: 'capture_incomplete' };
  }

  const latest = ticket.aiAnalyses[0] || null;
  if (latest?.status === 'completed') {
    // Análisis listo pero ticket quedó en "pendiente de fotos"
    if (ticket.status === 'pending_evidence' || ticket.status === 'evidence_received') {
      await prisma.pvTicket.update({
        where: { id: ticket.id },
        data: { status: 'classified' }
      });
      try {
        const { autoAssignTicketAfterClassified } = await import('./assignTicket.js');
        await autoAssignTicketAfterClassified(prisma, ticket.id);
      } catch (_) {
        /* best-effort */
      }
      return { queued: false, reason: 'already_done_status_fixed', status: 'classified' };
    }
    return { queued: false, reason: 'already_done' };
  }

  if (latest?.status === 'running') {
    const age = Date.now() - new Date(latest.createdAt).getTime();
    if (age < STALE_RUNNING_MS) {
      return { queued: false, reason: 'running' };
    }
  }

  const canRecover =
    RECOVERABLE_STATUSES.has(ticket.status) ||
    latest?.status === 'failed' ||
    (latest?.status === 'running' &&
      Date.now() - new Date(latest.createdAt).getTime() >= STALE_RUNNING_MS);

  if (!canRecover) {
    return { queued: false, reason: 'status_not_recoverable', status: ticket.status };
  }

  await finalizeTicketCapture(
    prisma,
    ticket,
    {
      captureSessionId: session.id,
      slotsDone: session.slots.filter((s) =>
        ['uploaded', 'analyzed', 'skipped'].includes(String(s.status))
      ).length,
      source: 'ensure_recovery'
    },
    queueFn
  );

  return { queued: true, ticketId: ticket.id, shortId: ticket.shortId };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} ticketRef
 * @param {(args: { ticketId: string }) => void} [queueFn]
 */
export async function ensurePostventaAnalysisByRef(prisma, ticketRef, queueFn) {
  const ref = String(ticketRef || '').trim();
  const ticket = await prisma.pvTicket.findFirst({
    where: { OR: [{ id: ref }, { shortId: ref }] },
    select: { id: true }
  });
  if (!ticket) return { queued: false, reason: 'not_found' };
  return ensurePostventaAnalysisQueued(prisma, ticket.id, queueFn);
}
