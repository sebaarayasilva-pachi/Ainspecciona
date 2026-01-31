export const SCORING_V1 = 'SCORING_V1';

export const SEVERITY_POINTS = {
  low: 5,
  medium: 15,
  high: 35
};

export const GROUP_MULTIPLIER = {
  BATH_MAIN: 1.5,
  BATH_SECONDARY: 1.5,
  KITCHEN: 1.3,
  LAUNDRY: 1.3,
  ELECTRICAL: 1.7,
  STRUCTURE: 1.4,
  EXTERIOR: 1.2,
  ATTIC: 1.2,
  OTHER: 1.0
};

export function badgeFromScore({ score, hasHigh, hasMedium }) {
  if (hasHigh || score < 60) return 'RED';
  if (hasMedium || score < 85) return 'YELLOW';
  return 'GREEN';
}

function clampScore(n) {
  return Math.max(0, Math.min(100, n));
}

/**
 * findings: array de hallazgos normalizados:
 *  { slotId, severity: 'low'|'medium'|'high', code, message, confidence? }
 *
 * slots: array de slots con:
 *  { id, groupKey, groupTitle }
 */
export function computeScoringV1(findings, slots) {
  let score = 100;
  let hasHigh = false;
  let hasMedium = false;

  const slotById = new Map(slots.map((s) => [s.id, s]));

  // key -> { groupKey, title, scoreImpact, hasHigh, hasMedium }
  const groupAgg = new Map();

  for (const f of findings) {
    const slot = slotById.get(f.slotId);
    const groupKey = slot?.groupKey || 'OTHER';
    const groupTitle = slot?.groupTitle || 'Otros';
    const mult = GROUP_MULTIPLIER[groupKey] ?? 1.0;

    const sev = String(f.severity || '').toLowerCase();
    const base = SEVERITY_POINTS[sev] ?? 0;

    if (sev === 'high') hasHigh = true;
    if (sev === 'medium') hasMedium = true;

    const impact = Math.round(base * mult);
    score -= impact;

    if (!groupAgg.has(groupKey)) {
      groupAgg.set(groupKey, {
        groupKey,
        title: groupTitle,
        scoreImpact: 0,
        hasHigh: false,
        hasMedium: false
      });
    }

    const g = groupAgg.get(groupKey);
    g.scoreImpact -= impact;
    if (sev === 'high') g.hasHigh = true;
    if (sev === 'medium') g.hasMedium = true;
  }

  score = clampScore(score);
  const badge = badgeFromScore({ score, hasHigh, hasMedium });

  const byGroup = Array.from(groupAgg.values())
    .map((g) => {
      const groupScore = clampScore(100 + g.scoreImpact);
      const groupBadge = badgeFromScore({
        score: groupScore,
        hasHigh: g.hasHigh,
        hasMedium: g.hasMedium
      });
      return { groupKey: g.groupKey, title: g.title, scoreImpact: g.scoreImpact, badge: groupBadge };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return { scoreVersion: SCORING_V1, score, badge, byGroup };
}
