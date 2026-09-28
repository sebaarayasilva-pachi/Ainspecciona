/**
 * Contrato único del slot para el informe (web + PDF).
 * El 2/3 escribe code/severity/message en el Slot, pero a veces deja
 * openai.parsed del primer pase (“sin hallazgos”). Aquí se unifica.
 */
import { effectiveSlotAnalysis } from '../analysis/applySlotReviewCorrection.js';
import { isOkConfirmCode } from '../consensus/taxonomy.js';
import { classifyKpiFromSlot } from '../scoring/scoringV2_2.js';
import {
  CODE_TO_V4_TYPE,
  inferImpactType,
  slotScoreFromSeverity,
  textHasCoherenceNoFinding
} from '../scoring/scoringV4.js';

const QUALITY_ISSUE_CODES = /image_quality_issue|imagequalityissue|calidad\s*(de\s*)?(imagen|foto)|retomar\s*foto|falta\s*de\s*claridad/i;
const QUALITY_ISSUE_SIGNALS = [
  /image_quality_issue/i, /imagequalityissue/i, /calidad\s*(de\s*)?(imagen|foto)/i,
  /retomar\s*(la\s*)?foto/i, /falta\s*de\s*claridad/i, /imagen\s*borrosa/i, /blur/i, /poca\s*iluminación/i
];

const OK_FINDINGS = 'Conclusión: no se observan hallazgos relevantes en esta evidencia.';

export function isQualityIssueCode(code) {
  if (!code || typeof code !== 'string') return false;
  const c = String(code).trim();
  return QUALITY_ISSUE_CODES.test(c) || c.toLowerCase().includes('image_quality');
}

export function removeRetakePhrases(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\s*No\s+se\s+puede\s+evaluar\s+por\s+falta\s+de\s*claridad\.?\s*/gi, ' ')
    .replace(/\s*Se\s+recomienda\s+retomar\s+(la\s+)?fotograf[ií]a\.?\s*/gi, ' ')
    .replace(/\s*Se\s+sugiere\s+retomar\s+(la\s+)?foto\.?\s*/gi, ' ')
    .replace(/\s*Retomar\s+(la\s+)?fotograf[ií]a\s+recomendado\.?\s*/gi, ' ')
    .replace(/\s*,\s*lo\s+que\s+dificulta\s+(la\s+)?visibilidad\.?\s*/gi, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function filterQualitySignals(signals) {
  if (!Array.isArray(signals)) return [];
  return signals.filter((sig) => {
    const s = String(sig || '').toLowerCase();
    return !QUALITY_ISSUE_SIGNALS.some((p) => p.test(s)) && !s.includes('image_quality');
  });
}

const JUDGE_META_SENTENCE = /analysis_[ab]|chosenside|ambos an[aá]lisis|el an[aá]lisis [ab]\b|an[aá]lisis [ab]\s+a[nñ]ade/i;

/** Quita jerga del juez 2/3 que no debe ir al informe del cliente. */
export function sanitizeReportNarrative(text) {
  let out = String(text || '');
  out = out
    .replace(/\s*Ambos análisis coinciden[\s\S]*$/i, '')
    .replace(/\s*El análisis [AB]\s+añade[\s\S]*$/i, '')
    .replace(/\s*análisis [AB]\s+añade[\s\S]*$/i, '')
    .replace(/\s*El hallazgo principal de analysis[_\s]?[ab][\s\S]*$/i, '')
    .replace(/\s*analysis_[ab]\b[\s\S]*$/i, '')
    .replace(/\s*chosenSide\b[\s\S]*$/i, '')
    .replace(/\(\s*(CORROSION|FLOOR_GAP|EXPOSED_WIRE|HUMIDITY_VISIBLE|RCD_PRESENT|RCD_MISSING|WALL_CRACK|FURNITURE_SCRATCH)\s*\)/gi, '');
  out = out
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !JUDGE_META_SENTENCE.test(s))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
  return out;
}

export function looksLikeNoFinding(text) {
  return textHasCoherenceNoFinding(text);
}

function firstSentences(text, max = 2) {
  const parts = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.slice(0, max).join(' ');
}

