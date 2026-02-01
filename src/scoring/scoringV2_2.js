// src/scoring/scoringV2_2.js

export const SEVERITY_FACTOR_V22 = {
  low: 1.0,
  medium: 1.3,
  high: 1.5,
};

export const DEFAULT_SCORE_CONFIG = {
  kpis: {
    HUMEDAD: { low: 5, medium: 15, high: 30 },
    PINTURA: { low: 5, medium: 15, high: 30 },
    PISOS: { low: 5, medium: 15, high: 30 },
    SANITARIOS: { low: 5, medium: 15, high: 30 },
    ELECTRICIDAD: { low: 5, medium: 15, high: 30 },
    VENTANAS: { low: 5, medium: 15, high: 30 }
  },
  messages: {
    HUMEDAD: {
      low: "Se observan indicios leves de humedad superficial en el área inspeccionada.",
      medium: "Se observan señales visibles de humedad en el área inspeccionada.",
      high: "Se observan evidencias visibles de humedad extendida en el área inspeccionada."
    },
    PINTURA: {
      low: "Se observan imperfecciones menores en la pintura del área inspeccionada.",
      medium: "Se observan deterioros visibles en la pintura del área inspeccionada.",
      high: "Se observan deterioros relevantes en la pintura del área inspeccionada."
    },
    PISOS: {
      low: "Se observan marcas o desgaste leve en el piso del área inspeccionada.",
      medium: "Se observan desgaste o daños visibles en el piso del área inspeccionada.",
      high: "Se observan daños visibles relevantes en el piso del área inspeccionada."
    },
    SANITARIOS: {
      low: "Se observan condiciones visibles menores en artefactos sanitarios del área inspeccionada.",
      medium: "Se observan condiciones visibles en artefactos sanitarios del área inspeccionada.",
      high: "Se observan condiciones visibles relevantes en artefactos sanitarios del área inspeccionada."
    },
    ELECTRICIDAD: {
      low: "Se observan condiciones visibles menores en elementos eléctricos del área inspeccionada.",
      medium: "Se observan condiciones visibles en elementos eléctricos del área inspeccionada.",
      high: "Se observan condiciones visibles relevantes en elementos eléctricos del área inspeccionada."
    },
    VENTANAS: {
      low: "Se observan condiciones visibles menores en ventanas o marcos del área inspeccionada.",
      medium: "Se observan condiciones visibles en ventanas o marcos del área inspeccionada.",
      high: "Se observan condiciones visibles relevantes en ventanas o marcos del área inspeccionada."
    }
  },
  recommendations: {
    GREEN: "Se recomienda mantener seguimiento y control preventivo.",
    YELLOW: "Se recomienda revisar y monitorear el estado observado.",
    RED: "Se recomienda una revisión técnica detallada del hallazgo."
  },
  badge: { yellowFrom: 60, greenFrom: 85 }
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

export function badgeFromScore(score, scoreConfig) {
  const yellowFrom = scoreConfig?.badge?.yellowFrom ?? DEFAULT_SCORE_CONFIG.badge.yellowFrom;
  const greenFrom = scoreConfig?.badge?.greenFrom ?? DEFAULT_SCORE_CONFIG.badge.greenFrom;
  if (score < yellowFrom) return "RED";
  if (score < greenFrom) return "YELLOW";
  return "GREEN";
}

export function normalizeScoreConfig(input) {
  const base = structuredClone(DEFAULT_SCORE_CONFIG);
  if (!input || typeof input !== "object") return base;
  const next = { ...base, ...input };
  if (!next.kpis || typeof next.kpis !== "object") next.kpis = base.kpis;
  if (!next.messages || typeof next.messages !== "object") next.messages = base.messages;
  if (!next.recommendations || typeof next.recommendations !== "object") next.recommendations = base.recommendations;
  const kpiKeys = Object.keys(base.kpis);
  kpiKeys.forEach((k) => {
    const src = next.kpis[k] || {};
    next.kpis[k] = {
      low: Number.isFinite(Number(src.low)) ? Number(src.low) : base.kpis[k].low,
      medium: Number.isFinite(Number(src.medium)) ? Number(src.medium) : base.kpis[k].medium,
      high: Number.isFinite(Number(src.high)) ? Number(src.high) : base.kpis[k].high
    };
    const msgSrc = next.messages[k] || {};
    next.messages[k] = {
      low: String(msgSrc.low || base.messages[k].low),
      medium: String(msgSrc.medium || base.messages[k].medium),
      high: String(msgSrc.high || base.messages[k].high)
    };
  });
  next.recommendations = {
    GREEN: String(next.recommendations.GREEN || base.recommendations.GREEN),
    YELLOW: String(next.recommendations.YELLOW || base.recommendations.YELLOW),
    RED: String(next.recommendations.RED || base.recommendations.RED)
  };
  next.badge = {
    yellowFrom: Number.isFinite(Number(next.badge?.yellowFrom)) ? Number(next.badge.yellowFrom) : base.badge.yellowFrom,
    greenFrom: Number.isFinite(Number(next.badge?.greenFrom)) ? Number(next.badge.greenFrom) : base.badge.greenFrom
  };
  return next;
}

export function classifyKpiFromSlot(slot) {
  const code = String(slot.findingCode || slot.slotCode || "").toLowerCase();
  const title = String(slot.title || "").toLowerCase();
  const msg = String(slot.message || "").toLowerCase();

  const has = (txt) => title.includes(txt) || code.includes(txt) || msg.includes(txt);
  const hasAny = (arr) => arr.some(has);

  if (hasAny(["electrical", "tablero", "enchufe", "interruptor"])) return "ELECTRICIDAD";
  if (hasAny(["ventana", "vidrio", "marco"])) return "VENTANAS";
  if (hasAny(["humedad", "moho", "filtr", "water", "mold"])) return "HUMEDAD";
  if (hasAny(["piso", "pisos", "floor"])) return "PISOS";
  if (hasAny(["pintura", "muros", "cielos", "paint"])) return "PINTURA";
  if (hasAny(["wc", "lavamanos", "lavaplatos", "grifer", "ducha", "tina", "sanitario", "sifon", "cañer", "baño", "baño"])) return "SANITARIOS";
  return null;
}

function kpiTitleFromKey(key) {
  return key[0] + key.slice(1).toLowerCase();
}

function computeScoringByKpi(slots, scoreConfig) {
  const cfg = normalizeScoreConfig(scoreConfig);
  const byGroup = new Map();
  let totalPenalty = 0;

  slots.forEach((s) => {
    if (!s.severity) return;
    const key = classifyKpiFromSlot(s);
    if (!key || !cfg.kpis[key]) return;
    const sev = String(s.severity || "").toLowerCase();
    const penalty = Number(cfg.kpis[key][sev] ?? 0);
    totalPenalty += penalty;

    if (!byGroup.has(key)) byGroup.set(key, { groupKey: key, title: kpiTitleFromKey(key), impact: 0 });
    byGroup.get(key).impact += penalty;
  });

  let score = 100 - totalPenalty;
  score = Math.max(0, Math.min(100, score));
  const badge = badgeFromScore(score, cfg);

  const byGroupArr = Array.from(byGroup.values())
    .map(g => ({
      ...g,
      scoreIfOnlyGroup: Math.max(0, Math.min(100, 100 - g.impact)),
    }));

  return {
    scoreVersion: "SCORING_V2_2_KPI",
    score,
    badge,
    totalImpact: totalPenalty,
    byGroup: byGroupArr,
  };
}

/**
 * findingsNormalized item:
 * {
 *  slotId, severity, confidence, findingCode, message, problemType
 * }
 */
export function computeScoringV2_2(findingsNormalized, slots, scoreConfig) {
  if (scoreConfig?.kpis) {
    return computeScoringByKpi(slots, scoreConfig);
  }

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

  const badge = badgeFromScore(score, scoreConfig);

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
