/**
 * Pasa un veredicto de consenso (o una IA elegida por el ITO) al Slot oficial.
 */
import { isOkConfirmCode } from './taxonomy.js';
import {
  FINAL_STATUS,
  analysisSeverity,
  normalizeEvaluability,
  normalizeSeverity,
  primaryObservation
} from './schema.js';
import { sanitizeReportNarrative } from '../report/assembleReportSlot.js';

export const AUTHOR = {
  OPENAI_GEMINI: { key: 'openai_gemini', label: 'GPT-4o y Gemini' },
  OPENAI: { key: 'openai', label: 'GPT-4o' },
  GEMINI: { key: 'gemini', label: 'Gemini' },
  CLAUDE: { key: 'claude', label: 'Claude' },
  ITO: { key: 'ito', label: 'ITO' }
};

const WRITE_STATUSES = new Set([
  FINAL_STATUS.CONFIRMED_OK,
  FINAL_STATUS.CONFIRMED_FINDING,
  FINAL_STATUS.REVIEWED_FINDING,
  FINAL_STATUS.NO_EVALUABLE
]);

export function shouldWriteConsensusToSlot(finalStatus) {
  return WRITE_STATUSES.has(String(finalStatus || ''));
}

export function authorFromResolved({ finalStatus, judgeTriggered } = {}) {
  if (finalStatus === FINAL_STATUS.REVIEWED_FINDING || judgeTriggered) return AUTHOR.CLAUDE;
  return AUTHOR.OPENAI_GEMINI;
}

export function authorFromItoChoice(choice) {
  const k = String(choice || '').toLowerCase();
  if (k === 'openai' || k === 'gpt' || k === 'gpt-4o') return AUTHOR.OPENAI;
  if (k === 'gemini') return AUTHOR.GEMINI;
  if (k === 'claude') return AUTHOR.CLAUDE;
  return AUTHOR.ITO;
}

export function compactAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object' || analysis.error) {
    return analysis?.error ? { error: String(analysis.error) } : null;
  }
  const primary = primaryObservation(analysis);
  const findings = (analysis.observations || []).filter((o) => o.detected && !isOkConfirmCode(o.code));
  return {
    evaluability: analysis.evaluability || null,
    observation: String(analysis.observation || '').trim(),
    interpretation: String(analysis.interpretation || '').trim(),
    cause: String(analysis.cause || '').trim(),
    codes: findings.map((o) => o.code).filter(Boolean),
    severity: analysisSeverity(analysis),
    primaryCode: primary?.code || null,
    confidence: primary?.confidence ?? null
  };
}

function slotSeverity(sev) {
  const n = normalizeSeverity(sev);
  if (!n || n === 'OK') return null;
  return n.toLowerCase();
}

function messageFromAnalysis(analysis, fallback) {
  const text = [
    analysis?.observation,
    analysis?.interpretation,
    analysis?.cause
  ].map((s) => sanitizeReportNarrative(s)).filter(Boolean).join(' ');
  if (text) return text.slice(0, 4000);
  const primary = primaryObservation(analysis);
  if (primary?.code && primary.detected && !isOkConfirmCode(primary.code)) {
    return String(primary.code);
  }
  return sanitizeReportNarrative(fallback) || '';
}

/**
 * Patch de Slot a partir de un análisis canónico + autor.
 */
