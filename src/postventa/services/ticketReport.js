import { categoryLabel, warrantyStatusLabel } from '../analysis/categoryLabels.js';
import { statusLabel } from '../statusLabels.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} ticketRef shortId or uuid
 */
export async function getPostventaTicketReport(prisma, ticketRef) {
  const ref = String(ticketRef || '').trim();
  if (!ref) {
    return { ok: false, status: 400, error: 'MISSING_TICKET', message: 'Identificador de ticket requerido.' };
  }

  const ticket = await prisma.pvTicket.findFirst({
    where: { OR: [{ id: ref }, { shortId: ref }] },
    include: {
      tenant: { select: { name: true, slug: true } },
      owner: { select: { fullName: true, email: true } },
      unit: {
        include: {
          project: { select: { name: true, address: true, comuna: true } }
        }
      },
      aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1 },
      captureSessions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { slots: { orderBy: { sortOrder: 'asc' } } }
      }
    }
  });

  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND', message: 'Solicitud no encontrada.' };
  }

  const analysis = ticket.aiAnalyses[0] || null;
  const session = ticket.captureSessions[0] || null;

  return {
    ok: true,
    ticket: {
      id: ticket.id,
      shortId: ticket.shortId,
      status: ticket.status,
      statusLabel: statusLabel(ticket.status),
      summary: ticket.summary,
      category: ticket.preliminaryCategory,
      categoryLabel: categoryLabel(ticket.preliminaryCategory),
      roomHint: ticket.roomHint,
      warrantyStatus: ticket.warrantyStatus,
      warrantyStatusLabel: warrantyStatusLabel(ticket.warrantyStatus),
      warrantyTier: ticket.warrantyTier,
      warrantyExpiresAt: ticket.warrantyExpiresAt?.toISOString?.()?.slice(0, 10) || null,
      createdAt: ticket.createdAt.toISOString(),
      tenantName: ticket.tenant?.name,
      ownerName: ticket.owner?.fullName,
      unit: ticket.unit
        ? {
            tower: ticket.unit.tower,
            unitNumber: ticket.unit.unitNumber,
            projectName: ticket.unit.project?.name,
            address: ticket.unit.project?.address,
            comuna: ticket.unit.project?.comuna
          }
        : null
    },
    capture: session
      ? {
          category: session.category,
          slots: session.slots.map((s) => ({
            slotCode: s.slotCode,
            title: s.title,
            status: s.status
          }))
        }
      : null,
    analysis: analysis
      ? {
          id: analysis.id,
          status: analysis.status,
          model: analysis.model,
          severity: analysis.severity,
          summaryText: analysis.summaryText,
          confidence: analysis.confidence,
          report: analysis.report,
          errorMessage: analysis.errorMessage,
          createdAt: analysis.createdAt.toISOString(),
          completedAt: analysis.completedAt?.toISOString() || null
        }
      : null
  };
}
