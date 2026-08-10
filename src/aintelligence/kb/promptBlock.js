/**
 * Bloque KB (RAG) listo para inyectar en prompts de análisis.
 * Falla en silencio: el análisis nunca debe romperse por la KB.
 */
import { retrieveSimilar, formatKbBlock } from './retrieve.js';

/**
 * @param {object} p
 * @param {import('@prisma/client').PrismaClient | null} p.prisma
 * @param {string} p.text Contexto del análisis en curso (consulta semántica).
 * @param {string} [p.kpiKey]
 * @param {string} [p.category]
 * @param {string[]} [p.sources] Fuentes de conocimiento admitidas para esta mirada.
 *   Matriz de miradas:
 *   - Ainspecciona (deterioro en el tiempo): ['AINSPECTA','PROPERTYCHECK']
 *   - Property-chk: ['PROPERTYCHECK','AINSPECTA']
 *   - Postventa (fallas de fabricación post-entrega): ['POSTVENTA','ENTREGA']
 * @param {number} [p.topK]
 * @param {import('pino').Logger | Console} [p.log]
 * @returns {Promise<string>} Bloque de texto ('' si no hay conocimiento aplicable).
 */
export async function getKbPromptBlock({ prisma, text, kpiKey, category, sources, topK = 5, log }) {
  if (!prisma) return '';
  try {
    const res = await retrieveSimilar({ prisma, text, kpiKey, category, sources, topK });
    if (!res.ok || !res.entries.length) return '';
    log?.info?.(
      { mode: res.mode, count: res.entries.length, kpiKey: kpiKey || null, category: category || null, sources: sources || null },
      'kb-rag-injected'
    );
    let block = formatKbBlock(res.entries);
    if (res.entries.some((e) => e.source === 'ENTREGA')) {
      block +=
        '\nNota sobre criterios de entrega: algunos criterios provienen de inspecciones de ENTREGA de obra nueva. ' +
        'Antes de atribuir un hallazgo similar a fabricación, evalúa si la antigüedad de la unidad y el uso lo explican (uso/desgaste no es garantía).';
    }
    return block;
  } catch (err) {
    log?.warn?.({ err: err?.message }, 'kb-rag-failed');
    return '';
  }
}
