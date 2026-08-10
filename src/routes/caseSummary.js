import { computeScoringV2_2, badgeFromScore, classifyKpiFromSlot, kpiPenaltyFromSeverity } from '../scoring/scoringV2_2.js';
import { mapFindingToProblemType } from '../scoring/problemMapV2_2.js';
import { effectiveSlotAnalysis } from '../analysis/applySlotReviewCorrection.js';

/** Códigos de calidad de imagen: las fotos ya pasaron validación en captura; no exponer al usuario */
const QUALITY_ISSUE_CODES = /image_quality_issue|imagequalityissue|calidad\s*(de\s*)?(imagen|foto)|retomar\s*foto|falta\s*de\s*claridad/i;
const QUALITY_ISSUE_SIGNALS = [
  /image_quality_issue/i, /imagequalityissue/i, /calidad\s*(de\s*)?(imagen|foto)/i,
  /retomar\s*(la\s*)?foto/i, /falta\s*de\s*claridad/i, /imagen\s*borrosa/i, /blur/i, /poca\s*iluminación/i
];

function isQualityIssueCode(code) {
  if (!code || typeof code !== 'string') return false;
  const c = String(code).trim();
  return QUALITY_ISSUE_CODES.test(c) || c.toLowerCase().includes('image_quality');
}

function removeRetakePhrases(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\s*No\s+se\s+puede\s+evaluar\s+por\s+falta\s+de\s+claridad\.?\s*/gi, ' ')
    .replace(/\s*Se\s+recomienda\s+retomar\s+(la\s+)?fotograf[ií]a\.?\s*/gi, ' ')
    .replace(/\s*Se\s+sugiere\s+retomar\s+(la\s+)?foto\.?\s*/gi, ' ')
    .replace(/\s*Retomar\s+(la\s+)?fotograf[ií]a\s+recomendado\.?\s*/gi, ' ')
    .replace(/\s*,\s*lo\s+que\s+dificulta\s+(la\s+)?visibilidad\.?\s*/gi, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Las superficies se ven uniformes y sin evidencias claras de deterioro.';
}

function filterQualitySignals(signals) {
  if (!Array.isArray(signals)) return [];
  return signals.filter((sig) => {
    const s = String(sig || '').toLowerCase();
    return !QUALITY_ISSUE_SIGNALS.some((p) => p.test(s)) && !s.includes('image_quality');
  });
}

/** Formatea RUT chileno para visualización (ej: 123456789 → 12.345.678-9) */
function formatRutForDisplay(rut) {
  if (!rut || typeof rut !== 'string') return null;
  const s = String(rut).replace(/[^0-9kK]/g, '').toUpperCase();
  if (s.length < 2) return null;
  const body = s.slice(0, -1);
  const dv = s.slice(-1);
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
  return formatted || null;
}

function normalizeSource(code, debug) {
  const source = String(debug?.source || '').toUpperCase();
  if (source === 'OPENAI') return 'OPENAI';
  if (!code) return 'V1';
  return 'V1';
}

function shouldHideLegacySlot(slotCode) {
  const code = String(slotCode || '').toUpperCase();
  return code === 'ESTACIONAMIENTO' || code === 'PARKING';
}

function normalizeOperationTypeLabel(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'ARRENDO') return 'ARRIENDO';
  return String(value || '');
}

