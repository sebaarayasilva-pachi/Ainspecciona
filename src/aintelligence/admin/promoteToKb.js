import crypto from 'node:crypto';
import { normalizeScoreConfig } from '../../scoring/scoringV2_2.js';

function buildExampleGuidance(feedback) {
  const human = feedback.humanLabel || {};
  const snap = feedback.aiSnapshot || {};
  const aiSignals = Array.isArray(snap.signals_detected) ? snap.signals_detected.join(', ') : '';
  const parts = [];

  if (human.isAntiExample || human.feedbackType === 'anti_example') {
    parts.push(
      `ANTI-EJEMPLO: no clasificar como hallazgo del KPI si solo se observa: ${aiSignals || snap.description || '—'}.`
    );
  }

  if (human.feedbackType === 'slot_mismatch') {
    parts.push('La imagen no corresponde al slot/planItem solicitado; matches_slot debe ser false.');
  }

  if (human.notes) parts.push(String(human.notes));
  if (human.guidance) parts.push(String(human.guidance));

  return parts.join(' ').trim();
}

/**
 * Agrega un AiFeedback aprobado a aiFindingExamples en score-config.
 * @param {object} feedback - fila Prisma AiFeedback
 * @param {object} scoreConfig
 * @param {{ signal?: string, severity?: string, guidance?: string }} [overrides]
 */
export function buildFindingExampleFromFeedback(feedback, overrides = {}) {
  const human = feedback.humanLabel || {};
  const kpiKey = String(feedback.kpiKey || feedback.aiSnapshot?.kpiKey || '').toUpperCase();
  const signal = String(overrides.signal || human.signal || '').trim();
  if (!kpiKey || !signal) {
    const err = new Error('MISSING_SIGNAL_OR_KPI');
    err.code = 'VALIDATION';
    throw err;
  }

  const severity = String(overrides.severity || human.severity || '').toLowerCase();
  const guidance =
    String(overrides.guidance || '').trim() ||
    buildExampleGuidance({
      humanLabel: human,
      aiSnapshot: feedback.aiSnapshot
    });

  return {
    id: `afb_${String(feedback.id).replace(/-/g, '').slice(0, 12)}`,
    kpiKey,
    signal,
    severity: ['low', 'medium', 'high', 'none'].includes(severity) ? severity : '',
    guidance,
    active: true,
    createdAt: new Date().toISOString()
  };
}

/**
 * @param {object} feedback
 * @param {object} currentConfig
 * @param {object} [overrides]
 */
export function appendFindingExampleToConfig(feedback, currentConfig, overrides = {}) {
  const example = buildFindingExampleFromFeedback(feedback, overrides);
  const normalized = normalizeScoreConfig(currentConfig || {});
  const existing = normalized.aiFindingExamples || [];

  const dup = existing.find(
    (e) =>
      String(e.kpiKey).toUpperCase() === example.kpiKey &&
      String(e.signal).trim().toLowerCase() === example.signal.toLowerCase()
  );
  if (dup) {
    return { config: normalized, example: dup, duplicate: true };
  }

  normalized.aiFindingExamples = [...existing, example].slice(-200);
  return { config: normalizeScoreConfig(normalized), example, duplicate: false };
}

export function feedbackPayloadFingerprint(feedback) {
  return feedback.payloadFingerprint || null;
}

export function stableFeedbackId() {
  return crypto.randomUUID();
}
