/**
 * Exactitud histórica de la IA por KPI, calculada de veredictos ITO reales (SlotReview).
 * Base del umbral de confianza: auto-validar hallazgos benignos en KPIs donde la IA ya demostró precisión.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {{ stats: Record<string, { total: number, ok: number, accuracyPct: number }>, loadedAt: number } | null} */
let _cache = null;

export function invalidateKpiAccuracyCache() {
  _cache = null;
}

export function autoApproveConfig() {
  return {
    minAccuracyPct: Math.min(100, Math.max(50, Number(process.env.KB_AUTO_OK_MIN_ACCURACY || 95))),
    minReviews: Math.max(1, Number(process.env.KB_AUTO_OK_MIN_REVIEWS || 20)),
    enabled: String(process.env.KB_AUTO_OK_ENABLED ?? '1') !== '0'
  };
}

/**
 * Exactitud por KPI: % de veredictos 'ok' sobre el total revisado.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Function} classifyKpiFromSlot
 * @param {object} [slotKpiMap]
 * @returns {Promise<Record<string, { total: number, ok: number, accuracyPct: number }>>}
 */
export async function getKpiAccuracyStats(prisma, classifyKpiFromSlot, slotKpiMap) {
  if (_cache && Date.now() - _cache.loadedAt < CACHE_TTL_MS) return _cache.stats;

  // Solo veredictos humanos: las auto-validaciones no cuentan (evita auto-refuerzo del umbral).
  const reviews = await prisma.slotReview.findMany({
    where: { NOT: { reviewerEmail: { startsWith: 'auto:' } } },
    select: { slotId: true, verdict: true, humanKpiKey: true }
  });
  if (!reviews.length) {
    _cache = { stats: {}, loadedAt: Date.now() };
    return _cache.stats;
  }

  const slots = await prisma.slot.findMany({
    where: { id: { in: reviews.map((r) => r.slotId) } },
    select: { id: true, slotCode: true, title: true }
  });
  const slotById = new Map(slots.map((s) => [s.id, s]));

  /** @type {Record<string, { total: number, ok: number, accuracyPct: number }>} */
  const stats = {};
  for (const r of reviews) {
    const slot = slotById.get(r.slotId);
    if (!slot) continue;
    const kpi = String(
      r.humanKpiKey || (typeof classifyKpiFromSlot === 'function' ? classifyKpiFromSlot(slot, slotKpiMap) : '') || 'OTROS'
    ).toUpperCase();
    if (!stats[kpi]) stats[kpi] = { total: 0, ok: 0, accuracyPct: 0 };
    stats[kpi].total += 1;
    if (r.verdict === 'ok') stats[kpi].ok += 1;
  }
  for (const kpi of Object.keys(stats)) {
    stats[kpi].accuracyPct = Math.round((1000 * stats[kpi].ok) / stats[kpi].total) / 10;
  }

  _cache = { stats, loadedAt: Date.now() };
  return stats;
}

/**
 * ¿El slot califica para auto-validación?
 * Solo hallazgos benignos (sin hallazgo o severidad low) en KPIs con historial confiable.
 * @param {{ analysisCode?: string | null, analysisSeverity?: string | null }} slot
 * @param {{ total: number, accuracyPct: number } | undefined} kpiStat
 * @param {{ minAccuracyPct: number, minReviews: number, enabled: boolean }} cfg
 */
export function slotQualifiesForAutoApprove(slot, kpiStat, cfg) {
  if (!cfg.enabled || !kpiStat) return false;
  if (kpiStat.total < cfg.minReviews || kpiStat.accuracyPct < cfg.minAccuracyPct) return false;
  const code = String(slot.analysisCode || '').toUpperCase();
  const sev = String(slot.analysisSeverity || '').toLowerCase();
  const benign = !code || code === 'OK' || code === 'NOT_CAPTURABLE' || sev === 'low' || sev === 'none';
  return benign;
}
