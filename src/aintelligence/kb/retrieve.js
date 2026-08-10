/**
 * Recuperación semántica sobre KnowledgeEntry aprobadas (RAG en proceso).
 * Cache en memoria de vectores; volumen esperado de miles de entradas.
 * Escala futura (>~50k entradas): mover a vector DB (pgvector / Vertex).
 */
import { cosineSimilarity, embedText } from './embeddings.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {{ rows: Array<object>, loadedAt: number } | null} */
let _cache = null;

export function invalidateKbCache() {
  _cache = null;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function loadApprovedEntries(prisma) {
  if (_cache && Date.now() - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache.rows;
  }
  const rows = await prisma.knowledgeEntry.findMany({
    where: { status: 'approved' },
    select: {
      id: true,
      tenantId: true,
      source: true,
      entryType: true,
      kpiKey: true,
      category: true,
      severity: true,
      text: true,
      embedding: true
    }
  });
  _cache = { rows, loadedAt: Date.now() };
  return rows;
}

/**
 * Recupera las entradas aprobadas más similares al texto de consulta.
 * Filtros exactos opcionales (kpiKey/category/source/tenantId) se aplican antes de la similitud.
 * Sin embeddings disponibles (entrada o consulta), cae a filtros exactos por recencia.
 *
 * @param {object} p
 * @param {import('@prisma/client').PrismaClient} p.prisma
 * @param {string} p.text Texto de consulta (contexto del análisis en curso).
 * @param {string} [p.kpiKey]
 * @param {string} [p.category]
 * @param {string} [p.source] Fuente única (atajo de `sources`).
 * @param {string[]} [p.sources] Fuentes admitidas para esta mirada (ej. Postventa: ['POSTVENTA','ENTREGA']).
 * @param {string} [p.tenantId] Incluye entradas globales (tenantId null) + del tenant.
 * @param {number} [p.topK]
 * @param {number} [p.minScore]
 * @returns {Promise<{ ok: boolean, entries: Array<object>, mode: 'semantic' | 'filter', error?: string }>}
 */
export async function retrieveSimilar({
  prisma,
  text,
  kpiKey,
  category,
  source,
  sources,
  tenantId,
  topK = 5,
  minScore = 0.25
}) {
  if (!prisma) return { ok: false, entries: [], mode: 'filter', error: 'NO_PRISMA' };

  let rows;
  try {
    rows = await loadApprovedEntries(prisma);
  } catch (err) {
    return { ok: false, entries: [], mode: 'filter', error: err?.message || 'KB_LOAD_FAILED' };
  }

  const kpi = kpiKey ? String(kpiKey).toUpperCase().trim() : null;
  const cat = category ? String(category).trim() : null;
  const srcList = [
    ...(Array.isArray(sources) ? sources : []),
    ...(source ? [source] : [])
  ]
    .map((s) => String(s).toUpperCase().trim())
    .filter(Boolean);
  const srcSet = srcList.length ? new Set(srcList) : null;

  const filtered = rows.filter((r) => {
    if (kpi && String(r.kpiKey || '').toUpperCase() !== kpi) return false;
    if (cat && String(r.category || '') !== cat) return false;
    if (srcSet && !srcSet.has(String(r.source || '').toUpperCase())) return false;
    if (r.tenantId && tenantId && r.tenantId !== tenantId) return false;
    if (r.tenantId && !tenantId) return false;
    return true;
  });

  if (!filtered.length) return { ok: true, entries: [], mode: 'filter' };

  const queryText = String(text || '').trim();
  if (queryText) {
    const q = await embedText(queryText);
    if (q.ok) {
      const scored = filtered
        .filter((r) => Array.isArray(r.embedding) && r.embedding.length === q.vector.length)
        .map((r) => ({ entry: r, score: cosineSimilarity(q.vector, r.embedding) }))
        .filter((s) => s.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      if (scored.length) {
        return {
          ok: true,
          mode: 'semantic',
          entries: scored.map((s) => ({ ...stripVector(s.entry), score: Math.round(s.score * 1000) / 1000 }))
        };
      }
    }
  }

  // Fallback: filtros exactos, más recientes primero (ids uuid: usar orden de carga).
  return {
    ok: true,
    mode: 'filter',
    entries: filtered.slice(-topK).map((r) => stripVector(r))
  };
}

function stripVector(row) {
  const { embedding, ...rest } = row;
  return rest;
}

/**
 * Bloque de texto para inyectar en prompts.
 * @param {Array<{ text: string, severity?: string | null, entryType?: string }>} entries
 * @param {string} [header]
 */
export function formatKbBlock(entries, header = 'Criterios aprendidos de casos anteriores (priorizar sobre suposiciones genéricas):') {
  if (!Array.isArray(entries) || !entries.length) return '';
  const lines = entries.map((e, i) => {
    const sev = e.severity ? ` [severidad: ${e.severity}]` : '';
    const anti = e.entryType === 'anti_example' ? ' [ANTI-EJEMPLO — no clasificar así]' : '';
    return `${i + 1}. ${String(e.text || '').trim()}${sev}${anti}`;
  });
  return ['', header, ...lines].join('\n');
}
