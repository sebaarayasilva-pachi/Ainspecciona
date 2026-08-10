import { categoryLabel, warrantyStatusLabel } from '../analysis/categoryLabels.js';
import { statusLabel } from '../statusLabels.js';

const TERMINAL = new Set(['closed', 'rejected', 'terminado']);
const RESOLVED = new Set(['closed', 'terminado']);
const WARRANTY_RISK = new Set(['garantia_vencida', 'requiere_revision_manual']);
const URGENT_SEV = new Set(['high', 'critical']);
/** Estados que el portal puede setear (pipeline + salidas). */
const PORTAL_OPS_PIPELINE = [
  'recibido',
  'asignada',
  'programado',
  'en_ejecucion',
  'terminado'
];
const PORTAL_EXIT_STATUSES = ['routed', 'rejected'];
const PORTAL_MENU_STATUSES = [...PORTAL_OPS_PIPELINE, ...PORTAL_EXIT_STATUSES];

/** PATCH portal: solo menú canónico. Legado (classified/closed/in_review) no se ofrece. */
const ALLOWED_STATUS_UPDATES = new Set(PORTAL_MENU_STATUSES);

const PIPELINE_STATUSES = [
  'draft',
  'pending_evidence',
  'evidence_received',
  'pending_ai_analysis',
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
];

function photoProgress(slots = []) {
  const total = slots.length;
  const withPhoto = slots.filter((s) => s.photoPath).length;
  const uploaded = slots.filter((s) =>
    ['uploaded', 'analyzed', 'skipped'].includes(String(s.status))
  ).length;
  return { total, uploaded, withPhoto };
}

export function isTicketOpen(status) {
  return !TERMINAL.has(String(status || ''));
}

function latestAnalysis(ticket) {
  return (ticket.aiAnalyses && ticket.aiAnalyses[0]) || null;
}

function reportObj(analysis) {
  const r = analysis?.report;
  if (!r || typeof r !== 'object') return null;
  return r;
}

export function isUrgentTicket(ticket, analysis = null) {
  if (!isTicketOpen(ticket.status)) return false;
  const a = analysis || latestAnalysis(ticket);
  if (a && URGENT_SEV.has(String(a.severity || '').toLowerCase())) return true;
  const report = reportObj(a);
  return Boolean(report && report.urgency_flag === true);
}

function ageDays(createdAt) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
}

export function agingBucket(createdAt) {
  const d = ageDays(createdAt);
  if (d < 7) return 'under7';
  if (d <= 30) return 'd7to30';
  return 'over30';
}

function emptyAging() {
  return { under7: 0, d7to30: 0, over30: 0 };
}

function resolutionPct(total, resolved, rejected) {
  const denom = Math.max(1, total - rejected);
  return Math.round((resolved / denom) * 100);
}

function computeMetrics(tickets) {
  const byStatus = {};
  for (const s of PIPELINE_STATUSES) byStatus[s] = 0;

  let open = 0;
  let closed = 0;
  let rejected = 0;
  let classified = 0;
  let urgentOpen = 0;
  let warrantyRisk = 0;
  let openAgeSum = 0;
  const aging = emptyAging();
  const byCategory = {};
  const bySeverity = {};
  const byWarranty = {};
  const byVerdict = {};

  for (const t of tickets) {
    const st = String(t.status || 'draft');
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (RESOLVED.has(st)) closed += 1;
    else if (st === 'rejected') rejected += 1;
    else open += 1;
    if (st === 'classified') classified += 1;

    const analysis = latestAnalysis(t);
    if (isUrgentTicket(t, analysis)) urgentOpen += 1;
    if (isTicketOpen(st) && WARRANTY_RISK.has(String(t.warrantyStatus || ''))) {
      warrantyRisk += 1;
    }
    if (isTicketOpen(st)) {
      openAgeSum += ageDays(t.createdAt);
      aging[agingBucket(t.createdAt)] += 1;
    }

    const cat = t.preliminaryCategory || 'otros';
    byCategory[cat] = (byCategory[cat] || 0) + 1;

    if (analysis?.severity) {
      const sev = String(analysis.severity).toLowerCase();
      bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    }
    if (t.warrantyStatus) {
      byWarranty[t.warrantyStatus] = (byWarranty[t.warrantyStatus] || 0) + 1;
    }
    const report = reportObj(analysis);
    const verdict = report?.claim_assessment?.verdict;
    if (verdict) byVerdict[verdict] = (byVerdict[verdict] || 0) + 1;
  }

  const total = tickets.length;
  return {
    total,
    open,
    closed,
    rejected,
    classified,
    urgentOpen,
    warrantyRisk,
    resolutionPct: resolutionPct(total, closed, rejected),
    avgOpenDays: open ? Math.round((openAgeSum / open) * 10) / 10 : 0,
    byStatus,
    aging,
    byCategory,
    bySeverity,
    byWarranty,
    byVerdict
  };
}

