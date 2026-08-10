import { categoryLabel, warrantyStatusLabel } from '../analysis/categoryLabels.js';
import { statusLabel } from '../statusLabels.js';
import { agingBucket, isTicketOpen, isUrgentTicket } from './portalDashboard.js';

const ALLOWED_STATUS_UPDATES = new Set([
  'classified',
  'recibido',
  'asignada',
  'programado',
  'en_ejecucion',
  'terminado',
  'in_review',
  'routed',
  'closed',
  'rejected'
]);

function photoProgress(slots = []) {
  const total = slots.length;
  const uploaded = slots.filter((s) =>
    ['uploaded', 'analyzed', 'skipped'].includes(String(s.status))
  ).length;
  const withPhoto = slots.filter((s) => s.photoPath).length;
  return { total, uploaded, withPhoto };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function getPostventaAdminStats(prisma) {
  const grouped = await prisma.pvTicket.groupBy({
    by: ['status'],
    _count: { _all: true }
  });
  const byStatus = {};
  let total = 0;
  for (const row of grouped) {
    byStatus[row.status] = row._count._all;
    total += row._count._all;
  }

  const openTickets = await prisma.pvTicket.findMany({
    where: {
      status: { notIn: ['closed', 'rejected', 'terminado'] }
    },
    select: {
      status: true,
      createdAt: true,
      aiAnalyses: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { severity: true, report: true }
      }
    }
  });

  let urgentOpen = 0;
  let agingOver30 = 0;
  for (const t of openTickets) {
    if (isUrgentTicket(t, t.aiAnalyses[0] || null)) urgentOpen += 1;
    if (isTicketOpen(t.status) && agingBucket(t.createdAt) === 'over30') agingOver30 += 1;
  }

  return {
    ok: true,
    total,
    byStatus,
    pendingEvidence: byStatus.pending_evidence || 0,
    pendingAi: byStatus.pending_ai_analysis || 0,
    classified: byStatus.classified || 0,
    inReview: byStatus.in_review || 0,
    recibido: byStatus.recibido || 0,
    programado: byStatus.programado || 0,
    enEjecucion: byStatus.en_ejecucion || 0,
    terminado: byStatus.terminado || 0,
    closed: (byStatus.closed || 0) + (byStatus.terminado || 0),
    urgentOpen,
    agingOver30
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ status?: string, tenantSlug?: string, search?: string, limit?: number }} query
 */
export async function listPostventaTicketsForAdmin(prisma, query = {}) {
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 100));
  const status = query.status ? String(query.status).trim() : '';
  const tenantSlug = query.tenantSlug ? String(query.tenantSlug).trim() : '';
  const search = query.search ? String(query.search).trim() : '';

  /** @type {import('@prisma/client').Prisma.PvTicketWhereInput} */
  const where = {};
  if (status) where.status = status;
  if (tenantSlug) where.tenant = { slug: tenantSlug };
  if (search) {
    where.OR = [
      { shortId: { contains: search } },
      { summary: { contains: search } },
      { roomHint: { contains: search } }
    ];
  }

  const tickets = await prisma.pvTicket.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      owner: { select: { fullName: true, email: true, phone: true } },
      unit: {
        include: {
          project: { select: { name: true, address: true, comuna: true } }
        }
      },
      aiAnalyses: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          severity: true,
          summaryText: true,
          completedAt: true
        }
      },
      captureSessions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { slots: { select: { status: true, photoPath: true } } }
      }
    }
  });

  return {
    ok: true,
    count: tickets.length,
    tickets: tickets.map((t) => {
      const session = t.captureSessions[0];
      const progress = photoProgress(session?.slots || []);
      const analysis = t.aiAnalyses[0] || null;
      return {
        id: t.id,
        shortId: t.shortId,
        status: t.status,
        statusLabel: statusLabel(t.status),
        summary: t.summary,
        category: t.preliminaryCategory,
        categoryLabel: categoryLabel(t.preliminaryCategory),
        roomHint: t.roomHint,
        warrantyStatus: t.warrantyStatus,
        warrantyStatusLabel: warrantyStatusLabel(t.warrantyStatus),
        createdAt: t.createdAt.toISOString(),
        tenantName: t.tenant?.name,
        tenantSlug: t.tenant?.slug,
        ownerName: t.owner?.fullName,
        ownerEmail: t.owner?.email,
        unitLabel: t.unit
          ? [
              t.unit.project?.name,
              t.unit.project?.comuna,
              t.unit.tower ? `Torre ${t.unit.tower}` : null,
              `Depto ${t.unit.unitNumber}`
            ]
              .filter(Boolean)
              .join(' · ')
          : null,
        photos: progress,
        analysisStatus: analysis?.status || null,
        analysisSeverity: analysis?.severity || null,
        analysisSummary: analysis?.summaryText || null,
        reportUrl: `/postventa/report/${encodeURIComponent(t.shortId)}`
      };
    })
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} ticketRef
 */
export async function getPostventaTicketForAdmin(prisma, ticketRef) {
  const { getPostventaTicketReport } = await import('./ticketReport.js');
  const report = await getPostventaTicketReport(prisma, ticketRef);
  if (!report.ok) return report;

  const events = await prisma.pvTicketEvent.findMany({
    where: { ticketId: report.ticket.id },
    orderBy: { createdAt: 'desc' },
    take: 30
  });

  return {
    ...report,
    events: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: e.createdAt.toISOString()
    }))
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} ticketRef
 * @param {{ status: string, note?: string }} body
 */
export async function updatePostventaTicketStatus(prisma, ticketRef, body) {
  const nextStatus = String(body?.status || '').trim();
  if (!ALLOWED_STATUS_UPDATES.has(nextStatus)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_STATUS',
      message: `Estado no permitido: ${nextStatus}`
    };
  }

  const ticket = await prisma.pvTicket.findFirst({
    where: { OR: [{ id: ticketRef }, { shortId: ticketRef }] }
  });
  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND' };
  }

  await prisma.$transaction([
    prisma.pvTicket.update({
      where: { id: ticket.id },
      data: { status: nextStatus }
    }),
    prisma.pvTicketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: 'admin_status_update',
        payload: {
          from: ticket.status,
          to: nextStatus,
          note: body?.note ? String(body.note).slice(0, 500) : null
        }
      }
    })
  ]);

  return {
    ok: true,
    ticketId: ticket.id,
    shortId: ticket.shortId,
    status: nextStatus,
    statusLabel: statusLabel(nextStatus)
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function listPostventaTenantsForAdmin(prisma) {
  const tenants = await prisma.pvTenant.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true, _count: { select: { tickets: true } } }
  });
  return {
    ok: true,
    tenants: tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      ticketCount: t._count.tickets
    }))
  };
}
