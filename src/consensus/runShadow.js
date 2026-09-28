/**
 * Consenso de producción: escribe Slot cuando hay 2/3; UNRESOLVED va a ITO.
 */
import { classifyKpiFromSlot, normalizeScoreConfig } from '../scoring/scoringV2_2.js';
import { isShadowEnabled, normalizeConsensusConfig } from './config.js';
import { compareAnalyses, needsJudge } from './compare.js';
import { resolveConsensus } from './resolve.js';
import { CONSENSUS_STATUS, FINAL_STATUS, emptyAnalysis } from './schema.js';
import { TAXONOMY_VERSION } from './taxonomy.js';
import { analyzeWithOpenAI } from './providers/openai.js';
import { analyzeWithGemini } from './providers/gemini.js';
import { judgeWithClaude } from './providers/claudeJudge.js';
import {
  applyConsensusPatch,
  authorFromResolved,
  shouldWriteConsensusToSlot,
  slotPatchFromAnalysis,
  winningAnalysis
} from './applyToSlot.js';
import { ingestAutoConsensusKb } from './kbFromConsensus.js';
import { isCaseConsensusComplete } from './caseReady.js';

export function missingShadowKeys() {
  const missing = [];
  if (!String(process.env.OPENAI_API_KEY || '').trim()) missing.push('OPENAI_API_KEY');
  if (!String(process.env.GEMINI_API_KEY || '').trim()) missing.push('GEMINI_API_KEY');
  if (!String(process.env.ANTHROPIC_API_KEY || '').trim()) missing.push('ANTHROPIC_API_KEY');
  return missing;
}

function prodFindingFromSlot(slot) {
  const parsed = slot?.analysisDebug?.openai?.parsed || {};
  return parsed.findingType || slot?.analysisCode || null;
}

async function persistShadow(prisma, data) {
  return prisma.photoAnalysisShadow.upsert({
    where: { slotId: data.slotId },
    create: data,
    update: {
      ...data,
      createdAt: undefined
    }
  });
}

