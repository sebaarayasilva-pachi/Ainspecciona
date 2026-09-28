/**
 * Resuelve el veredicto final. Umbrales de Judge desde config, no hardcode.
 */
import { normalizeConsensusConfig } from './config.js';
import {
  CONSENSUS_STATUS,
  EVALUABILITY,
  FINAL_STATUS,
  analysisSeverity,
  detectedFindingCodes,
  normalizeAnalysis,
  normalizeEvaluability,
  normalizeJudgeVerdict,
  normalizeSeverity,
  primaryObservation
} from './schema.js';
import { isOkConfirmCode, isSafetyCode } from './taxonomy.js';

export function isHighSafetyVerdict({ code, severity, safetyCodes }) {
  const sev = normalizeSeverity(severity);
  return sev === 'HIGH' && isSafetyCode(code, safetyCodes);
}

/**
 * >= accept → acepta
 * review–accept → acepta si no es HIGH safety
 * HIGH safety exige judgeHighSafety
 * < review o Judge falla → UNRESOLVED
 */
export function acceptJudgeDecision(judge, { safetyCodes, consensus } = {}) {
  const cfg = normalizeConsensusConfig(consensus || {});
  const normalized = normalizeJudgeVerdict(judge);
  const confidence = Number(normalized.confidence);
  if (!Number.isFinite(confidence)) return false;
  const code = normalized.finalFindingCode
    || judge?.finalFindingCode
    || primaryObservation({ observations: normalized.observations || judge?.observations || [] })?.code;
  const highSafety = isHighSafetyVerdict({
    code,
    severity: normalized.severity || judge?.severity,
    safetyCodes: safetyCodes || cfg.safetyCodes
  });
  if (highSafety) return confidence >= cfg.judgeHighSafety;
  if (confidence >= cfg.judgeAccept) return true;
  if (confidence >= cfg.judgeReview) return true;
  return false;
}

/**
 * Token de voto 2/3: hallazgo principal, OK, o NOT_EVALUABLE.
 */
export function voteKey(analysis) {
  if (!analysis) return 'MISSING';
  if (normalizeEvaluability(analysis.evaluability) === EVALUABILITY.NOT_EVALUABLE) {
    return 'NOT_EVALUABLE';
  }
  const primary = primaryObservation(analysis);
  if (primary && primary.detected && !isOkConfirmCode(primary.code)) return primary.code;
  return 'OK';
}

export function voteKeyFromJudge(verdict, normalizedJudge) {
  if (normalizeEvaluability(verdict?.evaluability) === EVALUABILITY.NOT_EVALUABLE) {
    return 'NOT_EVALUABLE';
  }
  if (verdict?.detected === false || normalizeSeverity(verdict?.severity) === 'OK') {
    const codes = detectedFindingCodes(normalizedJudge);
    if (!codes.length) return 'OK';
  }
  const primary = primaryObservation(normalizedJudge);
  if (primary && primary.detected && !isOkConfirmCode(primary.code)) return primary.code;
  const code = verdict?.finalFindingCode;
  if (code && !isOkConfirmCode(code) && normalizeSeverity(verdict?.severity) !== 'OK') {
    return code;
  }
  return 'OK';
}

/**
 * 2/3: A y B ya coinciden, o el juez elige A/B con el mismo hallazgo (o OK).
 * NEITHER o un tercer código → sin mayoría (ITO).
 */
export function twoThirdsMajority({ analysisA, analysisB, verdict, normalizedJudge } = {}) {
  const keyA = voteKey(analysisA);
  const keyB = voteKey(analysisB);
  const keyJ = voteKeyFromJudge(verdict, normalizedJudge);
  if (keyA === keyB && keyA !== 'MISSING') {
    return { ok: true, key: keyA, reason: 'analysts_agree' };
  }
  const side = verdict?.chosenSide;
  if (side === 'NEITHER') {
    return { ok: false, key: keyJ, reason: 'neither' };
  }
  if (side === 'A' && (keyJ === keyA || keyJ === 'MISSING')) {
    return { ok: true, key: keyA, reason: 'judge_a' };
  }
  if (side === 'B' && (keyJ === keyB || keyJ === 'MISSING')) {
    return { ok: true, key: keyB, reason: 'judge_b' };
  }
  if (side !== 'NEITHER' && keyJ !== 'MISSING' && (keyJ === keyA || keyJ === keyB)) {
    return { ok: true, key: keyJ, reason: 'judge_key' };
  }
  return { ok: false, key: keyJ, reason: 'no_majority' };
}

