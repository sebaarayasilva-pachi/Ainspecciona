import { isShadowEnabled, normalizeConsensusConfig, shadowRoles } from './config.js';
import { missingShadowKeys, runShadowForCase } from './runShadow.js';
import { normalizeJudgeVerdict } from './schema.js';

/**
 * Admin: relanzar sombra y listar vs producción. No escribe el informe.
 */
export async function registerConsensusAdminRoutes(app, {
  prisma,
  storage,
  getRuntimeScoreConfig,
  persistCaseScore,
  onCaseReady
} = {}) {
  if (!prisma) {
    app.log.warn('consensus admin routes: prisma no disponible');
    return;
  }

  app.get('/api/admin/consensus/shadow/:caseId', async (req, reply) => {
    const rawId = String(req.params.caseId || '').trim();
    if (!rawId) return reply.code(400).send({ ok: false, error: 'CASE_ID_REQUIRED' });
    const caze = await prisma.case.findFirst({
      where: { OR: [{ id: rawId }, { shortId: rawId }] },
      select: { id: true, shortId: true, status: true, finalScore: true }
    });
    if (!caze) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

    const rows = await prisma.photoAnalysisShadow.findMany({
      where: { caseId: caze.id },
      orderBy: { createdAt: 'asc' }
    });
    const slots = await prisma.slot.findMany({
      where: { caseId: caze.id },
      select: {
        id: true,
        slotCode: true,
        title: true,
        analysisSeverity: true,
        analysisCode: true,
        orderIndex: true,
        photoId: true
      }
    });
    const slotById = Object.fromEntries(slots.map((s) => [s.id, s]));
    const runtime = await getRuntimeScoreConfig({ force: true }).catch(() => ({ config: {} }));
    const consensus = normalizeConsensusConfig(runtime?.config || {});
    const roles = shadowRoles();
    const sorted = rows.slice().sort((a, b) => {
      const ia = slotById[a.slotId]?.orderIndex ?? 999;
      const ib = slotById[b.slotId]?.orderIndex ?? 999;
      return ia - ib;
    });

    return reply.send({
      ok: true,
      case: caze,
      shadowEnabled: isShadowEnabled(runtime?.config),
      missingKeys: missingShadowKeys(),
      consensus,
      roles,
      rows: sorted.map((r) => {
        const slot = slotById[r.slotId] || {};
        const photoId = r.photoId || slot.photoId || null;
        return {
          id: r.id,
          slotId: r.slotId,
          slotCode: slot.slotCode || null,
          title: slot.title || null,
          photoId,
          photoUrl: photoId ? `/api/photos/${photoId}` : null,
          kpi: r.kpi,
          prodSeverity: r.prodSeverity ?? slot.analysisSeverity ?? null,
          prodFinding: r.prodFinding ?? slot.analysisCode ?? null,
          consensusStatus: r.consensusStatus,
          finalStatus: r.finalStatus,
          finalFindingCode: r.finalFindingCode,
          finalSeverity: r.finalSeverity,
          finalConfidence: r.finalConfidence,
          judgeTriggered: r.judgeTriggered,
          ...mapShadowAnalyses(r),
          openaiLatencyMs: r.openaiLatencyMs,
          geminiLatencyMs: r.geminiLatencyMs,
          claudeLatencyMs: r.claudeLatencyMs,
          updatedAt: r.updatedAt
        };
      })
    });
  });

  app.post('/api/admin/consensus/shadow/:caseId', async (req, reply) => {
    const rawId = String(req.params.caseId || '').trim();
    if (!rawId) return reply.code(400).send({ ok: false, error: 'CASE_ID_REQUIRED' });
    try {
      const result = await runShadowForCase({
        caseId: rawId,
        prisma,
        storage,
        getRuntimeScoreConfig,
        persistCaseScore,
        onCaseReady,
        log: req.log
      });
      if (!result.ok && result.error === 'CASE_NOT_FOUND') {
        return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });
      }
      return reply.send({
        ok: true,
        caseId: result.caseId,
        shortId: result.shortId,
        count: result.count,
        skipped: (result.results || []).filter((x) => x.skipped).length,
        failed: (result.results || []).filter((x) => !x.ok && !x.skipped).length
      });
    } catch (err) {
      req.log.error({ err }, 'admin consensus shadow rerun');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });
}

function looksLikeJudge(json) {
  if (!json || typeof json !== 'object' || json.error) return false;
  return json.chosenSide != null || json.rationale != null || json.meta?.thinkingLevel != null;
}

function mapShadowAnalyses(r) {
  const geminiIsJudge = looksLikeJudge(r.analysisGemini);
  const analystA = expandAnalysis(r.analysisOpenAI);
  const analystB = expandAnalysis(geminiIsJudge ? r.analysisClaude : r.analysisGemini);
  const judge = expandJudge(geminiIsJudge ? r.analysisGemini : r.analysisClaude);
  return {
    analystA,
    analystB,
    judge,
    openai: analystA,
    claude: geminiIsJudge ? analystB : judge,
    gemini: geminiIsJudge ? judge : analystB
  };
}

function compactObservations(observations) {
  if (!Array.isArray(observations)) return [];
  return observations.map((o) => ({
    code: o?.code || null,
    detected: !!o?.detected,
    severity: o?.severity || null,
    confidence: o?.confidence ?? null,
    evidence: Array.isArray(o?.evidence) ? o.evidence.map(String) : []
  }));
}

function expandAnalysis(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.error) return { error: String(json.error) };
  const observations = compactObservations(json.observations);
  const findings = observations.filter((o) => o.detected);
  return {
    evaluability: json.evaluability || null,
    observation: String(json.observation || '').trim(),
    interpretation: String(json.interpretation || '').trim(),
    cause: String(json.cause || '').trim(),
    limitations: Array.isArray(json.limitations) ? json.limitations.map(String) : [],
    observations,
    codes: findings.map((o) => o.code).filter(Boolean),
    severity: findings[0]?.severity || (json.evaluability === 'NOT_EVALUABLE' ? null : 'OK'),
    model: json.meta?.model || null
  };
}

function expandJudge(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.error) return { error: String(json.error) };
  const verdict = normalizeJudgeVerdict(json);
  return {
    chosenSide: verdict.chosenSide || json.chosenSide || null,
    finalFindingCode: verdict.finalFindingCode || json.finalFindingCode || null,
    severity: verdict.severity || json.severity || null,
    confidence: verdict.confidence ?? json.confidence ?? null,
    evaluability: verdict.evaluability || json.evaluability || null,
    rationale: verdict.rationale || String(json.rationale || json.analysis?.observation || '').trim(),
    observations: compactObservations(verdict.observations || json.observations),
    model: json.meta?.model || null
  };
}
