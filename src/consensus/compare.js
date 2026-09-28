/**
 * Compara por código (reglas 9.1–9.4), no por texto libre.
 */
import {
  CONSENSUS_STATUS,
  EVALUABILITY,
  analysisSeverity,
  detectedFindingCodes,
  normalizeEvaluability,
  normalizeSeverity,
  primaryObservation
} from './schema.js';
import { isOkConfirmCode } from './taxonomy.js';

function codesKey(codes) {
  return (codes || []).slice().sort().join('|');
}

export function compareAnalyses(analysisA, analysisB, { providerAFailed = false, providerBFailed = false } = {}) {
  if (providerAFailed && providerBFailed) {
    return {
      consensusStatus: CONSENSUS_STATUS.PROVIDER_FAIL,
      codesA: [],
      codesB: [],
      severityA: null,
      severityB: null
    };
  }
  if (providerAFailed || providerBFailed) {
    return {
      consensusStatus: CONSENSUS_STATUS.PROVIDER_FAIL,
      codesA: detectedFindingCodes(analysisA),
      codesB: detectedFindingCodes(analysisB),
      severityA: analysisSeverity(analysisA),
      severityB: analysisSeverity(analysisB)
    };
  }

  const evalA = normalizeEvaluability(analysisA?.evaluability);
  const evalB = normalizeEvaluability(analysisB?.evaluability);

  // 9.1 evaluabilidad
  if (evalA !== evalB) {
    return {
      consensusStatus: CONSENSUS_STATUS.DISAGREE_EVALUABILITY,
      codesA: detectedFindingCodes(analysisA),
      codesB: detectedFindingCodes(analysisB),
      severityA: analysisSeverity(analysisA),
      severityB: analysisSeverity(analysisB)
    };
  }

  if (evalA === EVALUABILITY.NOT_EVALUABLE && evalB === EVALUABILITY.NOT_EVALUABLE) {
    return {
      consensusStatus: CONSENSUS_STATUS.AGREE,
      codesA: [],
      codesB: [],
      severityA: null,
      severityB: null
    };
  }

  const codesA = detectedFindingCodes(analysisA);
  const codesB = detectedFindingCodes(analysisB);
  const okA = primaryObservation(analysisA);
  const okB = primaryObservation(analysisB);
  const confirmA = okA && isOkConfirmCode(okA.code) ? okA.code : null;
  const confirmB = okB && isOkConfirmCode(okB.code) ? okB.code : null;

  // 9.2 hallazgo (códigos de defecto)
  if (codesKey(codesA) !== codesKey(codesB)) {
    return {
      consensusStatus: CONSENSUS_STATUS.DISAGREE_FINDING,
      codesA,
      codesB,
      severityA: analysisSeverity(analysisA),
      severityB: analysisSeverity(analysisB)
    };
  }

  // Confirmación OK distinta (p. ej. RCD_PRESENT vs silencio) no es discrepancia de hallazgo
  // si ambos no tienen defectos.
  const sevA = analysisSeverity(analysisA);
  const sevB = analysisSeverity(analysisB);

  // 9.3 severidad
  if (normalizeSeverity(sevA) !== normalizeSeverity(sevB)) {
    return {
      consensusStatus: CONSENSUS_STATUS.DISAGREE_SEVERITY,
      codesA,
      codesB,
      severityA: sevA,
      severityB: sevB
    };
  }

  // 9.4 acuerdo
  return {
    consensusStatus: CONSENSUS_STATUS.AGREE,
    codesA,
    codesB,
    severityA: sevA,
    severityB: sevB,
    confirmCode: confirmA || confirmB || null
  };
}

export function needsJudge(consensusStatus) {
  return consensusStatus && consensusStatus !== CONSENSUS_STATUS.AGREE;
}