export function slotPatchFromAnalysis(slot, analysis, {
  author,
  finalStatus,
  finalFindingCode,
  finalSeverity,
  finalConfidence,
  engineVersion
} = {}) {
  const evalab = normalizeEvaluability(analysis?.evaluability);
  const notEval = evalab === 'NOT_EVALUABLE' || finalStatus === FINAL_STATUS.NO_EVALUABLE;
  const primary = primaryObservation(analysis);
  const codeFromFinal = finalFindingCode || primary?.code || null;
  const isOk = notEval
    || finalStatus === FINAL_STATUS.CONFIRMED_OK
    || !codeFromFinal
    || isOkConfirmCode(codeFromFinal)
    || (primary && (!primary.detected || isOkConfirmCode(primary.code)));

  const analysisCode = notEval
    ? 'NOT_EVALUABLE'
    : (isOk ? (isOkConfirmCode(codeFromFinal) ? codeFromFinal : 'OK') : codeFromFinal);
  const analysisSeverityOut = notEval || isOk
    ? null
    : slotSeverity(finalSeverity || analysisSeverity(analysis) || primary?.severity);
  const analysisMessage = notEval
    ? (messageFromAnalysis(analysis, 'La foto no permite evaluar este elemento.') || 'La foto no permite evaluar este elemento.')
    : messageFromAnalysis(analysis, isOk ? 'Sin hallazgos relevantes en esta evidencia.' : analysisCode);

  const prevDebug = slot?.analysisDebug && typeof slot.analysisDebug === 'object' ? slot.analysisDebug : {};
  const prevParsed = prevDebug?.openai?.parsed && typeof prevDebug.openai.parsed === 'object'
    ? prevDebug.openai.parsed
    : {};
  const winnerDescription = sanitizeReportNarrative(analysis?.observation || analysis?.description || '');
  const winnerKpi = sanitizeReportNarrative(analysis?.interpretation || analysis?.kpi_analysis || analysis?.cause || '');

  return {
    analysisCode,
    analysisSeverity: analysisSeverityOut,
    analysisMessage,
    analysisConfidence: Number.isFinite(Number(finalConfidence))
      ? Number(finalConfidence)
      : (Number.isFinite(Number(primary?.confidence)) ? Number(primary.confidence) : slot?.analysisConfidence ?? null),
    analysisDebug: {
      ...prevDebug,
      aiBeforeConsensus: prevDebug.aiBeforeConsensus || {
        analysisCode: slot?.analysisCode || null,
        analysisSeverity: slot?.analysisSeverity || null,
        analysisMessage: slot?.analysisMessage || null,
        openaiParsed: prevParsed
      },
      openai: {
        ...(prevDebug.openai && typeof prevDebug.openai === 'object' ? prevDebug.openai : {}),
        parsed: {
          ...prevParsed,
          description: winnerDescription || analysisMessage || prevParsed.description || '',
          kpi_analysis: isOk
            ? (winnerKpi || analysisMessage || 'Sin hallazgos relevantes en esta evidencia.')
            : (winnerKpi || analysisMessage || winnerDescription || prevParsed.kpi_analysis || ''),
          evaluability: evalab || prevParsed.evaluability || 'EVALUABLE'
        }
      },
      consensus: {
        author,
        finalStatus: finalStatus || null,
        engineVersion: engineVersion || null,
        appliedAt: new Date().toISOString()
      },
      severitySource: 'consensus',
      source: prevDebug.source || 'OPENAI'
    }
  };
}

export function winningAnalysis({
  analysisA,
  analysisB,
  judge,
  finalStatus,
  judgeTriggered
} = {}) {
  if (judgeTriggered && judge) {
    const side = String(judge.chosenSide || '').toUpperCase();
    const sideAnalysis = side === 'A' ? analysisA : side === 'B' ? analysisB : null;
    const judgeAsAnalysis = judge.analysis || judge;
    if (sideAnalysis && typeof sideAnalysis === 'object' && !sideAnalysis.error) {
      return {
        ...sideAnalysis,
        evaluability: judgeAsAnalysis.evaluability || sideAnalysis.evaluability,
        observations: Array.isArray(judgeAsAnalysis.observations) && judgeAsAnalysis.observations.length
          ? judgeAsAnalysis.observations
          : sideAnalysis.observations,
        observation: sanitizeReportNarrative(sideAnalysis.observation || sideAnalysis.description || ''),
        interpretation: sanitizeReportNarrative(sideAnalysis.interpretation || sideAnalysis.kpi_analysis || ''),
        cause: sanitizeReportNarrative(sideAnalysis.cause || '')
      };
    }
    return {
      ...judgeAsAnalysis,
      observation: sanitizeReportNarrative(judgeAsAnalysis.observation || judge.rationale || ''),
      interpretation: sanitizeReportNarrative(judgeAsAnalysis.interpretation || ''),
      cause: sanitizeReportNarrative(judgeAsAnalysis.cause || '')
    };
  }
  if (finalStatus === FINAL_STATUS.CONFIRMED_OK) {
    const aOk = analysisA && !((analysisA.observations || []).some((o) => o.detected && !isOkConfirmCode(o.code)));
    return aOk ? analysisA : (analysisB || analysisA);
  }
  const findingsA = (analysisA?.observations || []).filter((o) => o.detected && !isOkConfirmCode(o.code));
  return findingsA.length ? analysisA : (analysisB || analysisA);
}

export function analysisFromChoice(choice, { analysisOpenAI, analysisGemini, analysisClaude } = {}) {
  const k = String(choice || '').toLowerCase();
  if (k === 'openai' || k === 'gpt' || k === 'gpt-4o') return analysisOpenAI;
  if (k === 'gemini') return analysisGemini;
  if (k === 'claude') return analysisClaude?.analysis || analysisClaude;
  return null;
}

export async function applyConsensusPatch(prisma, slot, patch) {
  if (!prisma || !slot?.id || !patch) return null;
  await prisma.slot.update({
    where: { id: slot.id },
    data: {
      analysisCode: patch.analysisCode,
      analysisSeverity: patch.analysisSeverity,
      analysisMessage: patch.analysisMessage,
      analysisConfidence: patch.analysisConfidence,
      analysisDebug: patch.analysisDebug,
      analyzedAt: new Date()
    }
  });
  return patch;
}
