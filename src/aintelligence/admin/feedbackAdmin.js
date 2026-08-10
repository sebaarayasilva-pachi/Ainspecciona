import { appendFindingExampleToConfig } from './promoteToKb.js';

const REVIEWABLE = new Set(['draft', 'pending_review']);

function mapFeedbackRow(row, storage) {
  const human = row.humanLabel || {};
  const snap = row.aiSnapshot || {};
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    tenantId: row.tenantId,
    externalFeedbackId: row.externalFeedbackId,
    externalInspectionId: row.externalInspectionId,
    captureId: row.captureId,
    planItemId: row.planItemId,
    kpiKey: row.kpiKey,
    feedbackType: human.feedbackType || null,
    humanSignal: human.signal || null,
    humanSeverity: human.severity || null,
    aiDescription: snap.description || null,
    aiSignals: snap.signals_detected || [],
    imageUrl: row.imagePath ? storage?.publicUrl?.(row.imagePath) || row.imagePath : null,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function getAintelligenceFeedbackStats(prisma) {
  const [pendingReview, draft, approved, rejected, total] = await Promise.all([
    prisma.aiFeedback.count({ where: { status: 'pending_review' } }),
    prisma.aiFeedback.count({ where: { status: 'draft' } }),
    prisma.aiFeedback.count({ where: { status: 'approved' } }),
    prisma.aiFeedback.count({ where: { status: 'rejected' } }),
    prisma.aiFeedback.count()
  ]);
  return {
    ok: true,
    stats: { pendingReview, draft, approved, rejected, total, queue: pendingReview + draft }
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object} storage
 * @param {object} query
 */
export async function listAintelligenceFeedback(prisma, storage, query = {}) {
  const status = String(query.status || '').trim();
  const source = String(query.source || '').trim();
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
  const offset = Math.max(0, Number(query.offset) || 0);

  const where = {};
  if (status === 'queue') {
    where.status = { in: ['draft', 'pending_review'] };
  } else if (status) {
    where.status = status;
  }
  if (source) where.source = source;

  const [rows, total] = await Promise.all([
    prisma.aiFeedback.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: offset,
      take: limit
    }),
    prisma.aiFeedback.count({ where })
  ]);

  return {
    ok: true,
    total,
    limit,
    offset,
    items: rows.map((r) => mapFeedbackRow(r, storage))
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object} storage
 * @param {string} id
 */
export async function getAintelligenceFeedbackDetail(prisma, storage, id) {
  const row = await prisma.aiFeedback.findUnique({ where: { id: String(id) } });
  if (!row) {
    return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Feedback no encontrado.' };
  }
  return {
    ok: true,
    item: {
      ...mapFeedbackRow(row, storage),
      sequence: row.sequence,
      photoPlan: row.photoPlan,
      analyzeContext: row.analyzeContext,
      aiSnapshot: row.aiSnapshot,
      humanLabel: row.humanLabel,
      reviewer: row.reviewer,
      imageSha256: row.imageSha256
    }
  };
}

/**
 * @param {object} p
 */
export async function approveAintelligenceFeedback(p) {
  const { prisma, storage, id, body, getRuntimeScoreConfig, applyScoreConfigUpdate } = p;
  const row = await prisma.aiFeedback.findUnique({ where: { id: String(id) } });
  if (!row) {
    return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Feedback no encontrado.' };
  }
  if (!REVIEWABLE.has(row.status) && row.status !== 'rejected') {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_STATUS',
      message: `No se puede aprobar un feedback en estado "${row.status}".`
    };
  }

  const overrides = {
    signal: body?.signal,
    severity: body?.severity,
    guidance: body?.notes || body?.guidance
  };

  let kbResult;
  try {
    const runtime = await getRuntimeScoreConfig({ force: true });
    kbResult = appendFindingExampleToConfig(row, runtime.config || {}, overrides);
    await applyScoreConfigUpdate(kbResult.config);
  } catch (err) {
    if (err?.code === 'VALIDATION') {
      return {
        ok: false,
        status: 400,
        error: 'VALIDATION',
        message: 'Falta señal o KPI para agregar a la biblioteca.'
      };
    }
    throw err;
  }

  const reviewNotes = String(body?.notes || '').trim() || null;
  const humanLabel = { ...(row.humanLabel || {}) };
  if (overrides.signal) humanLabel.signal = String(overrides.signal).trim();
  if (overrides.severity) humanLabel.severity = String(overrides.severity).toLowerCase();
  if (reviewNotes) humanLabel.reviewNotes = reviewNotes;

  const updated = await prisma.aiFeedback.update({
    where: { id: row.id },
    data: {
      status: 'approved',
      humanLabel
    }
  });

  return {
    ok: true,
    item: mapFeedbackRow(updated, storage),
    kbExample: kbResult.example,
    kbDuplicate: kbResult.duplicate,
    message: kbResult.duplicate
      ? 'Aprobado. El criterio ya existía en la biblioteca.'
      : 'Aprobado y agregado a la biblioteca de hallazgos.'
  };
}

/**
 * @param {object} p
 */
export async function rejectAintelligenceFeedback(p) {
  const { prisma, storage, id, body } = p;
  const row = await prisma.aiFeedback.findUnique({ where: { id: String(id) } });
  if (!row) {
    return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Feedback no encontrado.' };
  }
  if (row.status === 'approved') {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_STATUS',
      message: 'No se puede rechazar un feedback ya aprobado.'
    };
  }

  const reviewNotes = String(body?.notes || '').trim() || null;
  const humanLabel = { ...(row.humanLabel || {}) };
  if (reviewNotes) humanLabel.reviewNotes = reviewNotes;

  const updated = await prisma.aiFeedback.update({
    where: { id: row.id },
    data: { status: 'rejected', humanLabel }
  });

  return {
    ok: true,
    item: mapFeedbackRow(updated, storage),
    message: 'Feedback rechazado.'
  };
}
