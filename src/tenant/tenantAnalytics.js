/**
 * Analytics del panel tenant (corredora): KPIs, por agente, distribución de estrellas.
 */
import { starsFromScore } from '../scoring/scoringV2_2.js';

export function clampTenantDays(q, def = 30, max = 90) {
  const n = parseInt(String(q || ''), 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return Math.round(sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w);
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * @param {object} deps
 * @param {import('@prisma/client').PrismaClient} deps.prisma
 * @param {any} deps.storage
 * @param {string} deps.tenantId
 * @param {number} deps.days
 * @param {Function} deps.getCaseSummary
 * @param {Function} deps.slotGroupTitleFromCode
 * @param {Function} deps.getRuntimeScoreConfig
 */
export async function buildTenantAnalyticsDashboard(deps) {
  const {
    prisma,
    storage,
    tenantId,
    days,
    getCaseSummary,
    slotGroupTitleFromCode,
    getRuntimeScoreConfig
  } = deps;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [cases, credits, agents] = await Promise.all([
    prisma.case.findMany({
      where: { tenantId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        shortId: true,
        status: true,
        createdAt: true,
        assignedUserId: true,
        assignedUser: { select: { id: true, fullName: true, role: true, status: true } }
      }
    }),
    prisma.tenantCredit.findUnique({ where: { tenantId }, select: { balance: true } }),
    prisma.user.findMany({
      where: { tenantId, status: { in: ['ACTIVE', 'PENDING'] } },
      select: { id: true, fullName: true, role: true, status: true },
      orderBy: { fullName: 'asc' }
    })
  ]);

  const byStatus = {
    DRAFT: 0,
    IN_PROGRESS: 0,
    DONE: 0,
    PENDING_APPROVAL: 0,
    CANCELLED: 0,
    OTHER: 0
  };
  for (const c of cases) {
    const st = String(c.status || '').toUpperCase();
    if (byStatus[st] != null) byStatus[st] += 1;
    else byStatus.OTHER += 1;
  }

  const agentMap = new Map();
  for (const a of agents) {
    agentMap.set(a.id, {
      userId: a.id,
      fullName: a.fullName || 'Sin nombre',
      role: a.role,
      status: a.status,
      total: 0,
      byStatus: { DRAFT: 0, IN_PROGRESS: 0, DONE: 0, PENDING_APPROVAL: 0, CANCELLED: 0, OTHER: 0 },
      scoredCount: 0,
      scoreSum: 0,
      avgScore: null,
      byStars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      byBadge: { GREEN: 0, YELLOW: 0, RED: 0, GRAY: 0 }
    });
  }
  const unassigned = {
    total: 0,
    byStatus: { DRAFT: 0, IN_PROGRESS: 0, DONE: 0, PENDING_APPROVAL: 0, CANCELLED: 0, OTHER: 0 },
    scoredCount: 0,
    scoreSum: 0,
    avgScore: null,
    byStars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    byBadge: { GREEN: 0, YELLOW: 0, RED: 0, GRAY: 0 }
  };

  for (const c of cases) {
    const st = String(c.status || '').toUpperCase();
    const bucketKey = byStatus[st] != null ? st : 'OTHER';
    if (c.assignedUserId && agentMap.has(c.assignedUserId)) {
      const row = agentMap.get(c.assignedUserId);
      row.total += 1;
      row.byStatus[bucketKey] += 1;
    } else if (c.assignedUserId && c.assignedUser) {
      // Agente ya no listado (inactivo/eliminado de filtro) pero con casos
      if (!agentMap.has(c.assignedUserId)) {
        agentMap.set(c.assignedUserId, {
          userId: c.assignedUserId,
          fullName: c.assignedUser.fullName || 'Agente',
          role: c.assignedUser.role || 'TENANT_USER',
          status: c.assignedUser.status || 'ACTIVE',
          total: 0,
          byStatus: { DRAFT: 0, IN_PROGRESS: 0, DONE: 0, PENDING_APPROVAL: 0, CANCELLED: 0, OTHER: 0 },
          scoredCount: 0,
          scoreSum: 0,
          avgScore: null,
          byStars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          byBadge: { GREEN: 0, YELLOW: 0, RED: 0, GRAY: 0 }
        });
      }
      const row = agentMap.get(c.assignedUserId);
      row.total += 1;
      row.byStatus[bucketKey] += 1;
    } else {
      unassigned.total += 1;
      unassigned.byStatus[bucketKey] += 1;
    }
  }

  // Scores solo para DONE (o IN_PROGRESS con avance), tope 120
  const toScore = cases
    .filter((c) => {
      const st = String(c.status || '').toUpperCase();
      return st === 'DONE' || st === 'IN_PROGRESS';
    })
    .slice(0, 120);

  const runtimeCfg = await getRuntimeScoreConfig();
  const scoreConfig = runtimeCfg.config;

  const scored = await mapPool(toScore, 6, async (c) => {
    try {
      const summary = await getCaseSummary({
        prisma,
        storage,
        caseId: c.shortId ?? c.id,
        slotGroupTitleFromCode,
        scoreConfig,
        scoreConfigUpdatedAt: runtimeCfg.updatedAt,
        tenantId
      });
      if (!summary?.ok || summary.score == null) {
        return { caseRow: c, score: null, badge: null, stars: null };
      }
      const score = Math.round(Number(summary.score));
      const badge = summary.badge || null;
      const stars = starsFromScore(score, scoreConfig);
      return { caseRow: c, score, badge, stars };
    } catch {
      return { caseRow: c, score: null, badge: null, stars: null };
    }
  });

  const byStars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byBadge = { GREEN: 0, YELLOW: 0, RED: 0, GRAY: 0 };
  const scoreValues = [];

  for (const s of scored) {
    if (s.score == null) {
      byBadge.GRAY += 1;
      continue;
    }
    scoreValues.push(s.score);
    const star = Math.min(5, Math.max(1, Number(s.stars) || 1));
    byStars[star] += 1;
    const b = String(s.badge || '').toUpperCase();
    if (byBadge[b] != null) byBadge[b] += 1;
    else byBadge.GRAY += 1;

    const c = s.caseRow;
    const target =
      c.assignedUserId && agentMap.has(c.assignedUserId)
        ? agentMap.get(c.assignedUserId)
        : unassigned;
    target.scoredCount += 1;
    target.scoreSum += s.score;
    target.byStars[star] += 1;
    if (byBadge[b] != null && target.byBadge[b] != null) target.byBadge[b] += 1;
    else target.byBadge.GRAY += 1;
  }

  for (const row of agentMap.values()) {
    row.avgScore = row.scoredCount ? Math.round(row.scoreSum / row.scoredCount) : null;
    delete row.scoreSum;
  }
  unassigned.avgScore = unassigned.scoredCount
    ? Math.round(unassigned.scoreSum / unassigned.scoredCount)
    : null;
  delete unassigned.scoreSum;

  scoreValues.sort((a, b) => a - b);
  const avgScore = scoreValues.length
    ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
    : null;

  const agentsOut = [...agentMap.values()].sort((a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName));

  return {
    ok: true,
    days,
    since: since.toISOString(),
    kpis: {
      total: cases.length,
      byStatus,
      scoredCount: scoreValues.length,
      avgScore,
      byBadge,
      byStars,
      creditsBalance: credits?.balance ?? 0,
      pendingApproval: byStatus.PENDING_APPROVAL || 0,
      done: byStatus.DONE || 0,
      inProgress: byStatus.IN_PROGRESS || 0
    },
    scoreDistribution: {
      stars: byStars,
      /** Cinco cortes de score (p10–p90) + mediana */
      percentiles: {
        p10: percentile(scoreValues, 0.1),
        p25: percentile(scoreValues, 0.25),
        p50: percentile(scoreValues, 0.5),
        p75: percentile(scoreValues, 0.75),
        p90: percentile(scoreValues, 0.9)
      },
      sampleSize: scoreValues.length
    },
    byAgent: agentsOut,
    unassigned
  };
}