function timeline14(tickets) {
  const days = [];
  const now = new Date();
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, opened: 0, closed: 0 });
  }
  const index = Object.fromEntries(days.map((d, i) => [d.date, i]));
  for (const t of tickets) {
    const opened = new Date(t.createdAt).toISOString().slice(0, 10);
    if (index[opened] != null) days[index[opened]].opened += 1;
    if (RESOLVED.has(t.status) && t.updatedAt) {
      const closedAt = new Date(t.updatedAt).toISOString().slice(0, 10);
      if (index[closedAt] != null) days[index[closedAt]].closed += 1;
    }
  }
  return days;
}

function ticketInclude() {
  return {
    unit: {
      include: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            comuna: true,
            address: true,
            defaultInspectorId: true
          }
        }
      }
    },
    owner: { select: { fullName: true, email: true, phone: true } },
    assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
    aiAnalyses: {
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: {
        id: true,
        status: true,
        severity: true,
        summaryText: true,
        report: true,
        confidence: true,
        completedAt: true,
        createdAt: true
      }
    },
    captureSessions: {
      orderBy: { createdAt: 'desc' },
      take: 1,
      include: {
        slots: {
          orderBy: { sortOrder: 'asc' },
          select: {
            status: true,
            photoPath: true,
            title: true,
            slotCode: true,
            mimeType: true,
            sortOrder: true
          }
        }
      }
    }
  };
}

function serializeTicketRow(t) {
  const analysis = latestAnalysis(t);
  const report = reportObj(analysis);
  const session = t.captureSessions?.[0];
  const project = t.unit?.project;
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
    updatedAt: t.updatedAt.toISOString(),
    ageDays: Math.round(ageDays(t.createdAt) * 10) / 10,
    agingBucket: agingBucket(t.createdAt),
    urgent: isUrgentTicket(t, analysis),
    ownerName: t.owner?.fullName || null,
    ownerEmail: t.owner?.email || null,
    unitLabel: t.unit
      ? [t.unit.tower ? `Torre ${t.unit.tower}` : null, `Depto ${t.unit.unitNumber}`]
          .filter(Boolean)
          .join(' · ')
      : null,
    projectSlug: project?.slug || null,
    projectName: project?.name || null,
    assignedToUserId: t.assignedToUserId || t.assignedTo?.id || null,
    assignedToName: t.assignedTo?.fullName || null,
    assignedAt: t.assignedAt?.toISOString?.() || null,
    scheduledAt: t.scheduledAt?.toISOString?.() || null,
    closedAt: t.closedAt?.toISOString?.() || null,
    closeNote: t.closeNote || null,
    closePhotoPath: t.closePhotoPath || null,
    closePhotoUrl: t.closePhotoPath
      ? `/api/postventa/portal/tickets/${encodeURIComponent(t.shortId)}/close-photo`
      : null,
    repairTeamName: t.repairTeamName || null,
    repairTeamContact: t.repairTeamContact || null,
    otGeneratedAt: t.otGeneratedAt?.toISOString?.() || null,
    contactName: t.contactName || null,
    contactPhone: t.contactPhone || null,
    photos: photoProgress(session?.slots || []),
    analysisStatus: analysis?.status || null,
    analysisSeverity: analysis?.severity || null,
    analysisSummary: analysis?.summaryText || null,
    urgencyFlag: Boolean(report?.urgency_flag),
    verdict: report?.claim_assessment?.verdict || null
  };
}