export async function getCaseSummary({ prisma, storage, caseId, slotGroupTitleFromCode, scoreConfig, tenantId, scoreConfigUpdatedAt = null }) {
  const byShortIdOrId = caseId.length === 8
    ? { OR: [{ shortId: caseId }, { id: caseId }] }
    : { id: caseId };
  const c = await prisma.case.findFirst({
    where: { ...byShortIdOrId, ...(tenantId ? { tenantId } : {}) },
    include: {
      property: { include: { owner: true } },
      slots: { include: { photo: true } }
    }
  });
  if (!c) return { ok: false, error: 'CASE_NOT_FOUND' };

  // Correcciones ITO: el informe debe usar SlotReview (corrected), no solo el análisis IA crudo.
  const slotReviews = await prisma.slotReview.findMany({
    where: { caseId: c.id, verdict: 'corrected' },
    select: {
      slotId: true,
      verdict: true,
      humanCode: true,
      humanSeverity: true,
      humanMessage: true,
      note: true,
      reviewerEmail: true
    }
  }).catch(() => []);
  const reviewBySlotId = new Map((slotReviews || []).map((r) => [r.slotId, r]));

  const slots = (c.slots || [])
    .filter((s) => !shouldHideLegacySlot(s.slotCode))
    .map((s) => {
    const review = reviewBySlotId.get(s.id) || null;
    const effective = effectiveSlotAnalysis(s, review) || s;
    const analysisCode = effective.analysisCode;
    const analysisSeverity = effective.analysisSeverity;
    const analysisMessage = effective.analysisMessage;
    const slotDebug = effective.analysisDebug || s.analysisDebug;

    const isOmitted = String(s.status || '').toUpperCase() === 'NOT_CAPTURABLE' || String(analysisCode || '').toUpperCase() === 'NOT_CAPTURABLE';
    const isQualityIssue = isQualityIssueCode(analysisCode);
    const effectiveCode = (isQualityIssue || isOmitted) ? 'OK' : analysisCode;
    const effectiveSeverity = (isQualityIssue || isOmitted) ? null : analysisSeverity;
    const effectiveMessage = isOmitted ? '' : removeRetakePhrases(analysisMessage || '');

    const group = slotGroupTitleFromCode ? slotGroupTitleFromCode(s.slotCode) : { groupKey: 'OTHER', groupTitle: 'Otros' };
    const kpiKey = classifyKpiFromSlot({
      findingCode: effectiveCode,
      slotCode: s.slotCode,
      title: s.title,
      message: effectiveMessage
    }, scoreConfig?.slotKpiMap);

    const parsed = slotDebug?.openai?.parsed;
    let analysisDebug = null;
    if (parsed && typeof parsed === 'object') {
      try {
        const clean = JSON.parse(JSON.stringify(parsed));
        clean.signals_detected = filterQualitySignals(clean.signals_detected || []);
        clean.description = removeRetakePhrases(clean.description || '');
        clean.kpi_analysis = removeRetakePhrases(clean.kpi_analysis || '');
        analysisDebug = { openai: { parsed: clean } };
      } catch (_) {
        analysisDebug = { openai: { parsed: { description: removeRetakePhrases(parsed?.description || ''), kpi_analysis: removeRetakePhrases(parsed?.kpi_analysis || '') } } };
      }
    }

    const severitySource = review
      ? 'human_review_correction'
      : String(slotDebug?.openai?.parsed?.severity_source || slotDebug?.severitySource || (effectiveSeverity ? 'legacy_rule' : 'none'));

    return {
      id: s.id,
      slotCode: s.slotCode,
      title: s.title,
      instructions: s.instructions,
      status: s.status,
      omitted: isOmitted,
      findingCode: effectiveCode,
      severity: effectiveSeverity,
      confidence: s.analysisConfidence,
      message: isOmitted ? '' : (effectiveMessage || analysisMessage || ''),
      analysisDebug,
      analyzedAt: s.analyzedAt ? new Date(s.analyzedAt).toISOString() : null,
      source: normalizeSource(analysisCode, slotDebug),
      groupKey: group.groupKey,
      groupTitle: group.groupTitle,
      kpiKey,
      severitySource,
      scorePenaltyApplied: effectiveSeverity && kpiKey
        ? kpiPenaltyFromSeverity(kpiKey, effectiveSeverity, scoreConfig)
        : 0,
      expectedComponent: slotDebug?.slotMatch?.expectedComponent || null,
      detectedComponent: slotDebug?.slotMatch?.detectedComponent || null,
      photoUrl: s.photo?.filePath ? storage.publicUrl(s.photo.filePath) : null,
      photoId: s.photoId ?? s.photo?.id ?? null,
      humanReview: review
        ? { verdict: review.verdict, humanCode: review.humanCode, humanSeverity: review.humanSeverity }
        : null
    };
    });

  const findingsNormalized = slots
    .filter((s) => s.findingCode && s.severity)
    .map((s) => ({
      slotId: s.id,
      severity: s.severity,
      confidence: s.confidence ?? 0,
      findingCode: s.findingCode,
      message: s.message,
      problemType: mapFindingToProblemType(s.findingCode)
    }))
    .filter((f) => !!f.problemType);

  let scoring;
  try {
    scoring = computeScoringV2_2(findingsNormalized, slots, scoreConfig);
  } catch (err) {
    scoring = { score: 0, badge: 'GRAY', byGroup: [] };
  }

  const property = c.property || {};
  const owner = property.owner || {};
  const caseSafe = {
    id: c.id,
    shortId: c.shortId,
    status: c.status,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
    executiveSummary: c.executiveSummary || null,
    propertyType: c.propertyType,
    bedrooms: c.bedrooms,
    bathrooms: c.bathrooms,
    tenantId: c.tenantId || null,
    property: {
      id: property.id,
      rol: property.rol,
      address: property.address,
      operationType: normalizeOperationTypeLabel(property.operationType),
      surface: property.surface,
      owner: owner ? {
        id: owner.id,
        fullName: owner.fullName,
        rut: formatRutForDisplay(owner.rut) || owner.rut || null
      } : null
    }
  };

  let tenant = null;
  if (c.tenantId) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT id, name, legalName, logoUrl FROM Tenant WHERE id = ${c.tenantId} LIMIT 1
      `;
      const t = rows?.[0];
      if (t) {
        tenant = {
          id: t.id,
          name: t.name || null,
          legalName: t.legalName || null,
          logoUrl: t.logoUrl ? String(t.logoUrl) : null
        };
      }
    } catch (_) {
      tenant = null;
    }
  }

  return {
    ok: true,
    case: caseSafe,
    tenant,
    slots,
    score: scoring.score ?? 0,
    badge: scoring.badge || badgeFromScore(scoring.score ?? 0, scoreConfig),
    byGroup: scoring.byGroup || [],
    scoreConfigMeta: {
      updatedAt: scoreConfigUpdatedAt ? new Date(scoreConfigUpdatedAt).toISOString() : null
    },
    /** KPIs/badge para el reporte público (evita /api/admin/score-config sin sesión). */
    scoreConfig: scoreConfig ? {
      kpis: scoreConfig.kpis,
      badge: scoreConfig.badge,
      kpiWeights: scoreConfig.kpiWeights,
      messages: scoreConfig.messages,
      recommendations: scoreConfig.recommendations
    } : null
  };
}
