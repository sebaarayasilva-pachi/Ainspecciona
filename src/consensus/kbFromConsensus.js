/**
 * Alimenta la KB/RAG con el cierre del trío y con la elección del ITO.
 */
import { createKnowledgeEntry } from '../aintelligence/kb/createEntry.js';
import { FINAL_STATUS } from './schema.js';
import { compactAnalysis } from './applyToSlot.js';
import { isOkConfirmCode } from './taxonomy.js';
import { analysisSeverity, primaryObservation } from './schema.js';

function compactSafe(analysis) {
  try {
    return compactAnalysis(analysis);
  } catch {
    return null;
  }
}

function narrative(analysis) {
  const c = compactSafe(analysis);
  if (!c || c.error) return '';
  return [c.observation, c.interpretation, c.cause].filter(Boolean).join(' ').trim();
}

function sevOf(analysis, fallback) {
  const s = String(analysisSeverity(analysis) || fallback || '').toLowerCase();
  if (['low', 'medium', 'high', 'critical', 'none'].includes(s)) return s;
  if (s === 'ok') return 'none';
  return null;
}

function isFinding(analysis) {
  const primary = primaryObservation(analysis);
  return !!(primary && primary.detected && !isOkConfirmCode(primary.code));
}

function sideLabel(key) {
  if (key === 'openai') return 'GPT-4o';
  if (key === 'gemini') return 'Gemini';
  if (key === 'claude') return 'Claude';
  return key;
}

async function writeKb(prisma, entry, log) {
  return createKnowledgeEntry(prisma, entry, log);
}

export async function ingestAutoConsensusKb({
  prisma,
  slot,
  caseId,
  kpi,
  analysisOpenAI,
  analysisGemini,
  analysisClaude,
  resolved,
  author,
  log
} = {}) {
  if (!prisma || !slot) return { ok: false, skipped: true };
  const status = resolved?.finalStatus;
  if (status === FINAL_STATUS.UNRESOLVED || status === FINAL_STATUS.NO_EVALUABLE) {
    return { ok: true, skipped: true, reason: status };
  }

  const winner = resolved?.judgeTriggered
    ? (analysisClaude?.analysis || analysisClaude)
    : (isFinding(analysisOpenAI) ? analysisOpenAI : analysisGemini) || analysisOpenAI;
  const winnerCompact = compactSafe(winner);
  const title = slot.title || slot.slotCode || 'slot';
  const code = resolved?.finalFindingCode || winnerCompact?.primaryCode || 'OK';
  const textFinding = `[${title}] Consenso ${author?.label || ''}: ${code}` +
    (resolved?.finalSeverity ? ` / ${resolved.finalSeverity}` : '') +
    `. ${narrative(winner) || 'Sin hallazgo visual confirmado.'}`;
  const textOk = `[${title}] Consenso ${author?.label || ''}: sin hallazgo. ${narrative(winner) || 'Evidencia OK.'}`;

  const payload = {
    author,
    finalStatus: status,
    openai: compactSafe(analysisOpenAI),
    gemini: compactSafe(analysisGemini),
    claude: compactSafe(analysisClaude?.analysis || analysisClaude)
  };

  const created = [];
  const example = await writeKb(prisma, {
    source: 'AINSPECTA',
    entryType: 'finding_example',
    text: status === FINAL_STATUS.CONFIRMED_OK ? textOk : textFinding,
    kpiKey: kpi || null,
    severity: status === FINAL_STATUS.CONFIRMED_OK ? 'none' : sevOf(winner, resolved?.finalSeverity),
    payload,
    sourceRef: `case:${caseId}|slot:${slot.id}|consensus:${status}`,
    createdBy: 'consensus',
    status: 'approved'
  }, log);
  created.push(example);

  if (resolved?.judgeTriggered && analysisOpenAI && analysisGemini) {
    const loser = isFinding(analysisOpenAI) && !isFinding(winner) ? analysisOpenAI
      : (isFinding(analysisGemini) && !isFinding(winner) ? analysisGemini
        : (winner === analysisOpenAI ? analysisGemini : analysisOpenAI));
    if (loser && isFinding(loser) && compactSafe(loser)?.primaryCode !== compactSafe(winner)?.primaryCode) {
      const loseCode = compactSafe(loser)?.primaryCode;
      const anti = await writeKb(prisma, {
        source: 'AINSPECTA',
        entryType: 'anti_example',
        text: `[${title}] NO clasificar como ${loseCode} cuando el consenso (${author?.label}) cerró como ${code}. Observación descartada: «${narrative(loser) || '—'}».`,
        kpiKey: kpi || null,
        severity: 'none',
        payload: { ...payload, discarded: compactSafe(loser) },
        sourceRef: `case:${caseId}|slot:${slot.id}|consensus:${status}|anti`,
        createdBy: 'consensus',
        status: 'approved'
      }, log);
      created.push(anti);
    }
  }

  return { ok: true, created };
}

