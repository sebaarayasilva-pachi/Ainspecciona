import crypto from 'node:crypto';
import { validatePropertyCheckFeedback } from './validatePropertyCheckFeedback.js';
import { fetchFeedbackImageBuffer, mimeToExt } from './fetchFeedbackImage.js';
import { recordReportCorrection } from '../metrics/analysisAccuracy.js';

function fingerprintPayload(normalized, imageSha256) {
  const core = {
    externalInspectionId: normalized.externalInspectionId,
    captureId: normalized.captureId,
    planItemId: normalized.planItemId,
    aiSnapshot: normalized.aiSnapshot,
    humanLabel: normalized.humanLabel,
    imageSha256: imageSha256 || null
  };
  return crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
}

function mapIngestError(err) {
  const code = err?.code || 'INGEST_FAILED';
  if (code === 'VALIDATION') {
    return { kind: 'error', ok: false, code, message: err.message, field: err.field };
  }
  if (code === 'IMAGE_UNREADABLE') {
    return { kind: 'error', ok: false, code, message: 'No se pudo leer la imagen (URL inaccesible o base64 inválido).' };
  }
  if (code === 'PAYLOAD_TOO_LARGE') {
    return {
      kind: 'error',
      ok: false,
      code,
      message: 'Imagen excede el tamaño máximo permitido.'
    };
  }
  if (code === 'CONFLICT') {
    return { kind: 'error', ok: false, code, message: err.message || 'Conflicto de idempotencia.' };
  }
  return { kind: 'error', ok: false, code: 'INGEST_FAILED', message: String(err?.message || err) };
}

/**
 * @param {object} p
 * @param {import('@prisma/client').PrismaClient} p.prisma
 * @param {ReturnType<import('../../storage/storage.js').createStorage>} p.storage
 * @param {string} p.tenantId
 * @param {object} p.body
 * @param {string} [p.idempotencyKey]
 * @param {import('pino').Logger | Console} [p.log]
 */
export async function ingestPropertyCheckFeedback({ prisma, storage, tenantId, body, idempotencyKey, log }) {
  const requestId = crypto.randomUUID();
  const validated = validatePropertyCheckFeedback(body);
  if (!validated.ok) {
    return { ...validated, kind: 'error', ok: false, requestId };
  }

  const normalized = validated.normalized;
  const feedbackId = normalized.feedbackId;

  const existing = await prisma.aiFeedback.findUnique({
    where: {
      source_externalFeedbackId: {
        source: 'PROPERTYCHECK',
        externalFeedbackId: feedbackId
      }
    }
  });

  let imageStored = false;
  let imagePath = existing?.imagePath || null;
  let imageSha256 = existing?.imageSha256 || null;
  let imageMimeType = existing?.imageMimeType || null;

  try {
    const fetched = await fetchFeedbackImageBuffer(normalized.image, log);
    imageSha256 = fetched.sha256;
    imageMimeType = fetched.mimeType;

    const fp = fingerprintPayload(normalized, imageSha256);

    if (existing) {
      if (existing.payloadFingerprint && existing.payloadFingerprint !== fp) {
        const err = new Error('Mismo feedbackId con payload distinto.');
        err.code = 'CONFLICT';
        throw err;
      }
      return {
        kind: 'feedback',
        ok: true,
        requestId,
        feedbackId,
        aintelligenceFeedbackId: existing.id,
        status: existing.status,
        duplicate: true,
        imageStored: Boolean(existing.imagePath),
        message: 'Feedback ya registrado.'
      };
    }

    const ext = mimeToExt(fetched.mimeType);
    const storageKey = `aintelligence/propertycheck/${tenantId}/${normalized.externalInspectionId}/${normalized.captureId}.${ext}`;
    const saved = await storage.saveImageBuffer({
      buffer: fetched.buffer,
      contentType: fetched.mimeType,
      ext,
      tenantId,
      storageKey
    });
    imagePath = saved.filePath;
    imageStored = true;

    const status =
      normalized.humanLabel.feedbackType === 'anti_example' ||
      normalized.humanLabel.feedbackType === 'correction'
        ? 'pending_review'
        : 'draft';

    const row = await prisma.aiFeedback.create({
      data: {
        tenantId,
        source: 'PROPERTYCHECK',
        status,
        externalFeedbackId: feedbackId,
        externalInspectionId: normalized.externalInspectionId,
        captureId: normalized.captureId,
        planItemId: normalized.planItemId,
        sequence: normalized.sequence,
        kpiKey: normalized.aiSnapshot.kpiKey,
        photoPlan: normalized.photoPlan,
        analyzeContext: normalized.analyzeContext,
        aiSnapshot: normalized.aiSnapshot,
        humanLabel: normalized.humanLabel,
        reviewer: normalized.reviewer,
        imagePath,
        imageSha256,
        imageMimeType,
        payloadFingerprint: fp,
        idempotencyKey: idempotencyKey ? String(idempotencyKey).trim().slice(0, 128) : null,
        submittedAt: normalized.submittedAt || new Date()
      }
    });

    log?.info?.(
      {
        aintelligenceFeedbackId: row.id,
        feedbackId,
        externalInspectionId: normalized.externalInspectionId,
        planItemId: normalized.planItemId,
        feedbackType: normalized.humanLabel.feedbackType
      },
      'aintelligence-propertycheck-feedback-ingested'
    );

    if (['correction', 'anti_example'].includes(normalized.humanLabel.feedbackType)) {
      recordReportCorrection(prisma, {
        source: 'PROPERTYCHECK',
        tenantId,
        externalInspectionId: normalized.externalInspectionId,
        slotsCorrected: 1,
        slotsTotal: 1,
        slotCodes: [normalized.planItemId]
      }).catch((err) => log?.warn?.({ err: err?.message }, 'analysis-accuracy-metric-propertycheck'));
    }

    return {
      kind: 'feedback',
      ok: true,
      requestId,
      feedbackId,
      aintelligenceFeedbackId: row.id,
      status: row.status,
      duplicate: false,
      imageStored,
      message: 'Feedback recibido. Pendiente revisión en Aintelligence.'
    };
  } catch (err) {
    log?.warn?.({ err: err?.message, feedbackId }, 'aintelligence-propertycheck-feedback-failed');
    const mapped = mapIngestError(err);
    return { ...mapped, requestId };
  }
}

