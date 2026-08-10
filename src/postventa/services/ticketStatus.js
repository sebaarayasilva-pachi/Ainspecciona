import { publicBaseUrl } from '../normalize.js';
import { nextStepForOwner, statusLabel } from '../statusLabels.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} ticketIdParam
 * @param {{ tenantSlug?: string }} query
 */
export async function getTicketStatus(prisma, ticketIdParam, query = {}) {
  const ticketId = String(ticketIdParam || '').trim();
  const tenantSlug = query.tenantSlug ? String(query.tenantSlug).trim() : null;

  if (!ticketId) {
    return { ok: false, status: 400, error: 'MISSING_TICKET_ID', message: 'ticketId es obligatorio.' };
  }

  const where = {
    OR: [{ id: ticketId }, { shortId: ticketId }]
  };

  if (tenantSlug) {
    where.tenant = { slug: tenantSlug };
  }

  const ticket = await prisma.pvTicket.findFirst({
    where,
    include: {
      aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, severity: true, completedAt: true } },
      captureSessions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          slots: { select: { status: true } }
        }
      }
    }
  });

  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND', message: 'Ticket no encontrado.' };
  }

  const latestSession = ticket.captureSessions[0] || null;
  const base = publicBaseUrl();
  const captureUrl = latestSession ? `${base}/postventa/capture/${latestSession.token}` : null;

  let captureCompleted = false;
  if (latestSession?.slots?.length) {
    captureCompleted = latestSession.slots.every((s) =>
      ['uploaded', 'skipped', 'analyzed'].includes(String(s.status))
    );
  }

  return {
    ok: true,
    ticketId: ticket.id,
    ticketShortId: ticket.shortId,
    status: ticket.status,
    statusLabel: statusLabel(ticket.status),
    summary: ticket.summary,
    category: ticket.preliminaryCategory,
    captureUrl,
    captureCompleted,
    reportUrl: `${base}/postventa/report/${encodeURIComponent(ticket.shortId)}`,
    analysisStatus: ticket.aiAnalyses[0]?.status || null,
    analysisSeverity: ticket.aiAnalyses[0]?.severity || null,
    warrantyStatus: ticket.warrantyStatus,
    warrantyTier: ticket.warrantyTier,
    warrantyExpiresAt: ticket.warrantyExpiresAt?.toISOString?.()?.slice(0, 10) || null,
    nextStepForOwner: nextStepForOwner(ticket.status)
  };
}