export async function runShadow({
  slotId,
  prisma,
  storage,
  getRuntimeScoreConfig,
  persistCaseScore,
  onCaseReady,
  log,
  providers = {}
} = {}) {
  const logger = log || console;
  if (!prisma || !slotId) return { ok: false, skipped: true, reason: 'missing_deps' };

  let scoreConfig = {};
  try {
    const runtime = typeof getRuntimeScoreConfig === 'function'
      ? await getRuntimeScoreConfig()
      : {};
    scoreConfig = normalizeScoreConfig(runtime?.config || runtime || {});
  } catch (err) {
    logger.warn?.({ err: err?.message, slotId }, 'consensus-shadow-config');
    scoreConfig = normalizeScoreConfig({});
  }

  if (!isShadowEnabled(scoreConfig)) {
    return { ok: false, skipped: true, reason: 'shadow_disabled' };
  }

  const missing = missingShadowKeys();
  if (missing.length) {
    logger.warn?.({ slotId, missing }, 'consensus-shadow-missing-keys');
    return { ok: false, skipped: true, reason: 'missing_keys', missing };
  }

  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { photo: true, case: { select: { id: true } } }
  }).catch(() => null);
  if (!slot?.photo?.filePath) {
    return { ok: false, skipped: true, reason: 'no_photo' };
  }

  const consensus = normalizeConsensusConfig(scoreConfig);
  const kpi = classifyKpiFromSlot(slot, scoreConfig.slotKpiMap);
  const findingKpiMap = scoreConfig.findingKpiMap;

  let imageBase64;
  let mimeType = slot.photo.mimeType || 'image/jpeg';
  try {
    const buf = await storage.readBuffer(slot.photo.filePath);
    imageBase64 = buf.toString('base64');
  } catch (err) {
    logger.warn?.({ err: err?.message, slotId }, 'consensus-shadow-read-photo');
    return { ok: false, skipped: true, reason: 'read_photo_failed' };
  }

  const analyzeOpenAI = providers.analyzeWithOpenAI || analyzeWithOpenAI;
  const analyzeGemini = providers.analyzeWithGemini || analyzeWithGemini;
  const judgeFn = providers.judgeWithClaude || judgeWithClaude;

  const shared = {
    imageBase64,
    mimeType,
    slotTitle: slot.title,
    slotCode: slot.slotCode,
    kpiKey: kpi,
    findingKpiMap
  };

  const [openaiSettled, geminiSettled] = await Promise.allSettled([
    analyzeOpenAI(shared),
    analyzeGemini(shared)
  ]);

  const openaiOk = openaiSettled.status === 'fulfilled';
  const geminiOk = geminiSettled.status === 'fulfilled';
  const openaiRes = openaiOk ? openaiSettled.value : null;
  const geminiRes = geminiOk ? geminiSettled.value : null;

  if (!openaiOk) logger.warn?.({ err: openaiSettled.reason?.message, slotId }, 'consensus-shadow-openai-fail');
  if (!geminiOk) logger.warn?.({ err: geminiSettled.reason?.message, slotId }, 'consensus-shadow-gemini-fail');

  const analysisOpenAI = openaiRes?.analysis || null;
  const analysisGemini = geminiRes?.analysis || null;

  const compareResult = compareAnalyses(
    analysisOpenAI || emptyAnalysis(),
    analysisGemini || emptyAnalysis(),
    { providerAFailed: !openaiOk, providerBFailed: !geminiOk }
  );

  let judge = null;
  let judgeFailed = false;
  let judgeRes = null;
  let judgeError = null;
  const shouldJudge = needsJudge(compareResult.consensusStatus)
    && (openaiOk || geminiOk);

  if (shouldJudge) {
    try {
      judgeRes = await judgeFn({
        analysisA: analysisOpenAI || emptyAnalysis({ evaluability: 'NOT_EVALUABLE', limitations: ['provider_fail'] }),
        analysisB: analysisGemini || emptyAnalysis({ evaluability: 'NOT_EVALUABLE', limitations: ['provider_fail'] }),
        imageBase64,
        mimeType,
        findingKpiMap
      });
      judge = judgeRes.judge;
    } catch (err) {
      judgeFailed = true;
      judgeError = String(err?.message || 'judge_failed');
      logger.warn?.({ err: judgeError, slotId }, 'consensus-shadow-judge-fail');
    }
  }

  const resolved = resolveConsensus({
    analysisA: analysisOpenAI,
    analysisB: analysisGemini,
    compareResult,
    judge,
    judgeFailed: shouldJudge && (judgeFailed || !judge),
    consensusConfig: consensus
  });

  const row = {
    caseId: slot.caseId,
    slotId: slot.id,
    photoId: slot.photoId || slot.photo.id,
    kpi,
    analysisOpenAI: openaiRes ? { ...openaiRes.analysis, meta: { tokens: openaiRes.tokens, latencyMs: openaiRes.latencyMs, model: openaiRes.model } } : { error: String(openaiSettled.reason?.message || 'fail') },
    analysisGemini: geminiRes ? { ...geminiRes.analysis, meta: { tokens: geminiRes.tokens, latencyMs: geminiRes.latencyMs, model: geminiRes.model } } : { error: String(geminiSettled.reason?.message || 'fail') },
    analysisClaude: judge ? { ...judge, meta: { tokens: judgeRes?.tokens, latencyMs: judgeRes?.latencyMs, model: judgeRes?.model, swapped: judgeRes?.swapped } } : (judgeFailed ? { error: judgeError || 'judge_failed' } : null),
    consensusStatus: compareResult.consensusStatus || CONSENSUS_STATUS.PROVIDER_FAIL,
    finalStatus: resolved.finalStatus || FINAL_STATUS.UNRESOLVED,
    finalFindingCode: resolved.finalFindingCode,
    finalSeverity: resolved.finalSeverity,
    finalConfidence: resolved.finalConfidence,
    judgeTriggered: !!resolved.judgeTriggered,
    taxonomyVersion: consensus.taxonomyVersion || TAXONOMY_VERSION,
    openaiPromptVersion: openaiRes?.promptVersion || consensus.openaiPromptVersion,
    geminiPromptVersion: geminiRes?.promptVersion || consensus.geminiPromptVersion,
    judgePromptVersion: judgeRes?.promptVersion || consensus.judgePromptVersion,
    consensusEngineVersion: consensus.consensusEngineVersion,
    openaiTokens: openaiRes?.tokens ?? null,
    geminiTokens: geminiRes?.tokens ?? null,
    claudeTokens: judgeRes?.tokens ?? null,
    openaiLatencyMs: openaiRes?.latencyMs ?? null,
    geminiLatencyMs: geminiRes?.latencyMs ?? null,
    claudeLatencyMs: judgeRes?.latencyMs ?? null,
    prodSeverity: slot.analysisSeverity || null,
    prodFinding: prodFindingFromSlot(slot)
  };

  try {
    await persistShadow(prisma, row);
  } catch (err) {
    logger.warn?.({ err: err?.message, slotId }, 'consensus-shadow-persist');
    return { ok: false, skipped: false, reason: 'persist_failed', error: err?.message, row };
  }

  if (shouldWriteConsensusToSlot(resolved.finalStatus)) {
    const author = authorFromResolved(resolved);
    const winner = winningAnalysis({
      analysisA: analysisOpenAI,
      analysisB: analysisGemini,
      judge,
      finalStatus: resolved.finalStatus,
      judgeTriggered: resolved.judgeTriggered
    });
    try {
      const fresh = await prisma.slot.findUnique({ where: { id: slot.id } });
      const patch = slotPatchFromAnalysis(fresh || slot, winner, {
        author,
        finalStatus: resolved.finalStatus,
        finalFindingCode: resolved.finalFindingCode,
        finalSeverity: resolved.finalSeverity,
        finalConfidence: resolved.finalConfidence,
        engineVersion: consensus.consensusEngineVersion
      });
      await applyConsensusPatch(prisma, slot, patch);
      if (typeof persistCaseScore === 'function') {
        await persistCaseScore(slot.caseId).catch((err) => {
          logger.warn?.({ err: err?.message, slotId }, 'consensus-persist-score');
        });
      }
      await ingestAutoConsensusKb({
        prisma,
        slot: fresh || slot,
        caseId: slot.caseId,
        kpi,
        analysisOpenAI,
        analysisGemini,
        analysisClaude: judge,
        resolved,
        author,
        log: logger
      }).catch((err) => {
        logger.warn?.({ err: err?.message, slotId }, 'consensus-kb-failed');
      });
    } catch (err) {
      logger.warn?.({ err: err?.message, slotId }, 'consensus-writeback-failed');
    }
  }

  try {
    if (typeof onCaseReady === 'function' && await isCaseConsensusComplete(prisma, slot.caseId)) {
      await onCaseReady(slot.caseId);
    }
  } catch (err) {
    logger.warn?.({ err: err?.message, caseId: slot.caseId }, 'consensus-on-case-ready');
  }

  return { ok: true, skipped: false, row };
}