const OPS_PIPELINE = ['recibido', 'asignada', 'programado', 'en_ejecucion', 'terminado'];

function agingByOpsStages(tickets) {
  const rows = Object.fromEntries(
    OPS_PIPELINE.map((s) => [s, { ...emptyAging(), total: 0 }])
  );
  for (const t of tickets || []) {
    const st = String(t.status || '');
    if (!rows[st]) continue;
    const bucket = agingBucket(t.createdAt);
    rows[st][bucket] += 1;
    rows[st].total += 1;
  }
  return OPS_PIPELINE.map((s) => ({
    key: s,
    label: statusLabel(s),
    under7: rows[s].under7,
    d7to30: rows[s].d7to30,
    over30: rows[s].over30,
    total: rows[s].total
  }));
}

const INTAKE_PIPELINE = [
  'draft',
  'pending_evidence',
  'evidence_received',
  'pending_ai_analysis',
  'classified',
  'in_review',
  'routed',
  'rejected'
];

function chartsFromMetrics(metrics, tickets) {
  const agingByOps = agingByOpsStages(tickets);
  return {
    byStatus: PIPELINE_STATUSES.map((s) => ({
      key: s,
      label: statusLabel(s),
      count: metrics.byStatus[s] || 0
    })),
    /** Donut Ingreso/captura — conteos reales por estado de intake. */
    intake: INTAKE_PIPELINE.map((s) => ({
      key: s,
      label: statusLabel(s),
      count: metrics.byStatus[s] || 0
    })).filter((row) => row.count > 0),
    /** Siempre incluye los 4 estados operativos (aunque vayan en 0). */
    opsPipeline: OPS_PIPELINE.map((s) => ({
      key: s,
      label: statusLabel(s),
      count: metrics.byStatus[s] || 0
    })),
    byCategory: Object.entries(metrics.byCategory)
      .map(([key, count]) => ({ key, label: categoryLabel(key), count }))
      .sort((a, b) => b.count - a.count),
    aging: [
      { key: 'under7', label: '< 7 días', count: metrics.aging.under7 },
      { key: 'd7to30', label: '7–30 días', count: metrics.aging.d7to30 },
      { key: 'over30', label: '> 30 días', count: metrics.aging.over30 }
    ],
    /** Aging del backlog agrupado por etapa operativa. */
    agingByOps,
    timeline: timeline14(tickets),
    bySeverity: Object.entries(metrics.bySeverity).map(([key, count]) => ({ key, count })),
    byWarranty: Object.entries(metrics.byWarranty).map(([key, count]) => ({
      key,
      label: warrantyStatusLabel(key),
      count
    })),
    byVerdict: Object.entries(metrics.byVerdict).map(([key, count]) => ({ key, count }))
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} tenantId
 */
export async function getPortalOverview(prisma, tenantId) {
  const [projects, tickets] = await Promise.all([
    prisma.pvProject.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, address: true, comuna: true, createdAt: true }
    }),
    prisma.pvTicket.findMany({
      where: { tenantId },
      include: ticketInclude()
    })
  ]);

  const portfolio = computeMetrics(tickets);
  const byProjectId = new Map();
  for (const p of projects) byProjectId.set(p.id, []);

  for (const t of tickets) {
    const pid = t.projectId || t.unit?.project?.id || null;
    if (pid && byProjectId.has(pid)) byProjectId.get(pid).push(t);
  }

  const projectCards = projects.map((p) => {
    const list = byProjectId.get(p.id) || [];
    const m = computeMetrics(list);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      address: p.address,
      comuna: p.comuna,
      metrics: {
        total: m.total,
        open: m.open,
        resolutionPct: m.resolutionPct,
        urgentOpen: m.urgentOpen,
        classified: m.classified,
        warrantyRisk: m.warrantyRisk,
        aging: m.aging
      }
    };
  });

  const charts = chartsFromMetrics(portfolio, tickets);
  const byProject = projectCards
    .map((p) => ({
      key: p.slug,
      label: p.name,
      open: p.metrics.open,
      total: p.metrics.total,
      resolutionPct: p.metrics.resolutionPct,
      urgentOpen: p.metrics.urgentOpen
    }))
    .filter((p) => p.total > 0)
    .sort((a, b) => b.open - a.open || b.total - a.total);

  return {
    ok: true,
    kpis: {
      projects: projects.length,
      open: portfolio.open,
      resolutionPct: portfolio.resolutionPct,
      urgentOpen: portfolio.urgentOpen,
      classified: portfolio.classified,
      warrantyRisk: portfolio.warrantyRisk,
      total: portfolio.total,
      closed: portfolio.closed,
      avgOpenDays: portfolio.avgOpenDays,
      aging: portfolio.aging
    },
    charts: {
      ...charts,
      byProject
    },
    projects: projectCards
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} tenantId
 * @param {string} projectSlug
 */
