/**
 * Registra corrección por informe para métricas de exactitud Aintelligence.
 * exactitud = (slotsTotal - slotsCorrected) / slotsTotal × 100
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object} p
 */
export async function recordReportCorrection(prisma, p) {
  if (!prisma) return null;

  const slotsTotal = Math.max(1, Number(p.slotsTotal) || 1);
  const slotsCorrected = Math.max(0, Math.min(slotsTotal, Number(p.slotsCorrected) || 0));
  const accuracyPct = Math.round((1000 * (slotsTotal - slotsCorrected)) / slotsTotal) / 10;

  return prisma.aiReportCorrection.create({
    data: {
      source: p.source || 'AINSPECTA',
      caseId: p.caseId || null,
      caseShortId: p.caseShortId ? String(p.caseShortId).slice(0, 32) : null,
      tenantId: p.tenantId || null,
      externalInspectionId: p.externalInspectionId ? String(p.externalInspectionId).slice(0, 128) : null,
      slotsCorrected,
      slotsTotal,
      accuracyPct,
      slotCodes: Array.isArray(p.slotCodes) ? p.slotCodes : null
    }
  });
}

function reportMetricKey(row) {
  if (row.caseId) return `case:${row.caseId}`;
  if (row.externalInspectionId) return `pc:${row.source}:${row.externalInspectionId}`;
  return `row:${row.id || row.createdAt}`;
}

/** @param {Array<object>} rows */
function dedupeLatestByReport(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = reportMetricKey(r);
    const prev = map.get(key);
    if (!prev || new Date(r.createdAt).getTime() > new Date(prev.createdAt).getTime()) {
      map.set(key, r);
    }
  }
  return Array.from(map.values());
}

/**
 * Informe completado sin corrección previa → 100% exactitud.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} caseId
 */
export async function recordReportAccuracyOnComplete(prisma, caseId) {
  if (!prisma || !caseId) return null;

  const existing = await prisma.aiReportCorrection.findFirst({
    where: { caseId: String(caseId), source: 'AINSPECTA' },
    select: { id: true }
  });
  if (existing) return null;

  const c = await prisma.case.findUnique({
    where: { id: String(caseId) },
    select: { id: true, shortId: true, tenantId: true, status: true }
  });
  if (!c || c.status !== 'DONE') return null;

  const slotsTotal = await prisma.slot.count({
    where: { caseId: c.id, photoId: { not: null } }
  });
  if (slotsTotal <= 0) return null;

  return recordReportCorrection(prisma, {
    source: 'AINSPECTA',
    caseId: c.id,
    caseShortId: c.shortId,
    tenantId: c.tenantId,
    slotsCorrected: 0,
    slotsTotal
  });
}

/**
 * PropertyCheck: análisis batch sin feedback posterior → 100% por inspección.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ tenantId?: string, externalInspectionId: string, slotsTotal: number }} p
 */
export async function recordPropertyCheckAccuracyOnAnalyze(prisma, p) {
  if (!prisma || !p.externalInspectionId) return null;

  const existing = await prisma.aiReportCorrection.findFirst({
    where: {
      source: 'PROPERTYCHECK',
      externalInspectionId: String(p.externalInspectionId)
    },
    select: { id: true }
  });
  if (existing) return null;

  const slotsTotal = Math.max(1, Number(p.slotsTotal) || 1);
  return recordReportCorrection(prisma, {
    source: 'PROPERTYCHECK',
    tenantId: p.tenantId || null,
    externalInspectionId: String(p.externalInspectionId),
    slotsCorrected: 0,
    slotsTotal
  });
}

/**
 * Filas sintéticas 100% para informes DONE históricos sin métrica persistida.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} since
 * @param {Set<string>} caseIdsWithStoredMetric
 */