export function assembleReportSlot(slot, {
  review = null,
  scoreConfig = null,
  slotGroupTitleFromCode = null,
  storage = null
} = {}) {
  const effective = effectiveSlotAnalysis(slot, review) || slot;
  const analysisCode = effective.analysisCode;
  const analysisSeverity = effective.analysisSeverity;
  const analysisMessage = effective.analysisMessage;
  const slotDebug = effective.analysisDebug || slot.analysisDebug || {};
  const parsed = slotDebug?.openai?.parsed && typeof slotDebug.openai.parsed === 'object'
    ? slotDebug.openai.parsed
    : {};

  const omitted = String(slot.status || '').toUpperCase() === 'NOT_CAPTURABLE'
    || String(analysisCode || '').toUpperCase() === 'NOT_CAPTURABLE';
  const quality = isQualityIssueCode(analysisCode);
  const okConfirm = isOkConfirmCode(analysisCode);
  const findingCode = (quality || omitted || okConfirm) ? 'OK' : (analysisCode || 'OK');
  const severity = (quality || omitted || okConfirm) ? null : (analysisSeverity || null);
  const rawMessage = omitted ? '' : removeRetakePhrases(analysisMessage || '');
  const message = sanitizeReportNarrative(rawMessage);

  const group = slotGroupTitleFromCode
    ? slotGroupTitleFromCode(slot.slotCode)
    : { groupKey: 'OTHER', groupTitle: 'Otros' };
  const kpiKey = slot.kpiKey || classifyKpiFromSlot({
    slotCode: slot.slotCode,
    title: slot.title
  }, scoreConfig?.slotKpiMap);

  const findingTypeFromCode = Object.prototype.hasOwnProperty.call(
    CODE_TO_V4_TYPE,
    String(findingCode || '').toUpperCase()
  ) ? CODE_TO_V4_TYPE[String(findingCode || '').toUpperCase()] : undefined;
  const rawFindingType = parsed.findingType;
  const findingType = severity
    ? (findingTypeFromCode ?? (rawFindingType && String(rawFindingType).toUpperCase() !== 'NONE' ? rawFindingType : null))
    : null;
  const impactType = findingType
    ? inferImpactType(findingType, scoreConfig)
    : (severity ? (parsed.impactType || null) : null);

  const parsedDesc = removeRetakePhrases(parsed.description || '');

  let descriptionText;
  let findingsText;
  if (omitted) {
    descriptionText = '';
    findingsText = '';
  } else if (severity) {
    findingsText = message || 'Se observa una condición visible que se registra en este criterio.';
    descriptionText = firstSentences(findingsText, 2);
  } else {
    findingsText = OK_FINDINGS;
    descriptionText = parsedDesc || firstSentences(message, 2) || `Registro visual del área inspeccionada: ${slot.title || slot.slotCode || 'sector evaluado'}.`;
  }

  const cleanParsed = {
    ...parsed,
    signals_detected: filterQualitySignals(parsed.signals_detected || []),
    description: descriptionText,
    kpi_analysis: findingsText
  };

  const slotScore = omitted ? null : slotScoreFromSeverity(severity, scoreConfig);
  const scorePenaltyApplied = (slotScore == null || !severity)
    ? 0
    : Math.max(0, 100 - slotScore);

  return {
    id: slot.id,
    slotCode: slot.slotCode,
    title: slot.title,
    instructions: slot.instructions,
    status: slot.status,
    omitted,
    findingCode,
    severity,
    confidence: slot.analysisConfidence,
    message: omitted ? '' : message,
    descriptionText,
    findingsText,
    slotScore,
    analysisDebug: { openai: { parsed: cleanParsed } },
    analyzedAt: slot.analyzedAt ? new Date(slot.analyzedAt).toISOString() : null,
    source: String(slotDebug?.source || '').toUpperCase() === 'OPENAI' ? 'OPENAI' : (findingCode ? 'V1' : 'V1'),
    groupKey: group.groupKey,
    groupTitle: group.groupTitle,
    kpiKey,
    evaluability: parsed.evaluability || null,
    impactType,
    findingType,
    analysisAuthor: slotDebug?.consensus?.author || null,
    severitySource: review
      ? 'human_review_correction'
      : String(parsed.severity_source || slotDebug?.severitySource || (severity ? 'consensus' : 'none')),
    scorePenaltyApplied,
    expectedComponent: slotDebug?.slotMatch?.expectedComponent || null,
    detectedComponent: slotDebug?.slotMatch?.detectedComponent || null,
    photoUrl: slot.photo?.filePath && storage ? storage.publicUrl(slot.photo.filePath) : null,
    photoId: slot.photoId ?? slot.photo?.id ?? null,
    humanReview: review
      ? { verdict: review.verdict, humanCode: review.humanCode, humanSeverity: review.humanSeverity }
      : null
  };
}
