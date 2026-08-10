/**
 * Creación idempotente de entradas KB desde los veredictos del centro de revisión.
 */
import crypto from 'node:crypto';
import { embedText } from './embeddings.js';
import { invalidateKbCache } from './retrieve.js';

const VALID_TYPES = new Set(['finding_example', 'anti_example', 'correction', 'ticket_learning']);
const VALID_SOURCES = new Set(['AINSPECTA', 'POSTVENTA', 'PROPERTYCHECK', 'ENTREGA']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical', 'none']);

function fingerprintOf(p) {
  const core = {
    source: p.source,
    entryType: p.entryType,
    kpiKey: p.kpiKey || null,
    category: p.category || null,
    sourceRef: p.sourceRef || null,
    text: p.text
  };
  return crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
}

/**
 * Crea (o reusa por fingerprint) una entrada KB. Embebe el texto si hay OPENAI_API_KEY.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object} p
 * @param {'AINSPECTA' | 'POSTVENTA' | 'PROPERTYCHECK' | 'ENTREGA'} p.source
 * @param {'finding_example' | 'anti_example' | 'correction' | 'ticket_learning'} p.entryType
 * @param {string} p.text Texto canónico (se embebe y se inyecta en prompts).
 * @param {string} [p.kpiKey]
 * @param {string} [p.category]
 * @param {string} [p.severity]
 * @param {object} [p.payload]
 * @param {string} [p.sourceRef]
 * @param {string} [p.tenantId]
 * @param {string} [p.createdBy]
 * @param {'candidate' | 'approved'} [p.status] Default 'approved' (veredicto humano directo).
 * @param {import('pino').Logger | Console} [log]
 * @returns {Promise<{ ok: true, entryId: string, duplicate: boolean, embedded: boolean } | { ok: false, error: string }>}
 */
export async function createKnowledgeEntry(prisma, p, log) {
  if (!prisma) return { ok: false, error: 'NO_PRISMA' };

  const source = String(p.source || '').toUpperCase();
  const entryType = String(p.entryType || '');
  const text = String(p.text || '').trim();

  if (!VALID_SOURCES.has(source)) return { ok: false, error: 'INVALID_SOURCE' };
  if (!VALID_TYPES.has(entryType)) return { ok: false, error: 'INVALID_ENTRY_TYPE' };
  if (!text) return { ok: false, error: 'EMPTY_TEXT' };

  const severity = p.severity && VALID_SEVERITIES.has(String(p.severity).toLowerCase())
    ? String(p.severity).toLowerCase()
    : null;

  const data = {
    source,
    entryType,
    text: text.slice(0, 4000),
    kpiKey: p.kpiKey ? String(p.kpiKey).toUpperCase().slice(0, 64) : null,
    category: p.category ? String(p.category).slice(0, 64) : null,
    severity,
    payload: p.payload ?? null,
    sourceRef: p.sourceRef ? String(p.sourceRef).slice(0, 191) : null,
    tenantId: p.tenantId || null,
    createdBy: p.createdBy ? String(p.createdBy).slice(0, 255) : null,
    status: p.status === 'candidate' ? 'candidate' : 'approved'
  };

  const fingerprint = fingerprintOf(data);

  const existing = await prisma.knowledgeEntry.findUnique({
    where: { fingerprint },
    select: { id: true }
  });
  if (existing) {
    return { ok: true, entryId: existing.id, duplicate: true, embedded: false };
  }

  let embedding = null;
  let embeddingModel = null;
  const emb = await embedText(data.text);
  if (emb.ok) {
    embedding = emb.vector;
    embeddingModel = emb.model;
  } else if (emb.error !== 'OPENAI_NOT_CONFIGURED') {
    log?.warn?.({ err: emb.error }, 'kb-embed-failed (entrada queda sin vector)');
  }

  const created = await prisma.knowledgeEntry.create({
    data: { ...data, fingerprint, embedding, embeddingModel },
    select: { id: true }
  });

  invalidateKbCache();
  return { ok: true, entryId: created.id, duplicate: false, embedded: !!embedding };
}
