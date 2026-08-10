const FEEDBACK_TYPES = new Set([
  'correction',
  'confirmation',
  'anti_example',
  'slot_mismatch',
  'insufficient_evidence'
]);

const SEVERITIES = new Set(['low', 'medium', 'high', 'none']);

function trimStr(v) {
  return String(v ?? '').trim();
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => trimStr(x)).filter(Boolean);
}

/**
 * @param {object} body
 * @returns {{ ok: true, normalized: object } | { ok: false, code: string, message: string, field?: string }}
 */
export function validatePropertyCheckFeedback(body) {
  const feedbackId = trimStr(body?.feedbackId);
  const externalInspectionId = trimStr(body?.externalInspectionId);
  const captureId = trimStr(body?.captureId);
  const planItemId = trimStr(body?.planItemId);

  if (!feedbackId) {
    return { ok: false, code: 'VALIDATION', message: 'feedbackId requerido.', field: 'feedbackId' };
  }
  if (!externalInspectionId) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'externalInspectionId requerido.',
      field: 'externalInspectionId'
    };
  }
  if (!captureId) {
    return { ok: false, code: 'VALIDATION', message: 'captureId requerido.', field: 'captureId' };
  }
  if (!planItemId) {
    return { ok: false, code: 'VALIDATION', message: 'planItemId requerido.', field: 'planItemId' };
  }

  const image = body?.image;
  const hasUrl = Boolean(trimStr(image?.url));
  const hasBase64 = Boolean(trimStr(image?.base64));
  if (!hasUrl && !hasBase64) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'image.url o image.base64 requerido.',
      field: 'image'
    };
  }

  const snap = body?.aiSnapshot;
  if (!snap || typeof snap !== 'object') {
    return { ok: false, code: 'VALIDATION', message: 'aiSnapshot requerido.', field: 'aiSnapshot' };
  }

  const kpiKey = trimStr(snap.kpiKey).toUpperCase();
  const description = trimStr(snap.description);
  const kpiAnalysis = trimStr(snap.kpi_analysis);
  const signalsDetected = asStringArray(snap.signals_detected);
  const proposedSeverity = trimStr(snap.proposed_severity).toLowerCase();

  if (!kpiKey) {
    return { ok: false, code: 'VALIDATION', message: 'aiSnapshot.kpiKey requerido.', field: 'aiSnapshot.kpiKey' };
  }
  if (!description) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'aiSnapshot.description requerido.',
      field: 'aiSnapshot.description'
    };
  }
  if (!kpiAnalysis) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'aiSnapshot.kpi_analysis requerido.',
      field: 'aiSnapshot.kpi_analysis'
    };
  }
  if (!proposedSeverity || !SEVERITIES.has(proposedSeverity)) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'aiSnapshot.proposed_severity inválido (low|medium|high|none).',
      field: 'aiSnapshot.proposed_severity'
    };
  }

  const human = body?.humanLabel;
  if (!human || typeof human !== 'object') {
    return { ok: false, code: 'VALIDATION', message: 'humanLabel requerido.', field: 'humanLabel' };
  }

  const feedbackType = trimStr(human.feedbackType).toLowerCase();
  if (!FEEDBACK_TYPES.has(feedbackType)) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'humanLabel.feedbackType inválido.',
      field: 'humanLabel.feedbackType'
    };
  }

  let signal = trimStr(human.signal);
  let severity = trimStr(human.severity).toLowerCase();
  const needsLabel = feedbackType === 'correction' || feedbackType === 'anti_example';

  if (needsLabel) {
    if (!signal) {
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'humanLabel.signal requerido cuando feedbackType=correction o anti_example.',
        field: 'humanLabel.signal'
      };
    }
    if (!severity || !SEVERITIES.has(severity)) {
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'humanLabel.severity requerido (low|medium|high|none).',
        field: 'humanLabel.severity'
      };
    }
  } else if (feedbackType === 'confirmation' && !signal) {
    signal = signalsDetected[0] || description.slice(0, 200);
    severity = severity || trimStr(snap.final_severity).toLowerCase() || proposedSeverity;
  }

  if (severity && !SEVERITIES.has(severity)) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'humanLabel.severity inválido.',
      field: 'humanLabel.severity'
    };
  }

  const submittedAtRaw = trimStr(body?.submittedAt);
  let submittedAt = null;
  if (submittedAtRaw) {
    const d = new Date(submittedAtRaw);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, code: 'VALIDATION', message: 'submittedAt inválido.', field: 'submittedAt' };
    }
    submittedAt = d;
  }

  const photoPlan = body?.photoPlan;
  const analyzeContext = body?.analyzeContext;
  const reviewer = body?.reviewer;

  const normalized = {
    feedbackId,
    externalInspectionId,
    captureId,
    planItemId,
    sequence: body?.sequence != null && Number.isFinite(Number(body.sequence)) ? Number(body.sequence) : null,
    photoPlan:
      photoPlan && typeof photoPlan === 'object'
        ? {
            planId: trimStr(photoPlan.planId) || null,
            planVersion: photoPlan.planVersion != null ? String(photoPlan.planVersion) : null
          }
        : null,
    image: {
      url: hasUrl ? trimStr(image.url) : null,
      base64: hasBase64 ? trimStr(image.base64) : null,
      mimeType: trimStr(image.mimeType) || null,
      sha256: trimStr(image.sha256).toLowerCase() || null
    },
    analyzeContext:
      analyzeContext && typeof analyzeContext === 'object'
        ? {
            requestId: trimStr(analyzeContext.requestId) || null,
            model: trimStr(analyzeContext.model) || null,
            analyzedAt: trimStr(analyzeContext.analyzedAt) || null
          }
        : null,
    aiSnapshot: {
      kpiKey,
      description,
      kpi_analysis: kpiAnalysis,
      signals_detected: signalsDetected,
      proposed_severity: proposedSeverity,
      final_severity: snap.final_severity != null ? trimStr(snap.final_severity).toLowerCase() || null : null,
      score_penalty_applied:
        snap.score_penalty_applied != null && Number.isFinite(Number(snap.score_penalty_applied))
          ? Number(snap.score_penalty_applied)
          : null,
      matches_slot: snap.matches_slot != null ? Boolean(snap.matches_slot) : null,
      match_confidence:
        snap.match_confidence != null && Number.isFinite(Number(snap.match_confidence))
          ? Number(snap.match_confidence)
          : null
    },
    humanLabel: {
      feedbackType,
      signal: signal || null,
      severity: severity || null,
      guidance: trimStr(human.guidance) || null,
      isAntiExample: Boolean(human.isAntiExample) || feedbackType === 'anti_example',
      notes: trimStr(human.notes) || null
    },
    reviewer:
      reviewer && typeof reviewer === 'object'
        ? {
            externalUserId: trimStr(reviewer.externalUserId) || null,
            displayName: trimStr(reviewer.displayName) || null,
            role: trimStr(reviewer.role) || null
          }
        : null,
    submittedAt
  };

  return { ok: true, normalized };
}
