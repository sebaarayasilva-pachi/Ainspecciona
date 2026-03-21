import { computeScoringV2_2, badgeFromScore, classifyKpiFromSlot } from '../scoring/scoringV2_2.js';
import { mapFindingToProblemType } from '../scoring/problemMapV2_2.js';

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
  return code === 'ELEVATOR' || code === 'ASCENSOR' || code === 'ESTACIONAMIENTO' || code === 'PARKING';
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

  const slots = (c.slots || [])
    .filter((s) => !shouldHideLegacySlot(s.slotCode))
    .map((s) => {
    const isOmitted = String(s.status || '').toUpperCase() === 'NOT_CAPTURABLE' || String(s.analysisCode || '').toUpperCase() === 'NOT_CAPTURABLE';
    const isQualityIssue = isQualityIssueCode(s.analysisCode);
    const effectiveCode = (isQualityIssue || isOmitted) ? 'OK' : s.analysisCode;
    const effectiveSeverity = (isQualityIssue || isOmitted) ? null : s.analysisSeverity;
    const effectiveMessage = isOmitted ? '' : removeRetakePhrases(s.analysisMessage || '');

    const group = slotGroupTitleFromCode ? slotGroupTitleFromCode(s.slotCode) : { groupKey: 'OTHER', groupTitle: 'Otros' };
    const kpiKey = classifyKpiFromSlot({
      findingCode: effectiveCode,
      slotCode: s.slotCode,
      title: s.title,
      message: effectiveMessage
    }, scoreConfig?.slotKpiMap);

    const parsed = s.analysisDebug?.openai?.parsed;
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
      message: isOmitted ? '' : (effectiveMessage || s.analysisMessage || ''),
      analysisDebug,
      analyzedAt: s.analyzedAt ? new Date(s.analyzedAt).toISOString() : null,
      source: normalizeSource(s.analysisCode, s.analysisDebug),
      groupKey: group.groupKey,
      groupTitle: group.groupTitle,
      kpiKey,
      severitySource: String(s.analysisDebug?.openai?.parsed?.severity_source || s.analysisDebug?.severitySource || (effectiveSeverity ? 'legacy_rule' : 'none')),
      scorePenaltyApplied: Number(
        s.analysisDebug?.openai?.parsed?.score_penalty_applied
        ?? s.analysisDebug?.scorePenaltyApplied
        ?? (effectiveSeverity && kpiKey && scoreConfig?.kpis?.[kpiKey]
          ? Number(scoreConfig.kpis[kpiKey][String(effectiveSeverity).toLowerCase()] ?? 0)
          : 0)
      ),
      expectedComponent: s.analysisDebug?.slotMatch?.expectedComponent || null,
      detectedComponent: s.analysisDebug?.slotMatch?.detectedComponent || null,
      photoUrl: s.photo?.filePath ? storage.publicUrl(s.photo.filePath) : null,
      photoId: s.photoId ?? s.photo?.id ?? null
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

  return {
    ok: true,
    case: caseSafe,
    slots,
    score: scoring.score ?? 0,
    badge: scoring.badge || badgeFromScore(scoring.score ?? 0, scoreConfig),
    byGroup: scoring.byGroup || [],
    scoreConfigMeta: {
      updatedAt: scoreConfigUpdatedAt ? new Date(scoreConfigUpdatedAt).toISOString() : null
    }
  };
}
