// src/scoring/scoringV2_2.js

export const SEVERITY_FACTOR_V22 = {
  low: 1.0,
  medium: 1.3,
  high: 1.5,
};

export const PROBLEM_BASE_V22 = {
  HUMIDITY_FILTRATION: 20,
  PIPE_LEAK_CORROSION: 25,
  ELECTRICAL_RISK: 35,
  STRUCTURAL_CRACK: 40,
  MATERIAL_DETACHMENT: 30,
  SANITARY_RISK: 25,
  COSMETIC: 5,
};

// Context flags derived from slot/group
export function deriveContextFlags(slot) {
  const g = (slot.groupKey || "").toUpperCase();

  const isWetArea =
    g.startsWith("BATH") || g === "KITCHEN" || g === "LAUNDRY";

  const isElectricalContext =
    g === "ELECTRICAL" ||
    (slot.slotCode || "").toUpperCase().includes("ELECTRICAL") ||
    (slot.slotCode || "").toUpperCase().includes("PANEL");

  const isStructuralContext =
    g === "STRUCTURE" ||
    (slot.slotCode || "").toUpperCase().includes("STRUCTURE");

  return { isWetArea, isElectricalContext, isStructuralContext };
}

// Critical context penalties (fixed, no repetition logic)
export function contextPenalty(problemType, flags) {
  // Only two rules per your definition
  if (problemType === "ELECTRICAL_RISK" && flags.isWetArea) return 15;
  if (problemType === "HUMIDITY_FILTRATION" && flags.isElectricalContext) return 15;
  return 0;
}

export function badgeFromScore(score) {
  if (score < 60) return "RED";
  if (score < 85) return "YELLOW";
  return "GREEN";
}

/**
 * findingsNormalized item:
 * {
 *  slotId, severity, confidence, findingCode, message, problemType
 * }
 */
export function computeScoringV2_2(findingsNormalized, slots) {
  const slotById = new Map(slots.map(s => [s.id, s]));

  let totalImpact = 0;

  // optional breakdown by group for UI (informativo, no manda)
  const byGroup = new Map(); // groupKey -> { title, impact }

  for (const f of findingsNormalized) {
    const slot = slotById.get(f.slotId);
    if (!slot) continue;

    const sev = (f.severity || "").toLowerCase();
    const sevFactor = SEVERITY_FACTOR_V22[sev] ?? 1.0;

    const base = PROBLEM_BASE_V22[f.problemType] ?? 0;
    if (!base) continue;

    const flags = deriveContextFlags(slot);
    const ctx = contextPenalty(f.problemType, flags);

    const impact = Math.round(base * sevFactor + ctx);
    totalImpact += impact;

    const gk = (slot.groupKey || "OTHER").toUpperCase();
    const gt = slot.groupTitle || "Otros";
    if (!byGroup.has(gk)) byGroup.set(gk, { groupKey: gk, title: gt, impact: 0 });
    byGroup.get(gk).impact += impact;
  }

  let score = 100 - totalImpact;
  score = Math.max(0, Math.min(100, score));

  const badge = badgeFromScore(score);

  const byGroupArr = Array.from(byGroup.values())
    .map(g => ({
      ...g,
      // Informativo: "score estimado si solo existiera este grupo"
      scoreIfOnlyGroup: Math.max(0, Math.min(100, 100 - g.impact)),
    }));

  return {
    scoreVersion: "SCORING_V2_2",
    score,
    badge,
    totalImpact,
    byGroup: byGroupArr,
  };
}
