/**
 * PropertyCheck → Aintelligence: ingesta de feedback de hallazgos.
 */
import {
  ingestPropertyCheckFeedback,
  ingestPropertyCheckFeedbackBatch
} from '../aintelligence/ingest/ingestPropertyCheckFeedback.js';

export function verifyPropertyCheckIngressSecret(headers) {
  const expected = String(process.env.PROPERTYCHECK_INGRESS_SECRET || '').trim();
  const provided = String(headers['x-propertycheck-secret'] || '').trim();
  if (!expected || provided !== expected) {
    return {
      ok: false,
      kind: 'error',
      code: 'UNAUTHORIZED',
      message: 'Falta o es inválido x-propertycheck-secret (PROPERTYCHECK_INGRESS_SECRET en servidor).'
    };
  }
  return { ok: true };
}

function httpStatusForCode(code) {
  if (code === 'VALIDATION') return 400;
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'TENANT_NOT_FOUND') return 404;
  if (code === 'CONFLICT') return 409;
  if (code === 'PAYLOAD_TOO_LARGE') return 413;
  if (code === 'IMAGE_UNREADABLE') return 422;
  return 502;
}

/**
 * @param {object} p
 * @param {import('@prisma/client').PrismaClient} p.prisma
 * @param {ReturnType<import('../storage/storage.js').createStorage>} p.storage
 * @param {string} p.tenantId
 * @param {object} p.body
 * @param {string} [p.idempotencyKey]
 * @param {import('pino').Logger | Console} [p.log]
 */
export async function handlePropertyCheckFeedbackV0({ prisma, storage, tenantId, body, idempotencyKey, log }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) }, select: { id: true } });
  if (!tenant) {
    return {
      httpStatus: 404,
      body: {
        kind: 'error',
        ok: false,
        code: 'TENANT_NOT_FOUND',
        message: 'Tenant no encontrado.'
      }
    };
  }

  const out = await ingestPropertyCheckFeedback({
    prisma,
    storage,
    tenantId: tenant.id,
    body: body || {},
    idempotencyKey,
    log
  });

  if (!out.ok) {
    return { httpStatus: httpStatusForCode(out.code), body: out };
  }

  return {
    httpStatus: out.duplicate ? 200 : 201,
    body: out
  };
}

/**
 * @param {object} p
 * @param {import('@prisma/client').PrismaClient} p.prisma
 * @param {ReturnType<import('../storage/storage.js').createStorage>} p.storage
 * @param {string} p.tenantId
 * @param {object} p.body
 * @param {import('pino').Logger | Console} [p.log]
 */
export async function handlePropertyCheckFeedbackBatchV0({ prisma, storage, tenantId, body, log }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) }, select: { id: true } });
  if (!tenant) {
    return {
      httpStatus: 404,
      body: {
        kind: 'error',
        ok: false,
        code: 'TENANT_NOT_FOUND',
        message: 'Tenant no encontrado.'
      }
    };
  }

  const out = await ingestPropertyCheckFeedbackBatch({
    prisma,
    storage,
    tenantId: tenant.id,
    body: body || {},
    log
  });

  if (!out.ok) {
    return { httpStatus: httpStatusForCode(out.code), body: out };
  }

  return { httpStatus: 200, body: out };
}