export async function ingestItoChoiceKb({
  prisma,
  slot,
  caseId,
  kpi,
  choice,
  author,
  analysisOpenAI,
  analysisGemini,
  analysisClaude,
  human,
  log
} = {}) {
  if (!prisma || !slot) return { ok: false, skipped: true };
  const title = slot.title || slot.slotCode || 'slot';
  const sides = {
    openai: analysisOpenAI,
    gemini: analysisGemini,
    claude: analysisClaude?.analysis || analysisClaude
  };
  const payload = {
    author,
    choice,
    openai: compactSafe(sides.openai),
    gemini: compactSafe(sides.gemini),
    claude: compactSafe(sides.claude),
    human: human || null
  };
  const created = [];

  if (choice && choice !== 'none') {
    const winner = sides[choice];
    const w = compactSafe(winner);
    const code = w?.primaryCode || (isFinding(winner) ? 'HALLAZGO' : 'OK');
    const example = await writeKb(prisma, {
      source: 'AINSPECTA',
      entryType: 'finding_example',
      text: `[${title}] ITO eligió ${author?.label || choice}: ${code}. ${narrative(winner) || 'Criterio confirmado.'}`,
      kpiKey: kpi || null,
      severity: isFinding(winner) ? sevOf(winner) : 'none',
      payload,
      sourceRef: `case:${caseId}|slot:${slot.id}|ito|${choice}`,
      createdBy: 'ito',
      status: 'approved'
    }, log);
    created.push(example);
    for (const [key, analysis] of Object.entries(sides)) {
      if (key === choice || !analysis || analysis.error) continue;
      if (!isFinding(analysis) && !isFinding(winner)) continue;
      const lose = compactSafe(analysis)?.primaryCode || 'OK';
      if (lose === code) continue;
      created.push(await writeKb(prisma, {
        source: 'AINSPECTA',
        entryType: 'anti_example',
        text: `[${title}] NO clasificar como ${lose} (${sideLabel(key)}). El ITO eligió ${author?.label}: ${code}. Descartado: «${narrative(analysis) || '—'}».`,
        kpiKey: kpi || null,
        severity: 'none',
        payload: { ...payload, discarded: compactSafe(analysis), discardedSide: key },
        sourceRef: `case:${caseId}|slot:${slot.id}|ito|anti:${key}`,
        createdBy: 'ito',
        status: 'approved'
      }, log));
    }
    return { ok: true, created };
  }

  const humanCode = String(human?.humanCode || 'OK').toUpperCase();
  const humanMsg = String(human?.humanMessage || '').trim();
  created.push(await writeKb(prisma, {
    source: 'AINSPECTA',
    entryType: 'correction',
    text: `[${title}] ITO: ninguna IA. Criterio: ${humanCode}${human?.humanSeverity ? '/' + human.humanSeverity : ''}${humanMsg ? `: «${humanMsg}»` : ''}.`,
    kpiKey: kpi || null,
    severity: humanCode === 'OK' ? 'none' : (['low', 'medium', 'high'].includes(String(human?.humanSeverity || '').toLowerCase()) ? String(human.humanSeverity).toLowerCase() : null),
    payload,
    sourceRef: `case:${caseId}|slot:${slot.id}|ito|none`,
    createdBy: 'ito',
    status: 'approved'
  }, log));
  for (const [key, analysis] of Object.entries(sides)) {
    if (!analysis || analysis.error || !isFinding(analysis)) continue;
    const lose = compactSafe(analysis)?.primaryCode;
    if (!lose) continue;
    created.push(await writeKb(prisma, {
      source: 'AINSPECTA',
      entryType: 'anti_example',
      text: `[${title}] NO clasificar como ${lose} (${sideLabel(key)}). El ITO descartó las IA. Descartado: «${narrative(analysis) || '—'}».`,
      kpiKey: kpi || null,
      severity: 'none',
      payload: { ...payload, discarded: compactSafe(analysis), discardedSide: key },
      sourceRef: `case:${caseId}|slot:${slot.id}|ito|none|anti:${key}`,
      createdBy: 'ito',
      status: 'approved'
    }, log));
  }
  return { ok: true, created };
}
