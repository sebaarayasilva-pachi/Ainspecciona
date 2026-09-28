import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareAnalyses } from './compare.js';
import { acceptJudgeDecision, resolveConsensus, twoThirdsMajority, voteKey } from './resolve.js';
import {
  CONSENSUS_STATUS,
  FINAL_STATUS,
  analysisSeverity,
  normalizeAnalysis
} from './schema.js';
import { applyTaxonomyGuards, kpiForFindingCode } from './taxonomy.js';
import { DEFAULT_CONSENSUS_CONFIG } from './config.js';
import { normalizeScoreConfig } from '../scoring/scoringV2_2.js';
import {
  AUTHOR,
  authorFromItoChoice,
  authorFromResolved,
  shouldWriteConsensusToSlot,
  slotPatchFromAnalysis,
  winningAnalysis
} from './applyToSlot.js';

function obs(code, { detected = true, severity = 'OK', confidence = 0.9, evidence = ['fixture'] } = {}) {
  return { code, detected, severity, confidence, evidence };
}

function analysis({ evaluability = 'EVALUABLE', observations = [], observation = '' } = {}) {
  return normalizeAnalysis({
    evaluability,
    observations,
    observation,
    interpretation: observation,
    cause: '',
    limitations: []
  });
}

describe('Consenso shadow — tests 1–6', () => {
  it('1. Tablero WVUXLLWN: A/B RCD_PRESENT/OK → CONFIRMED_OK; Judge no deja RCD_MISSING', () => {
    const present = analysis({
      observations: [obs('RCD_PRESENT', { severity: 'OK', evidence: ['botón T', '30 mA'] })],
      observation: 'Se observa interruptor diferencial con botón de prueba T'
    });
    const agree = compareAnalyses(present, present);
    assert.equal(agree.consensusStatus, CONSENSUS_STATUS.AGREE);
    const ok = resolveConsensus({
      analysisA: present,
      analysisB: present,
      compareResult: agree
    });
    assert.equal(ok.finalStatus, FINAL_STATUS.CONFIRMED_OK);
    assert.notEqual(ok.finalFindingCode, 'RCD_MISSING');

    const missing = analysis({
      observations: [obs('RCD_MISSING', { severity: 'HIGH', evidence: ['no se identifica diferencial'] })],
      observation: 'El tablero carece de interruptor diferencial'
    });
    const disagree = compareAnalyses(missing, present);
    assert.equal(disagree.consensusStatus, CONSENSUS_STATUS.DISAGREE_FINDING);
    const judged = resolveConsensus({
      analysisA: missing,
      analysisB: present,
      compareResult: disagree,
      judge: {
        evaluability: 'EVALUABLE',
        chosenSide: 'B',
        finalFindingCode: 'RCD_PRESENT',
        detected: true,
        severity: 'OK',
        confidence: 0.92,
        rationale: 'Hay dispositivo compatible con diferencial',
        observations: [obs('RCD_PRESENT', { severity: 'OK', confidence: 0.92 })]
      }
    });
    assert.notEqual(judged.finalFindingCode, 'RCD_MISSING');
    assert.equal(judged.finalStatus, FINAL_STATUS.CONFIRMED_OK);
    assert.equal(judged.judgeTriggered, true);
  });

  it('2. Loggia: “no se detecta humedad” → no HUMIDITY_VISIBLE, severity OK', () => {
    const raw = analysis({
      observations: [obs('HUMIDITY_VISIBLE', { severity: 'MEDIUM' })],
      observation: 'En la loggia no se detecta humedad ni manchas de filtración'
    });
    const humid = raw.observations.find((o) => o.code === 'HUMIDITY_VISIBLE');
    assert.ok(humid);
    assert.equal(humid.detected, false);
    assert.equal(analysisSeverity(raw), 'OK');
  });

  it('3. Muro lavaplatos: CORROSION → KPI Sanitarios, no Humedad', () => {
    assert.equal(kpiForFindingCode('CORROSION'), 'SANITARIOS');
    assert.notEqual(kpiForFindingCode('CORROSION'), 'HUMEDAD');
    const guarded = applyTaxonomyGuards({
      observations: [obs('CORROSION', { severity: 'LOW' })],
      narrative: 'corrosión de grifería en el muro del lavaplatos'
    });
    assert.equal(guarded[0].kpi, 'SANITARIOS');
    assert.notEqual(guarded[0].kpi, 'HUMEDAD');
  });

  it('4. Variación de tono → no subir automático a MEDIUM (cosmético = LOW)', () => {
    const raw = analysis({
      observations: [obs('PAINT_DISCOLORATION', { severity: 'MEDIUM' })],
      observation: 'variación de tono en pintura, sin grietas'
    });
    const tone = raw.observations.find((o) => o.code === 'PAINT_DISCOLORATION');
    assert.ok(tone?.detected);
    assert.equal(tone.severity, 'LOW');
    assert.notEqual(tone.severity, 'MEDIUM');
  });

  it('5. Ambos NOT_EVALUABLE → NO_EVALUABLE, sin hallazgo', () => {
    const a = analysis({ evaluability: 'NOT_EVALUABLE', observations: [] });
    const b = analysis({ evaluability: 'NOT_EVALUABLE', observations: [] });
    const cmp = compareAnalyses(a, b);
    assert.equal(cmp.consensusStatus, CONSENSUS_STATUS.AGREE);
    const resolved = resolveConsensus({
      analysisA: a,
      analysisB: b,
      compareResult: cmp
    });
    assert.equal(resolved.finalStatus, FINAL_STATUS.NO_EVALUABLE);
    assert.equal(resolved.finalFindingCode, null);
    assert.equal(resolved.finalSeverity, null);
  });

  it('6. Judge confidence 0.72 + HIGH safety → UNRESOLVED', () => {
    const judge = {
      evaluability: 'EVALUABLE',
      chosenSide: 'A',
      finalFindingCode: 'RCD_MISSING',
      detected: true,
      severity: 'HIGH',
      confidence: 0.72,
      rationale: 'posible ausencia',
      observations: [obs('RCD_MISSING', { severity: 'HIGH', confidence: 0.72 })]
    };
    assert.equal(acceptJudgeDecision(judge, { consensus: DEFAULT_CONSENSUS_CONFIG }), false);

    const a = analysis({ observations: [obs('RCD_MISSING', { severity: 'HIGH' })] });
    const b = analysis({ observations: [obs('RCD_PRESENT', { severity: 'OK' })] });
    const resolved = resolveConsensus({
      analysisA: a,
      analysisB: b,
      compareResult: { consensusStatus: CONSENSUS_STATUS.DISAGREE_FINDING },
      judge
    });
    assert.equal(resolved.finalStatus, FINAL_STATUS.UNRESOLVED);
    assert.equal(resolved.judgeTriggered, true);
  });

  it('7. Judge sin confidence raíz pero sí en observations → acepta si >= review', () => {
    const a = analysis({ observations: [obs('FLOOR_GAP', { severity: 'LOW' })] });
    const b = analysis({ observations: [obs('FLOOR_GAP', { severity: 'MEDIUM' })] });
    const judge = {
      evaluability: 'EVALUABLE',
      chosenSide: 'A',
      finalFindingCode: 'FLOOR_GAP',
      detected: true,
      severity: 'LOW',
      rationale: 'junta visible, gravedad baja',
      observations: [obs('FLOOR_GAP', { severity: 'LOW', confidence: 0.78 })]
    };
    assert.equal(acceptJudgeDecision(judge, { consensus: DEFAULT_CONSENSUS_CONFIG }), true);
    const resolved = resolveConsensus({
      analysisA: a,
      analysisB: b,
      compareResult: { consensusStatus: CONSENSUS_STATUS.DISAGREE_SEVERITY },
      judge
    });
    assert.equal(resolved.finalStatus, FINAL_STATUS.REVIEWED_FINDING);
    assert.equal(resolved.finalFindingCode, 'FLOOR_GAP');
    assert.equal(resolved.finalConfidence, 0.78);
  });

  it('8. Judge sin confidence en ningún lado → UNRESOLVED', () => {
    const a = analysis({ observations: [obs('PAINT_DISCOLORATION', { severity: 'LOW' })] });
    const b = analysis({ observations: [] });
    const judge = {
      evaluability: 'EVALUABLE',
      chosenSide: 'A',
      finalFindingCode: 'PAINT_DISCOLORATION',
      detected: true,
      severity: 'LOW',
      rationale: 'decoloración cosmética',
      observations: [{ code: 'PAINT_DISCOLORATION', detected: true, severity: 'LOW', evidence: ['tono'] }]
    };
    assert.equal(acceptJudgeDecision(judge, { consensus: DEFAULT_CONSENSUS_CONFIG }), false);
    const resolved = resolveConsensus({
      analysisA: a,
      analysisB: b,
      compareResult: { consensusStatus: CONSENSUS_STATUS.DISAGREE_FINDING },
      judge
    });
    assert.equal(resolved.finalStatus, FINAL_STATUS.UNRESOLVED);
  });

  it('9. NEITHER + confidence alta → UNRESOLVED (no cierra hallazgo)', () => {
    const a = analysis({ observations: [obs('WALL_CRACK', { severity: 'MEDIUM' })] });
    const b = analysis({ observations: [] });
    const judge = {
      evaluability: 'EVALUABLE',
      chosenSide: 'NEITHER',
      finalFindingCode: 'WALL_CRACK',
      detected: true,
      severity: 'MEDIUM',
      confidence: 0.91,
      rationale: 'no desempató',
      observations: [obs('WALL_CRACK', { severity: 'MEDIUM', confidence: 0.91 })]
    };
    assert.equal(twoThirdsMajority({
      analysisA: a,
      analysisB: b,
      verdict: judge,
      normalizedJudge: analysis({ observations: [obs('WALL_CRACK', { severity: 'MEDIUM' })] })
    }).ok, false);
    const resolved = resolveConsensus({
      analysisA: a,
      analysisB: b,
      compareResult: { consensusStatus: CONSENSUS_STATUS.DISAGREE_FINDING },
      judge
    });
    assert.equal(resolved.finalStatus, FINAL_STATUS.UNRESOLVED);
  });

  it('10. Hallazgo vs OK + chosenSide A + conf >= 0.65 → 2/3 REVIEWED', () => {
    const a = analysis({ observations: [obs('FLOOR_GAP', { severity: 'LOW' })] });
    const b = analysis({ observations: [] });
    assert.equal(voteKey(a), 'FLOOR_GAP');
    assert.equal(voteKey(b), 'OK');
    const resolved = resolveConsensus({
      analysisA: a,
      analysisB: b,
      compareResult: { consensusStatus: CONSENSUS_STATUS.DISAGREE_FINDING },
      judge: {
        evaluability: 'EVALUABLE',
        chosenSide: 'A',
        finalFindingCode: 'FLOOR_GAP',
        detected: true,
        severity: 'LOW',
        confidence: 0.72,
        rationale: 'junta visible en la foto',
        observations: [obs('FLOOR_GAP', { severity: 'LOW', confidence: 0.72 })]
      }
    });
    assert.equal(resolved.finalStatus, FINAL_STATUS.REVIEWED_FINDING);
    assert.equal(resolved.finalFindingCode, 'FLOOR_GAP');
  });

  it('11. chosenSide A pero confidence < 0.65 → ITO', () => {
    const a = analysis({ observations: [obs('FLOOR_GAP', { severity: 'LOW' })] });
    const b = analysis({ observations: [] });
    const resolved = resolveConsensus({
      analysisA: a,
      analysisB: b,
      compareResult: { consensusStatus: CONSENSUS_STATUS.DISAGREE_FINDING },
      judge: {
        evaluability: 'EVALUABLE',
        chosenSide: 'A',
        finalFindingCode: 'FLOOR_GAP',
        detected: true,
        severity: 'LOW',
        confidence: 0.5,
        rationale: 'duda',
        observations: [obs('FLOOR_GAP', { severity: 'LOW', confidence: 0.5 })]
      }
    });
    assert.equal(resolved.finalStatus, FINAL_STATUS.UNRESOLVED);
  });

  it('normalizeScoreConfig incluye consensus', () => {
    const cfg = normalizeScoreConfig({});
    assert.equal(cfg.consensus.judgeAccept, 0.85);
    assert.equal(cfg.consensus.judgeHighSafety, 0.95);
    assert.ok(Array.isArray(cfg.consensus.safetyCodes));
  });

  it('write-back: AGREE → autor GPT-4o y Gemini; juez → Claude; ITO elige IA', () => {
    assert.equal(shouldWriteConsensusToSlot(FINAL_STATUS.CONFIRMED_OK), true);
    assert.equal(shouldWriteConsensusToSlot(FINAL_STATUS.UNRESOLVED), false);
    assert.equal(authorFromResolved({ finalStatus: FINAL_STATUS.CONFIRMED_FINDING, judgeTriggered: false }).label, AUTHOR.OPENAI_GEMINI.label);
    assert.equal(authorFromResolved({ finalStatus: FINAL_STATUS.REVIEWED_FINDING, judgeTriggered: true }).label, AUTHOR.CLAUDE.label);
    assert.equal(authorFromItoChoice('gemini').label, AUTHOR.GEMINI.label);
    assert.equal(authorFromItoChoice('none').label, AUTHOR.ITO.label);
    const gap = analysis({ observations: [obs('FLOOR_GAP', { severity: 'LOW' })], observation: 'junta visible' });
    const patch = slotPatchFromAnalysis({ analysisCode: 'COSMETIC_WEAR', analysisDebug: {} }, gap, {
      author: AUTHOR.CLAUDE,
      finalStatus: FINAL_STATUS.REVIEWED_FINDING,
      finalFindingCode: 'FLOOR_GAP',
      finalSeverity: 'LOW',
      finalConfidence: 0.8
    });
    assert.equal(patch.analysisCode, 'FLOOR_GAP');
    assert.equal(patch.analysisSeverity, 'low');
    assert.equal(patch.analysisDebug.consensus.author.label, 'Claude');
    assert.match(String(patch.analysisDebug.openai.parsed.description || ''), /junta visible/);
    assert.ok(patch.analysisDebug.openai.parsed.kpi_analysis);
  });

  it('juez 2/3 usa el relato del lado ganador, no la jerga del juez', () => {
    const a = analysis({
      observations: [obs('CORROSION', { severity: 'MEDIUM' })],
      observation: 'Oxidación puntual en el flexible metálico del WC.'
    });
    const b = analysis({ observations: [], observation: 'Sin deterioro visible.' });
    const winner = winningAnalysis({
      analysisA: a,
      analysisB: b,
      judge: {
        chosenSide: 'A',
        rationale: 'Ambos análisis coinciden en CORROSION. El análisis B añade HUMIDITY_VISIBLE',
        analysis: {
          observation: 'Ambos análisis coinciden en CORROSION con severidad MEDIUM.',
          observations: [obs('CORROSION', { severity: 'MEDIUM' })]
        }
      },
      finalStatus: FINAL_STATUS.REVIEWED_FINDING,
      judgeTriggered: true
    });
    assert.match(winner.observation, /[Oo]xidaci/);
    assert.doesNotMatch(winner.observation, /Ambos análisis/);
    assert.doesNotMatch(winner.observation, /HUMIDITY_VISIBLE/);
    const patch = slotPatchFromAnalysis({ analysisDebug: {} }, winner, {
      author: AUTHOR.CLAUDE,
      finalStatus: FINAL_STATUS.REVIEWED_FINDING,
      finalFindingCode: 'CORROSION',
      finalSeverity: 'MEDIUM',
      finalConfidence: 0.88
    });
    assert.doesNotMatch(patch.analysisMessage, /Ambos análisis/);
    assert.match(patch.analysisMessage, /[Oo]xidaci/);
  });
});
