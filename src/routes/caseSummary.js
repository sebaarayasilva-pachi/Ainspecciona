import { computeScoringV2_2, badgeFromScore, classifyKpiFromSlot } from '../scoring/scoringV2_2.js';
import { mapFindingToProblemType } from '../scoring/problemMapV2_2.js';

function normalizeSource(code) {
  if (!code) return 'V1';
  return 'V1';
}

export async function getCaseSummary({ prisma, storage, caseId, slotGroupTitleFromCode, scoreConfig }) {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      property: { include: { owner: true } },
      slots: { include: { photo: true } }
    }
  });
  if (!c) return { ok: false, error: 'CASE_NOT_FOUND' };

  const slots = (c.slots || []).map((s) => {
    const group = slotGroupTitleFromCode ? slotGroupTitleFromCode(s.slotCode) : { groupKey: 'OTHER', groupTitle: 'Otros' };
    const kpiKey = classifyKpiFromSlot({
      findingCode: s.analysisCode,
      slotCode: s.slotCode,
      title: s.title,
      message: s.analysisMessage
    });

    return {
      id: s.id,
      slotCode: s.slotCode,
      title: s.title,
      instructions: s.instructions,
      status: s.status,
      findingCode: s.analysisCode,
      severity: s.analysisSeverity,
      confidence: s.analysisConfidence,
      message: s.analysisMessage,
      analyzedAt: s.analyzedAt,
      source: normalizeSource(s.analysisCode),
      groupKey: group.groupKey,
      groupTitle: group.groupTitle,
      kpiKey,
      photoUrl: s.photo?.filePath ? storage.publicUrl(s.photo.filePath) : null
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

  const scoring = computeScoringV2_2(findingsNormalized, slots, scoreConfig);

  return {
    ok: true,
    case: c,
    slots,
    score: scoring.score ?? 0,
    badge: scoring.badge || badgeFromScore(scoring.score ?? 0, scoreConfig),
    byGroup: scoring.byGroup || []
  };
}
