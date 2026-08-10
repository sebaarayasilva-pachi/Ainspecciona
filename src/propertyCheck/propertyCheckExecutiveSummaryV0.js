/**
 * Resumen ejecutivo Property-chk (mismo estilo que POST /api/cases/:caseId/executive-summary).
 */
import OpenAI from 'openai';
import crypto from 'node:crypto';

function severityBucket(severity) {
  const s = String(severity || '').toLowerCase();
  if (s.includes('grave') || s.includes('alto') || s.includes('high')) return 'high';
  if (s.includes('inter') || s.includes('medio') || s.includes('medium')) return 'medium';
  if (s.includes('favor') || s.includes('bajo') || s.includes('low')) return 'low';
  return 'other';
}

/**
 * @param {object} p
 * @param {object} p.body
 * @param {import('pino').Logger} [p.log]
 */
export async function generatePropertyCheckExecutiveSummaryV0({ body, log }) {
  const requestId = crypto.randomUUID();
  const externalInspectionId = String(body?.externalInspectionId || '').trim();
  const globalScore = Math.round(
    Math.max(0, Math.min(100, Number(body?.globalScore) || 0)),
  );
  const globalLabel = String(body?.globalLabel || 'Sin datos').trim() || 'Sin datos';
  const byKpi = Array.isArray(body?.byKpi) ? body.byKpi : [];
  const findingsDigest = Array.isArray(body?.findingsDigest)
    ? body.findingsDigest
    : [];

  if (!externalInspectionId) {
    return {
      kind: 'error',
      ok: false,
      requestId,
      code: 'VALIDATION',
      message: 'externalInspectionId requerido.',
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      kind: 'error',
      ok: false,
      requestId,
      code: 'OPENAI_NOT_CONFIGURED',
      message: 'OPENAI_API_KEY no configurada en el servidor.',
    };
  }

  const evaluated = byKpi.filter(
    (k) => k && k.score != null && Number.isFinite(Number(k.score)),
  );

  const summaryByKpi = evaluated.map((k) => {
    const label = String(k.kpiLabel || k.kpiKey || 'Categoría').trim();
    const score = Math.round(Number(k.score));
    const band = String(k.label || '').trim();
    const sev = { high: 0, medium: 0, low: 0, other: 0 };
    for (const f of findingsDigest) {
      if (String(f.kpiKey || '') !== String(k.kpiKey || '')) continue;
      sev[severityBucket(f.severity)] += 1;
    }
    const severityNote =
      [
        sev.high && `${sev.high} alta`,
        sev.medium && `${sev.medium} media`,
        sev.low && `${sev.low} baja`,
      ]
        .filter(Boolean)
        .join(', ') || 'sin detalle de severidad';
    return `${label}: puntaje ${score}/100 (${band || '—'}), ${severityNote}.`;
  });

  const natureHints = findingsDigest
    .slice(0, 8)
    .map((f) => {
      const kpi = String(f.kpiLabel || f.kpiKey || '').trim();
      const hint = String(f.hint || '').trim();
      if (!hint) return '';
      return kpi ? `${kpi}: ${hint}` : hint;
    })
    .filter(Boolean);

  const prompt = [
    'Eres un experto en informes técnicos inmobiliarios (STI, Chile). Genera un resumen ejecutivo para el informe de inspección.',
    '',
    'PROHIBIDO: NUNCA incluyas dirección, nombre de calle, comuna, barrio, ROL, propietario ni datos que identifiquen el inmueble. PROHIBIDO nombrar ambientes concretos (cocina, living, baño, dormitorio, etc.) o listar hallazgos uno a uno por ubicación.',
    '',
    'Datos de entrada (solo para contexto):',
    `- Score técnico del inmueble (STI): ${globalScore}/100 - ${globalLabel}`,
    `- Categorías evaluadas (${evaluated.length}): ${
      summaryByKpi.length ? summaryByKpi.join(' ') : 'Sin categorías puntuadas.'
    }`,
    natureHints.length
      ? `- Referencia de naturaleza de hallazgos (no citar ambientes): ${natureHints.join(' | ')}`
      : '- Sin hallazgos destacados por debajo de umbral.',
    '',
    'Formato y estilo OBLIGATORIOS:',
    '- Redacta en 2 o 3 párrafos narrativos continuos. NO uses viñetas ni listas de hallazgos.',
    '- Párrafo 1: Estado general del inmueble según el STI (qué indica el score en términos de conservación y cumplimiento de estándares).',
    '- Párrafo 2: Sintetiza los hallazgos por NATURALEZA del problema (terminaciones, humedad, instalaciones, etc.), como aspectos de uso y mantención. No menciones ambientes ni detalles por zona.',
    '- Párrafo 3: Conclusión sobre el funcionamiento general y que los hallazgos son abordables con mantenciones menores cuando corresponda.',
    '- Lenguaje profesional, claro y neutro. Sin costos ni presupuestos. Sin encabezados ni markdown.',
  ].join('\n');

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1200,
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return {
        kind: 'error',
        ok: false,
        requestId,
        code: 'EMPTY_RESPONSE',
        message: 'OpenAI no devolvió texto.',
      };
    }
    return {
      kind: 'sync',
      ok: true,
      requestId,
      externalInspectionId,
      executiveSummary: text,
    };
  } catch (err) {
    log?.warn?.({ err: err?.message }, 'propertycheck-executive-summary-failed');
    return {
      kind: 'error',
      ok: false,
      requestId,
      code: 'GENERATION_FAILED',
      message: String(err?.message || err),
    };
  }
}
