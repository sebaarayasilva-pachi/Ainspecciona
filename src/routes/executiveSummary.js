import OpenAI from 'openai';
import { classifyKpiFromSlot } from '../scoring/scoringV2_2.js';
import { getCaseSummary } from './caseSummary.js';

const BADGE_LABEL = {
  GREEN: 'Favorable',
  YELLOW: 'Intermedio',
  RED: 'Revisión sugerida',
  GRAY: 'Sin datos'
};

const KPI_LABEL = {
  MUROS_PINTURA: 'Muros y pintura',
  HUMEDAD: 'Humedad visible',
  PISOS: 'Pisos',
  SANITARIOS: 'Sanitarios',
  ELECTRICIDAD: 'Electricidad visible',
  VENTANAS_CERRAMIENTOS: 'Ventanas y cerramientos',
  PUERTAS_HERRAJES: 'Puertas y herrajes',
  MOBILIARIO_FIJO: 'Mobiliario fijo'
};

function buildExecutiveSummaryPrompt(summary, scoreConfig) {
  const slots = summary.slots || [];
  const score = Math.round(Math.max(0, Math.min(100, summary.score ?? 0)));
  const badge = summary.badge || 'GRAY';
  const badgeText = BADGE_LABEL[badge] || badge;

  const slotsWithFindings = slots.filter((s) => s.findingCode && s.severity);
  const byKpi = {};
  slotsWithFindings.forEach((s) => {
    const kpi = classifyKpiFromSlot(s, scoreConfig?.slotKpiMap) || 'OTHER';
    if (!byKpi[kpi]) byKpi[kpi] = { label: KPI_LABEL[kpi] || kpi, severities: [] };
    if (s.severity) byKpi[kpi].severities.push(s.severity);
  });

  const summaryByType = Object.values(byKpi).map((data) => {
    const high = data.severities.filter((v) => String(v).toLowerCase() === 'high').length;
    const medium = data.severities.filter((v) => String(v).toLowerCase() === 'medium').length;
    const low = data.severities.filter((v) => String(v).toLowerCase() === 'low').length;
    const severityNote = [high && `${high} alta`, medium && `${medium} media`, low && `${low} baja`].filter(Boolean).join(', ') || 'diversa';
    return `${data.label}: ${data.severities.length} hallazgo(s), severidad ${severityNote}.`;
  });

  return [
    'Eres un experto en informes técnicos inmobiliarios. Genera un resumen ejecutivo para el informe de inspección.',
    '',
    'PROHIBIDO: NUNCA incluyas dirección, nombre de calle, comuna, barrio, ROL, propietario ni datos que identifiquen el inmueble. PROHIBIDO nombrar ambientes concretos (cocina, living, baño, dormitorio, etc.) o listar hallazgos uno a uno por ubicación.',
    '',
    'Datos de entrada (solo para contexto):',
    `- Score técnico del inmueble (STI): ${score}/100 - ${badgeText}`,
    `- Tipos de problema con hallazgos: ${summaryByType.length ? summaryByType.join(' ') : 'Sin hallazgos relevantes.'}`,
    '',
    'Formato y estilo OBLIGATORIOS:',
    '- Redacta en 2 o 3 párrafos narrativos continuos. NO uses viñetas ni listas de hallazgos.',
    '- Párrafo 1: Estado general del inmueble según el STI (qué indica el score en términos de condiciones de conservación y cumplimiento de estándares).',
    '- Párrafo 2: Sintetiza los hallazgos por NATURALEZA del problema (ej. "terminaciones y superficies", "fisuras en juntas de revestimientos", "grietas en cielos", "manchas en pintura"), como aspectos propios del uso normal y de mantención. No menciones ambientes ni detalles por zona.',
    '- Párrafo 3: Conclusión sobre el funcionamiento general del inmueble y que los hallazgos corresponden a detalles de conservación abordables con mantenciones menores, orientadas a preservar condición estética y buen estado.',
    '- Lenguaje profesional, claro y neutro. Sin costos ni presupuestos. Sin encabezados ni markdown.'
  ].join('\n');
}

/** STI mencionado en el texto (ej. "97 sobre 100"). */
export function extractStiMentionedInExecutiveSummary(text) {
  const t = String(text || '');
  const patterns = [
    /(?:score|puntaje|sti)[^\d]{0,40}(\d{1,3})\s*(?:\/\s*100|sobre\s*100)/i,
    /(\d{1,3})\s*\/\s*100/,
    /(\d{1,3})\s+sobre\s+100/i
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n);
    }
  }
  return null;
}

/** true si el resumen guardado cita un STI distinto al actual. */
export function isExecutiveSummaryStale(summary) {
  const text = String(summary?.case?.executiveSummary || '').trim();
  if (!text) return false;
  const current = Math.round(Math.max(0, Math.min(100, Number(summary?.score) ?? 0)));
  const mentioned = extractStiMentionedInExecutiveSummary(text);
  if (mentioned == null) return false;
  return mentioned !== current;
}

/**
 * Genera y persiste resumen ejecutivo si falta o está desactualizado.
 */
export async function ensureExecutiveSummary({
  prisma,
  storage,
  caseId,
  tenantId,
  scoreConfig,
  scoreConfigUpdatedAt,
  slotGroupTitleFromCode,
  log,
  force = false
}) {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: 'OPENAI_NOT_CONFIGURED' };
  }

  const summary = await getCaseSummary({
    prisma,
    storage,
    caseId,
    slotGroupTitleFromCode,
    scoreConfig,
    scoreConfigUpdatedAt,
    tenantId
  });
  if (!summary.ok) return { ok: false, error: summary.error || 'CASE_NOT_FOUND' };

  const existing = String(summary.case?.executiveSummary || '').trim();
  const stale = isExecutiveSummaryStale(summary);
  if (existing && !force && !stale) {
    return { ok: true, executiveSummary: existing, generated: false, stale: false };
  }

  if (String(summary.case?.status || '').toUpperCase() !== 'DONE') {
    return { ok: false, error: 'CASE_NOT_DONE' };
  }

  const prompt = buildExecutiveSummaryPrompt(summary, scoreConfig);
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1200
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: 'EMPTY_RESPONSE' };

    if (summary.case?.id) {
      await prisma.case.update({
        where: { id: summary.case.id },
        data: { executiveSummary: text }
      });
    }
    return { ok: true, executiveSummary: text, generated: true, stale: !!(existing && stale) };
  } catch (err) {
    log?.warn?.({ err: err?.message, caseId }, 'executive-summary-generate-failed');
    const raw = String(err?.message || '');
    if (/429|quota|insufficient_quota/i.test(raw)) {
      return {
        ok: false,
        error: 'OPENAI_QUOTA_EXCEEDED',
        message: 'Cuota de OpenAI agotada. Revisa billing en platform.openai.com y vuelve a intentar.'
      };
    }
    if (/401|invalid_api_key|Incorrect API key/i.test(raw)) {
      return { ok: false, error: 'OPENAI_AUTH_FAILED', message: 'API key de OpenAI inválida en el servidor.' };
    }
    return { ok: false, error: 'GENERATION_FAILED', message: raw || 'Error al generar el resumen ejecutivo.' };
  }
}
