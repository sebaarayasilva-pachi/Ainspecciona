import { computeScoringV2_2, badgeFromScore, starsFromScore, publicScoreConfigSubset } from '../scoring/scoringV2_2.js';
import { computeCoverage } from '../scoring/scoringV4.js';
import { mapFindingToProblemType } from '../scoring/problemMapV2_2.js';
import { assembleReportSlot } from '../report/assembleReportSlot.js';

function kpiTitleFromKey(key) {
  const map = {
    MUROS_PINTURA: 'Muros y pintura',
    HUMEDAD: 'Humedad visible',
    PISOS: 'Pisos',
    SANITARIOS: 'Sanitarios',
    ELECTRICIDAD: 'Electricidad visible',
    VENTANAS_CERRAMIENTOS: 'Ventanas y cerramientos',
    PUERTAS_HERRAJES: 'Puertas y herrajes',
    MOBILIARIO_FIJO: 'Mobiliario fijo',
    DOCUMENTOS_CUMPLIMIENTO: 'Documentos y cumplimiento'
  };
  return map[key] || (key ? key[0] + key.slice(1).toLowerCase() : key);
}

function formatRutForDisplay(rut) {
  if (!rut || typeof rut !== 'string') return null;
  const s = String(rut).replace(/[^0-9kK]/g, '').toUpperCase();
  if (s.length < 2) return null;
  const body = s.slice(0, -1);
  const dv = s.slice(-1);
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
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

export async function getCaseSummary({ prisma, storage, caseId, slotGroupTitleFromCode, scoreConfig, tenantId, scoreConfigUpdatedAt = null, forceRecalc = false }) {
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
    .map((s) => assembleReportSlot(s, {
      review: reviewBySlotId.get(s.id) || null,
      scoreConfig,
      slotGroupTitleFromCode,
      storage
    }));

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
  const persistedKpis = c.kpiScores && typeof c.kpiScores === 'object' && !Array.isArray(c.kpiScores)
    ? c.kpiScores
    : null;
  const hasPersistedSsot = !forceRecalc
    && c.finalScore != null
    && persistedKpis
    && Object.keys(persistedKpis).length > 0;

  if (hasPersistedSsot) {
    const byGroup = Object.entries(c.kpiScores).map(([key, score]) => ({
      groupKey: key,
      scoreIfOnlyGroup: score,
      title: kpiTitleFromKey(key),
      slotsCount: 0,
      impact: 0
    }));
    scoring = {
      scoreVersion: c.scoreVersion || 'SCORING_V2_2_KPI',
      score: c.finalScore,
      badge: c.finalBadge || badgeFromScore(c.finalScore, scoreConfig),
      stars: starsFromScore(c.finalScore, scoreConfig, { slots }),
      totalImpact: 0,
      byGroup
    };
  } else {
    try {
      scoring = computeScoringV2_2(findingsNormalized, slots, scoreConfig);
    } catch (err) {
      scoring = { score: 0, badge: 'GRAY', byGroup: [] };
    }
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
    kpiScores: c.kpiScores || null,
    finalScore: c.finalScore ?? null,
    finalBadge: c.finalBadge || null,
    scoreVersion: c.scoreVersion || null,
    scoredAt: c.scoredAt ? new Date(c.scoredAt).toISOString() : null,
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
    scoreConfig: publicScoreConfigSubset(scoreConfig) || (scoreConfig ? {
      kpis: scoreConfig.kpis,
      badge: scoreConfig.badge,
      kpiWeights: scoreConfig.kpiWeights,
      messages: scoreConfig.messages,
      recommendations: scoreConfig.recommendations,
      engineVersion: scoreConfig.engineVersion,
      severityScores: scoreConfig.severityScores,
      stars: scoreConfig.stars,
      caps: scoreConfig.caps
    } : null),
    coverage: scoring.coverage || computeCoverage(slots),
    stars: scoring.stars ?? null,
    scoreVersion: scoring.scoreVersion || null
  };
}