export async function getPortalProject(prisma, tenantId, projectSlug) {
  const slug = String(projectSlug || '').trim();
  const project = await prisma.pvProject.findFirst({
    where: { tenantId, slug },
    include: {
      defaultInspector: {
        select: { id: true, fullName: true, email: true, role: true, status: true }
      }
    }
  });
  if (!project) {
    return { ok: false, status: 404, error: 'PROJECT_NOT_FOUND' };
  }

  const tickets = await prisma.pvTicket.findMany({
    where: {
      tenantId,
      OR: [{ projectId: project.id }, { unit: { projectId: project.id } }]
    },
    orderBy: { createdAt: 'desc' },
    include: ticketInclude()
  });

  const metrics = computeMetrics(tickets);
  const insp = project.defaultInspector;
  return {
    ok: true,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      address: project.address,
      comuna: project.comuna,
      defaultInspectorId: project.defaultInspectorId || null,
      defaultInspector:
        insp && insp.status === 'ACTIVE'
          ? {
              id: insp.id,
              fullName: insp.fullName,
              email: insp.email,
              role: insp.role
            }
          : null
    },
    kpis: {
      total: metrics.total,
      open: metrics.open,
      closed: metrics.closed,
      resolutionPct: metrics.resolutionPct,
      avgOpenDays: metrics.avgOpenDays,
      urgentOpen: metrics.urgentOpen,
      classified: metrics.classified,
      warrantyRisk: metrics.warrantyRisk,
      aging: metrics.aging,
      byStatus: metrics.byStatus
    },
    charts: chartsFromMetrics(metrics, tickets),
    tickets: tickets.map(serializeTicketRow)
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} tenantId
 * @param {string} shortId
 */
export async function getPortalTicket(prisma, tenantId, shortId) {
  const ref = String(shortId || '').trim();
  const ticket = await prisma.pvTicket.findFirst({
    where: {
      tenantId,
      OR: [{ shortId: ref }, { id: ref }]
    },
    include: {
      ...ticketInclude(),
      tenant: { select: { name: true, slug: true } }
    }
  });
  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND' };
  }

  const analysis = latestAnalysis(ticket);
  const report = reportObj(analysis);
  const session = ticket.captureSessions?.[0];
  const row = serializeTicketRow(ticket);

  return {
    ok: true,
    ticket: {
      ...row,
      warrantyTier: ticket.warrantyTier,
      warrantyExpiresAt: ticket.warrantyExpiresAt?.toISOString?.()?.slice(0, 10) || null,
      tenantName: ticket.tenant?.name,
      unit: ticket.unit
        ? {
            tower: ticket.unit.tower,
            unitNumber: ticket.unit.unitNumber,
            projectName: ticket.unit.project?.name,
            projectSlug: ticket.unit.project?.slug,
            address: ticket.unit.project?.address,
            comuna: ticket.unit.project?.comuna
          }
        : null,
      photosDetail: (session?.slots || []).map((s) => {
        const hasPhoto = Boolean(s.photoPath);
        return {
          slotCode: s.slotCode,
          title: s.title,
          status: s.status,
          hasPhoto,
          mimeType: s.mimeType || null,
          photoUrl: hasPhoto
            ? `/api/postventa/portal/tickets/${encodeURIComponent(ticket.shortId)}/slots/${encodeURIComponent(s.slotCode)}/photo`
            : null
        };
      }),
      analysis: analysis
        ? {
            status: analysis.status,
            severity: analysis.severity,
            summaryText: analysis.summaryText,
            confidence: analysis.confidence,
            completedAt: analysis.completedAt?.toISOString?.() || null,
            urgencyFlag: Boolean(report?.urgency_flag),
            verdict: report?.claim_assessment?.verdict || null,
            probableCause: report?.claim_assessment?.probable_cause || null,
            confirmedCategory: report?.category_assessment?.confirmed_category || null,
            recommendedRouting: report?.recommended_routing || null
          }
        : null,
      reportUrl: `/postventa/report/${encodeURIComponent(ticket.shortId)}`
    },
    allowedStatuses: PORTAL_MENU_STATUSES,
    opsPipeline: PORTAL_OPS_PIPELINE,
    exitStatuses: PORTAL_EXIT_STATUSES
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} tenantId
 * @param {string} shortId
 * @param {{ status: string, note?: string, scheduledAt?: string|null }} body
 */
