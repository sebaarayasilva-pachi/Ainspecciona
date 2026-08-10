/**
 * Aplica un veredicto ITO (SlotReview) al análisis del Slot que consume el informe.
 * La IA original se conserva en analysisDebug.aiBeforeHumanReview.
 */

function normalizeSeverity(value, humanCode) {
  const code = String(humanCode || '').toUpperCase();
  if (!code || code === 'OK' || code === 'NOT_CAPTURABLE') return null;
  const s = String(value || '').toLowerCase();
  return ['low', 'medium', 'high'].includes(s) ? s : null;
}

/**
 * @param {object} slot - Slot actual (analysis* + analysisDebug)
 * @param {object} review - { verdict, humanCode, humanSeverity, humanMessage, note?, reviewerEmail? }
 * @returns {null | { analysisCode: string, analysisSeverity: string|null, analysisMessage: string, analysisDebug: object }}
 */
export function buildSlotPatchFromReview(slot, review) {
  if (!slot || !review) return null;
  if (String(review.verdict || '').toLowerCase() !== 'corrected') return null;

  const humanCode = String(review.humanCode || 'OK').toUpperCase().slice(0, 64) || 'OK';
  const humanSeverity = normalizeSeverity(review.humanSeverity, humanCode);
  const humanMessage =
    String(review.humanMessage || '').trim() ||
    (humanCode === 'OK'
      ? 'Corrección ITO: sin hallazgos relevantes en esta evidencia.'
      : String(slot.analysisMessage || '').trim() || humanCode);

  const prevDebug = slot.analysisDebug && typeof slot.analysisDebug === 'object' ? slot.analysisDebug : {};
  const prevParsed =
    prevDebug?.openai?.parsed && typeof prevDebug.openai.parsed === 'object' ? prevDebug.openai.parsed : {};

  const clearedSignals = humanCode === 'OK' || !humanSeverity;
  const nextParsed = {
    ...prevParsed,
    kpi_analysis: humanMessage,
    signals_detected: clearedSignals ? [] : Array.isArray(prevParsed.signals_detected) ? prevParsed.signals_detected : [],
    details: clearedSignals ? [] : Array.isArray(prevParsed.details) ? prevParsed.details : [],
    proposed_severity: humanSeverity || 'none',
    severity_reason: 'Corrección aplicada por revisión ITO.',
    final_severity: humanSeverity,
    severity_source: 'human_review_correction',
    score_penalty_applied: 0
  };
  if (humanCode === 'OK') {
    nextParsed.description =
      String(prevParsed.description || '').trim() ||
      'Evidencia revisada por ITO; no se confirman hallazgos relevantes.';
  }

  return {
    analysisCode: humanCode,
    analysisSeverity: humanSeverity,
    analysisMessage: humanMessage,
    analysisDebug: {
      ...prevDebug,
      aiBeforeHumanReview: prevDebug.aiBeforeHumanReview || {
        analysisCode: slot.analysisCode,
        analysisSeverity: slot.analysisSeverity,
        analysisMessage: slot.analysisMessage,
        openaiParsed: prevParsed
      },
      humanReviewApplied: {
        at: new Date().toISOString(),
        verdict: 'corrected',
        humanCode,
        humanSeverity,
        humanMessage,
        note: review.note || null,
        reviewerEmail: review.reviewerEmail || null
      },
      severitySource: 'human_review_correction',
      scorePenaltyApplied: 0,
      openai: {
        ...(prevDebug.openai || {}),
        parsed: nextParsed
      }
    }
  };
}

/**
 * Vista efectiva para resumen/informe sin escribir en DB.
 * @returns {object} campos analysis* efectivos (+ analysisDebug si aplica)
 */
export function effectiveSlotAnalysis(slot, review) {
  if (!slot) return null;
  const patch = buildSlotPatchFromReview(slot, review);
  if (!patch) {
    return {
      analysisCode: slot.analysisCode,
      analysisSeverity: slot.analysisSeverity,
      analysisMessage: slot.analysisMessage,
      analysisDebug: slot.analysisDebug
    };
  }
  return patch;
}

/**
 * Persiste la corrección ITO en el Slot.
 * @returns {Promise<object|null>} patch aplicado o null
 */
export async function applySlotReviewCorrection(prisma, slot, review) {
  const patch = buildSlotPatchFromReview(slot, review);
  if (!patch || !prisma || !slot?.id) return null;
  await prisma.slot.update({
    where: { id: slot.id },
    data: {
      analysisCode: patch.analysisCode,
      analysisSeverity: patch.analysisSeverity,
      analysisMessage: patch.analysisMessage,
      analysisDebug: patch.analysisDebug,
      analyzedAt: new Date()
    }
  });
  return patch;
}