export function scheduleShadow(args) {
  setImmediate(() => {
    runShadow(args).catch((err) => {
      args?.log?.warn?.({ err: err?.message, slotId: args?.slotId }, 'consensus-shadow-unhandled');
    });
  });
}

export async function runShadowForCase({
  caseId,
  prisma,
  storage,
  getRuntimeScoreConfig,
  persistCaseScore,
  onCaseReady,
  log
} = {}) {
  const caze = await prisma.case.findFirst({
    where: { OR: [{ id: caseId }, { shortId: caseId }] },
    select: { id: true, shortId: true }
  });
  if (!caze) return { ok: false, error: 'CASE_NOT_FOUND' };
  const slots = await prisma.slot.findMany({
    where: { caseId: caze.id, photoId: { not: null } },
    select: { id: true }
  });
  const results = [];
  const concurrency = Math.max(1, Math.min(3, Number(process.env.CONSENSUS_SHADOW_CONCURRENCY || 3)));
  for (let i = 0; i < slots.length; i += concurrency) {
    const batch = slots.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(async (s) => {
      try {
        return await runShadow({
          slotId: s.id,
          prisma,
          storage,
          getRuntimeScoreConfig,
          persistCaseScore,
          onCaseReady,
          log
        });
      } catch (err) {
        log?.warn?.({ err: err?.message, slotId: s.id }, 'consensus-shadow-case-slot');
        return { ok: false, slotId: s.id, error: err?.message };
      }
    }));
    results.push(...batchResults);
  }
  return { ok: true, caseId: caze.id, shortId: caze.shortId, count: results.length, results };
}