export function verdictFromAgreed(analysis, { reviewed = false } = {}) {
  const evalab = normalizeEvaluability(analysis?.evaluability);
  if (evalab === EVALUABILITY.NOT_EVALUABLE) {
    return {
      finalStatus: FINAL_STATUS.NO_EVALUABLE,
      finalFindingCode: null,
      finalSeverity: null,
      finalConfidence: null
    };
  }
  const findings = detectedFindingCodes(analysis);
  const primary = primaryObservation(analysis);
  if (!findings.length) {
    return {
      finalStatus: FINAL_STATUS.CONFIRMED_OK,
      finalFindingCode: primary && isOkConfirmCode(primary.code) ? primary.code : null,
      finalSeverity: 'OK',
      finalConfidence: primary?.confidence ?? 0.9
    };
  }
  return {
    finalStatus: reviewed ? FINAL_STATUS.REVIEWED_FINDING : FINAL_STATUS.CONFIRMED_FINDING,
    finalFindingCode: primary?.code || findings[0],
    finalSeverity: analysisSeverity(analysis) || normalizeSeverity(primary?.severity),
    finalConfidence: primary?.confidence ?? 0.85
  };
}

export function resolveConsensus({
  analysisA,
  analysisB,
  compareResult,
  judge = null,
  judgeFailed = false,
  consensusConfig = {}
} = {}) {
  const cfg = normalizeConsensusConfig(consensusConfig);
  const status = compareResult?.consensusStatus || CONSENSUS_STATUS.PROVIDER_FAIL;

  if (status === CONSENSUS_STATUS.AGREE) {
    const sample = normalizeEvaluability(analysisA?.evaluability) === EVALUABILITY.NOT_EVALUABLE
      ? analysisA
      : (detectedFindingCodes(analysisA).length ? analysisA : analysisB) || analysisA;
    return {
      ...verdictFromAgreed(sample),
      judgeTriggered: false
    };
  }

  if (status === CONSENSUS_STATUS.PROVIDER_FAIL && !judge && !judgeFailed) {
    const survivor = analysisA || analysisB;
    if (survivor) {
      return {
        ...verdictFromAgreed(survivor),
        judgeTriggered: false
      };
    }
  }

  const judgeTriggered = true;
  if (judgeFailed || !judge) {
    return {
      finalStatus: FINAL_STATUS.UNRESOLVED,
      finalFindingCode: null,
      finalSeverity: null,
      finalConfidence: null,
      judgeTriggered
    };
  }

  const verdict = normalizeJudgeVerdict(judge);
  const normalizedJudge = normalizeAnalysis({
    evaluability: verdict.evaluability,
    observations: Array.isArray(verdict.observations) && verdict.observations.length
      ? verdict.observations
      : [{
        code: verdict.finalFindingCode,
        detected: verdict.detected !== false && !isOkConfirmCode(verdict.finalFindingCode) && normalizeSeverity(verdict.severity) !== 'OK',
        severity: verdict.severity,
        confidence: verdict.confidence,
        evidence: []
      }],
    observation: verdict.rationale || ''
  });
  const judgeConfidence = Number.isFinite(Number(verdict.confidence)) ? Number(verdict.confidence) : null;
  const majority = twoThirdsMajority({
    analysisA,
    analysisB,
    verdict,
    normalizedJudge
  });
  if (!majority.ok) {
    return {
      finalStatus: FINAL_STATUS.UNRESOLVED,
      finalFindingCode: verdict.finalFindingCode || primaryObservation(normalizedJudge)?.code || null,
      finalSeverity: analysisSeverity(normalizedJudge),
      finalConfidence: judgeConfidence,
      judgeTriggered
    };
  }

  if (normalizeEvaluability(normalizedJudge.evaluability) === EVALUABILITY.NOT_EVALUABLE) {
    if (!acceptJudgeDecision({ ...verdict, finalFindingCode: null, severity: 'OK' }, { consensus: cfg })) {
      return {
        finalStatus: FINAL_STATUS.UNRESOLVED,
        finalFindingCode: null,
        finalSeverity: null,
        finalConfidence: judgeConfidence,
        judgeTriggered
      };
    }
    return {
      finalStatus: FINAL_STATUS.NO_EVALUABLE,
      finalFindingCode: null,
      finalSeverity: null,
      finalConfidence: judgeConfidence,
      judgeTriggered
    };
  }

  const accepted = acceptJudgeDecision({
    ...verdict,
    finalFindingCode: verdict.finalFindingCode || primaryObservation(normalizedJudge)?.code,
    severity: verdict.severity || analysisSeverity(normalizedJudge),
    confidence: verdict.confidence
  }, { consensus: cfg });

  if (!accepted) {
    return {
      finalStatus: FINAL_STATUS.UNRESOLVED,
      finalFindingCode: verdict.finalFindingCode || primaryObservation(normalizedJudge)?.code || null,
      finalSeverity: analysisSeverity(normalizedJudge),
      finalConfidence: judgeConfidence,
      judgeTriggered
    };
  }

  const reviewed = verdictFromAgreed(normalizedJudge, { reviewed: true });
  return { ...reviewed, judgeTriggered };
}
