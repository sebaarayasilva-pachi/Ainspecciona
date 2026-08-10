/**
 * Orden de Trabajo (OT): asignar equipo libre + fecha acordada + generar PDF.
 */
import { generatePostventaOtPdf } from '../../pdf/postventaOtPdf.js';
import { statusLabel } from '../statusLabels.js';
import { categoryLabel } from '../analysis/categoryLabels.js';

const SCHEDULE_FROM = new Set(['recibido', 'asignada', 'classified', 'in_review']);

function latestAnalysis(ticket) {
  const list = ticket?.aiAnalyses || [];
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const ta = a.completedAt || a.createdAt || 0;
    const tb = b.completedAt || b.createdAt || 0;
    return new Date(tb) - new Date(ta);
  })[0];
}

function reportObj(analysis) {
  const r = analysis?.report;
  return r && typeof r === 'object' ? r : null;
}

function parseScheduledAt(raw) {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return { ok: false, error: 'SCHEDULED_AT_REQUIRED', message: 'Indica la fecha acordada con el cliente.' };
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) {
    return { ok: false, error: 'SCHEDULED_AT_INVALID', message: 'Fecha de programación inválida.' };
  }
  return { ok: true, date: d };
}

async function loadTicket(prisma, tenantId, shortId) {
  const ref = String(shortId || '').trim();
  return prisma.pvTicket.findFirst({
    where: {
      tenantId,
      OR: [{ shortId: ref }, { id: ref }]
    },
    include: {
      owner: { select: { fullName: true, email: true } },
      assignedTo: { select: { fullName: true, email: true } },
      tenant: { select: { name: true } },
      unit: {
        include: {
          project: { select: { name: true, slug: true, address: true, comuna: true } }
        }
      },
      captureSessions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          slots: { orderBy: { sortOrder: 'asc' } }
        }
      },
      aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 3 }
    }
  });
}

/**
 * Guarda equipo + fecha acordada; pasa a programado si corresponde.
 */
export async function saveWorkOrderTeam(prisma, tenantId, shortId, body, actor = {}) {
  const repairTeamName = String(body?.repairTeamName || '').trim().slice(0, 191);
  const repairTeamContact = String(body?.repairTeamContact || '').trim().slice(0, 191);

  if (!repairTeamName) {
    return {
      ok: false,
      status: 400,
      error: 'TEAM_REQUIRED',
      message: 'Indica el nombre del equipo de trabajo.'
    };
  }

  const sched = parseScheduledAt(body?.scheduledAt);
  if (!sched.ok) {
    return { ok: false, status: 400, error: sched.error, message: sched.message };
  }

  const ticket = await loadTicket(prisma, tenantId, shortId);
  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND' };
  }

  const now = new Date();
  const nextStatus = SCHEDULE_FROM.has(ticket.status) ? 'programado' : ticket.status;
  /** @type {Record<string, unknown>} */
  const data = {
    repairTeamName,
    repairTeamContact: repairTeamContact || null,
    otGeneratedAt: now,
    scheduledAt: sched.date
  };
  if (nextStatus !== ticket.status) {
    data.status = nextStatus;
  }

  await prisma.$transaction([
    prisma.pvTicket.update({
      where: { id: ticket.id },
      data
    }),
    prisma.pvTicketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: 'work_order_assigned',
        payload: {
          repairTeamName,
          repairTeamContact: repairTeamContact || null,
          scheduledAt: sched.date.toISOString(),
          fromStatus: ticket.status,
          toStatus: nextStatus,
          byUserId: actor.userId || null,
          inspectorName: ticket.assignedTo?.fullName || null,
          inspectorEmail: ticket.assignedTo?.email || null
        }
      }
    })
  ]);

  return {
    ok: true,
    shortId: ticket.shortId,
    repairTeamName,
    repairTeamContact: repairTeamContact || null,
    scheduledAt: sched.date.toISOString(),
    otGeneratedAt: now.toISOString(),
    status: nextStatus,
    statusLabel: statusLabel(nextStatus),
    assignedToName: ticket.assignedTo?.fullName || null,
    assignedToEmail: ticket.assignedTo?.email || null
  };
}

/**
 * Genera el PDF de OT (usa datos guardados; permite override en opts).
 */
