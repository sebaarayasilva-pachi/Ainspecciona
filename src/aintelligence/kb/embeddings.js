/**
 * Embeddings para la KB (RAG). OpenAI text-embedding-3-small por defecto.
 * Sin OPENAI_API_KEY las entradas quedan sin vector y el retrieve cae a filtros exactos.
 */
import OpenAI from 'openai';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export function getEmbeddingModel() {
  return String(process.env.KB_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim();
}

export function embeddingsEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * @param {string} text
 * @returns {Promise<{ ok: true, vector: number[], model: string } | { ok: false, error: string }>}
 */
export async function embedText(text) {
  const input = String(text || '').trim().slice(0, 8000);
  if (!input) return { ok: false, error: 'EMPTY_TEXT' };
  if (!embeddingsEnabled()) return { ok: false, error: 'OPENAI_NOT_CONFIGURED' };

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = getEmbeddingModel();
    const res = await client.embeddings.create({ model, input });
    const vector = res?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || !vector.length) {
      return { ok: false, error: 'EMPTY_EMBEDDING' };
    }
    return { ok: true, vector, model };
  } catch (err) {
    return { ok: false, error: err?.message || 'EMBEDDING_FAILED' };
  }
}

/**
 * Similitud coseno entre dos vectores (misma dimensión).
 * @param {number[]} a
 * @param {number[]} b
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