/**
 * @param {object} p
 * @param {import('@prisma/client').PrismaClient} p.prisma
 * @param {ReturnType<import('../../storage/storage.js').createStorage>} p.storage
 * @param {string} p.tenantId
 * @param {object} p.body - { externalInspectionId, items[] }
 * @param {import('pino').Logger | Console} [p.log]
 */
export async function ingestPropertyCheckFeedbackBatch({ prisma, storage, tenantId, body, log }) {
  const requestId = crypto.randomUUID();
  const externalInspectionId = String(body?.externalInspectionId || '').trim();
  const items = Array.isArray(body?.items) ? body.items : [];

  if (!externalInspectionId) {
    return {
      kind: 'error',
      ok: false,
      requestId,
      code: 'VALIDATION',
      message: 'externalInspectionId requerido.'
    };
  }
  if (!items.length) {
    return {
      kind: 'error',
      ok: false,
      requestId,
      code: 'VALIDATION',
      message: 'items[] no puede estar vacío.'
    };
  }

  const maxItems = Math.min(20, Math.max(1, Number(process.env.AINTELLIGENCE_FEEDBACK_BATCH_MAX || 20)));
  if (items.length > maxItems) {
    return {
      kind: 'error',
      ok: false,
      requestId,
      code: 'VALIDATION',
      message: `Máximo ${maxItems} items por solicitud.`
    };
  }

  const results = [];
  let accepted = 0;
  let duplicates = 0;
  let failed = 0;

  for (const item of items) {
    const merged = {
      ...(item && typeof item === 'object' ? item : {}),
      externalInspectionId: String(item?.externalInspectionId || externalInspectionId).trim()
    };
    const out = await ingestPropertyCheckFeedback({ prisma, storage, tenantId, body: merged, log });
    if (!out.ok) {
      failed += 1;
      results.push({
        feedbackId: merged.feedbackId || null,
        ok: false,
        code: out.code,
        message: out.message
      });
      continue;
    }
    if (out.duplicate) duplicates += 1;
    else accepted += 1;
    results.push({
      feedbackId: out.feedbackId,
      aintelligenceFeedbackId: out.aintelligenceFeedbackId,
      status: out.status,
      duplicate: out.duplicate,
      ok: true
    });
  }

  return {
    kind: 'feedback_batch',
    ok: true,
    requestId,
    accepted,
    duplicates,
    failed,
    results
  };
}