export async function updatePortalTicketStatus(prisma, tenantId, shortId, body) {
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
    where: {
      tenantId,
      OR: [{ shortId: String(shortId || '').trim() }, { id: String(shortId || '').trim() }]
    }
  });
  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND' };
  }

  /** @type {{ status: string, scheduledAt?: Date|null }} */
  const data = { status: nextStatus };
  let scheduledAtIso = null;

  if (nextStatus === 'programado') {
    const raw = body?.scheduledAt != null ? String(body.scheduledAt).trim() : '';
    if (!raw) {
      return {
        ok: false,
        status: 400,
        error: 'SCHEDULED_AT_REQUIRED',
        message: 'Indica la fecha/hora de la visita para programar.'
      };
    }
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) {
      return {
        ok: false,
        status: 400,
        error: 'SCHEDULED_AT_INVALID',
        message: 'Fecha de programación inválida.'
      };
    }
    data.scheduledAt = d;
    scheduledAtIso = d.toISOString();
  }

  await prisma.$transaction([
    prisma.pvTicket.update({
      where: { id: ticket.id },
      data
    }),
    prisma.pvTicketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: 'portal_status_update',
        payload: {
          from: ticket.status,
          to: nextStatus,
          note: body?.note ? String(body.note).slice(0, 500) : null,
          scheduledAt: scheduledAtIso
        }
      }
    })
  ]);

  return {
    ok: true,
    ticketId: ticket.id,
    shortId: ticket.shortId,
    status: nextStatus,
    statusLabel: statusLabel(nextStatus),
    scheduledAt: scheduledAtIso
  };
}

/**
 * Cola del inspector: tickets asignados al usuario actual.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} tenantId
 * @param {string} userId
 */
export async function getMyAssignedTickets(prisma, tenantId, userId, opts = {}) {
  if (!userId) {
    return { ok: false, status: 400, error: 'USER_REQUIRED' };
  }
  const role = String(opts.role || '').toUpperCase();
  // Admin/ejecutivo: cola operativa del tenant (no solo lo asignado a su usuario).
  // Inspector: solo tickets asignados a él.
  const where =
    role === 'ADMIN' || role === 'EXECUTIVE'
      ? {
          tenantId,
          status: { notIn: ['draft', 'pending_evidence'] }
        }
      : {
          tenantId,
          assignedToUserId: userId,
          status: { notIn: ['draft', 'pending_evidence'] }
        };

  const tickets = await prisma.pvTicket.findMany({
    where,
    include: ticketInclude(),
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
  });

  const rows = tickets.map(serializeTicketRow);
  // Urgentes primero en la cola operativa
  rows.sort((a, b) => {
    if (a.urgent === b.urgent) return 0;
    return a.urgent ? -1 : 1;
  });
  const open = rows.filter((t) => !['terminado', 'closed', 'rejected'].includes(t.status));
  return {
    ok: true,
    kpis: {
      total: rows.length,
      open: open.length,
      programado: rows.filter((t) => t.status === 'programado').length,
      en_ejecucion: rows.filter((t) => t.status === 'en_ejecucion').length,
      asignada: rows.filter((t) => t.status === 'asignada').length,
      urgentOpen: open.filter((t) => t.urgent).length
    },
    tickets: rows
  };
}