async function buildBackfillCompleteRows(prisma, since, caseIdsWithStoredMetric) {
  const doneCases = await prisma.case.findMany({
    where: { status: 'DONE', createdAt: { gte: since } },
    select: { id: true, shortId: true, tenantId: true, createdAt: true, reviewedAt: true }
  });

  const missing = doneCases.filter((c) => !caseIdsWithStoredMetric.has(c.id));
  if (!missing.length) return [];

  const slotGroups = await prisma.slot.groupBy({
    by: ['caseId'],
    where: {
      caseId: { in: missing.map((c) => c.id) },
      photoId: { not: null }
    },
    _count: { id: true }
  });
  const countByCase = Object.fromEntries(slotGroups.map((g) => [g.caseId, g._count.id]));

  return missing
    .map((c) => {
      const slotsTotal = countByCase[c.id] || 0;
      if (slotsTotal <= 0) return null;
      return {
        id: `backfill:${c.id}`,
        createdAt: c.reviewedAt || c.createdAt,
        slotsCorrected: 0,
        slotsTotal,
        accuracyPct: 100,
        source: 'AINSPECTA',
        caseId: c.id,
        caseShortId: c.shortId,
        externalInspectionId: null,
        backfill: true
      };
    })
    .filter(Boolean);
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} since
 */
export async function queryAnalysisAccuracyDaily(prisma, since) {
  const stored = await prisma.aiReportCorrection.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdAt: true,
      slotsCorrected: true,
      slotsTotal: true,
      accuracyPct: true,
      source: true,
      caseId: true,
      caseShortId: true,
      externalInspectionId: true
    }
  });

  const allCaseIdsWithMetric = await prisma.aiReportCorrection.findMany({
    where: { caseId: { not: null }, source: 'AINSPECTA' },
    distinct: ['caseId'],
    select: { caseId: true }
  });
  const caseIdsWithStoredMetric = new Set(allCaseIdsWithMetric.map((x) => x.caseId).filter(Boolean));

  const backfill = await buildBackfillCompleteRows(prisma, since, caseIdsWithStoredMetric);
  const rows = [...stored, ...backfill];

  /** @type {Record<string, { slotsCorrected: number, slotsTotal: number, reports: number, complete100: number, corrected: number }>} */
  const byDay = {};

  for (const r of rows) {
    const day = new Date(r.createdAt).toISOString().slice(0, 10);
    if (!byDay[day]) {
      byDay[day] = { slotsCorrected: 0, slotsTotal: 0, reports: 0, complete100: 0, corrected: 0 };
    }
    const bucket = byDay[day];
    bucket.slotsCorrected += r.slotsCorrected;
    bucket.slotsTotal += r.slotsTotal;
    bucket.reports += 1;
    if (r.slotsCorrected === 0) bucket.complete100 += 1;
    else bucket.corrected += 1;
  }

  const series = Object.entries(byDay)
    .map(([day, v]) => ({
      day,
      reports: v.reports,
      reportsComplete100: v.complete100,
      reportsCorrected: v.corrected,
      slotsCorrected: v.slotsCorrected,
      slotsTotal: v.slotsTotal,
      accuracyPct:
        v.slotsTotal > 0
          ? Math.round((1000 * (v.slotsTotal - v.slotsCorrected)) / v.slotsTotal) / 10
          : null
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const latestPerReport = dedupeLatestByReport(rows);
  let periodSlotsCorrected = 0;
  let periodSlotsTotal = 0;
  let periodComplete100 = 0;
  let periodCorrected = 0;
  for (const r of latestPerReport) {
    periodSlotsCorrected += r.slotsCorrected;
    periodSlotsTotal += r.slotsTotal;
    if (r.slotsCorrected === 0) periodComplete100 += 1;
    else periodCorrected += 1;
  }

  const periodAccuracyPct =
    periodSlotsTotal > 0
      ? Math.round((1000 * (periodSlotsTotal - periodSlotsCorrected)) / periodSlotsTotal) / 10
      : null;

  return {
    series,
    summary: {
      reports: latestPerReport.length,
      reportsComplete100: periodComplete100,
      reportsCorrected: periodCorrected,
      slotsCorrected: periodSlotsCorrected,
      slotsTotal: periodSlotsTotal,
      accuracyPct: periodAccuracyPct,
      backfillReports: backfill.length
    }
  };
}