export async function buildWorkOrderPdf(prisma, storage, tenantId, shortId, opts = {}) {
  const ticket = await loadTicket(prisma, tenantId, shortId);
  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND' };
  }

  const repairTeamName = String(opts.repairTeamName || ticket.repairTeamName || '')
    .trim()
    .slice(0, 191);
  const repairTeamContact = String(
    opts.repairTeamContact != null ? opts.repairTeamContact : ticket.repairTeamContact || ''
  )
    .trim()
    .slice(0, 191);

  if (!repairTeamName) {
    return {
      ok: false,
      status: 400,
      error: 'TEAM_REQUIRED',
      message: 'Asigna un equipo de trabajo antes de descargar la OT.'
    };
  }

  let scheduledAt = ticket.scheduledAt;
  if (opts.scheduledAt != null && String(opts.scheduledAt).trim()) {
    const sched = parseScheduledAt(opts.scheduledAt);
    if (!sched.ok) {
      return { ok: false, status: 400, error: sched.error, message: sched.message };
    }
    scheduledAt = sched.date;
  }

  if (!scheduledAt) {
    return {
      ok: false,
      status: 400,
      error: 'SCHEDULED_AT_REQUIRED',
      message: 'Indica la fecha acordada con el cliente antes de descargar la OT.'
    };
  }

  // Persistir overrides si hace falta
  if (
    repairTeamName !== (ticket.repairTeamName || '') ||
    repairTeamContact !== (ticket.repairTeamContact || '') ||
    !ticket.otGeneratedAt ||
    !ticket.scheduledAt ||
    new Date(ticket.scheduledAt).getTime() !== new Date(scheduledAt).getTime()
  ) {
    await prisma.pvTicket.update({
      where: { id: ticket.id },
      data: {
        repairTeamName,
        repairTeamContact: repairTeamContact || null,
        otGeneratedAt: ticket.otGeneratedAt || new Date(),
        scheduledAt
      }
    });
  }

  const analysis = latestAnalysis(ticket);
  const report = reportObj(analysis);
  const project = ticket.unit?.project;
  const unitLabel = ticket.unit
    ? [ticket.unit.tower ? `Torre ${ticket.unit.tower}` : null, `Depto ${ticket.unit.unitNumber}`]
        .filter(Boolean)
        .join(' · ')
    : null;
  const address = [project?.address, project?.comuna].filter(Boolean).join(', ');

  /** @type {Array<{ title?: string, buffer: Buffer }>} */
  const photos = [];
  const slots = ticket.captureSessions?.[0]?.slots || [];
  if (storage?.readBuffer) {
    for (const slot of slots) {
      if (!slot.photoPath || photos.length >= 4) continue;
      try {
        const buf = await storage.readBuffer(slot.photoPath);
        if (buf?.length) {
          photos.push({ title: slot.title || slot.slotCode, buffer: buf });
        }
      } catch (_) {
        /* skip broken photo */
      }
    }
  }

  const pdf = await generatePostventaOtPdf({
    shortId: ticket.shortId,
    tenantName: ticket.tenant?.name,
    projectName: project?.name,
    unitLabel,
    address,
    ownerName: ticket.owner?.fullName,
    ownerEmail: ticket.owner?.email,
    contactName: ticket.contactName || null,
    contactPhone: ticket.contactPhone || null,
    summary: ticket.summary,
    categoryLabel: categoryLabel(ticket.preliminaryCategory),
    analysisSummary: analysis?.summaryText || null,
    recommendedRouting: report?.recommended_routing || null,
    repairTeamName,
    repairTeamContact: repairTeamContact || null,
    inspectorName: ticket.assignedTo?.fullName || null,
    inspectorEmail: ticket.assignedTo?.email || null,
    scheduledAt,
    createdAt: ticket.createdAt,
    photos
  });

  return {
    ok: true,
    shortId: ticket.shortId,
    filename: `OT-${ticket.shortId}.pdf`,
    pdf,
    repairTeamName,
    repairTeamContact: repairTeamContact || null,
    scheduledAt: scheduledAt?.toISOString?.() || null,
    inspectorName: ticket.assignedTo?.fullName || null
  };
}
