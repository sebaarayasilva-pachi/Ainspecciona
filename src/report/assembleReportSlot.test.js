import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assembleReportSlot, sanitizeReportNarrative } from './assembleReportSlot.js';
import { DEFAULT_V4_POLICY } from '../scoring/scoringV4.js';
import { classifyKpiFromSlot, normalizeScoreConfig } from '../scoring/scoringV2_2.js';

const cfg = normalizeScoreConfig({ ...DEFAULT_V4_POLICY, engineVersion: '4.0' });

describe('assembleReportSlot', () => {
  it('limpia jerga del juez 2/3', () => {
    const raw = 'Se ve corrosión en el flexible. Ambos análisis coinciden en CORROSION con severidad MEDIUM. El análisis B añade HUMIDITY_VISIBLE';
    const clean = sanitizeReportNarrative(raw);
    assert.match(clean, /corrosión/);
    assert.doesNotMatch(clean, /Ambos análisis/);
    assert.doesNotMatch(clean, /HUMIDITY_VISIBLE/);
  });

  it('si hay hallazgo, no manda el texto viejo de “sin hallazgos”', () => {
    const slot = {
      id: '1',
      slotCode: 'BATHROOM_3_WC_PIPES',
      title: 'Baño 3 – Cañerías WC',
      status: 'ANALYZED',
      analysisCode: 'CORROSION',
      analysisSeverity: 'medium',
      analysisMessage: 'Corrosión en el flexible metálico. Ambos análisis coinciden en CORROSION con severidad MEDIUM.',
      analysisDebug: {
        consensus: { author: { key: 'claude', label: 'Claude' }, finalStatus: 'REVIEWED_FINDING' },
        openai: {
          parsed: {
            description: 'La imagen muestra un inodoro. No se observan signos de corrosión.',
            kpi_analysis: 'No se detectan hallazgos relevantes visibles en las cañerías.'
          }
        }
      }
    };
    const out = assembleReportSlot(slot, { scoreConfig: cfg });
    assert.equal(out.findingCode, 'CORROSION');
    assert.equal(out.severity, 'medium');
    assert.equal(out.kpiKey, 'SANITARIOS');
    assert.equal(out.slotScore, 60);
    assert.equal(out.scorePenaltyApplied, 40);
    assert.match(out.findingsText, /[Cc]orrosi/);
    assert.doesNotMatch(out.findingsText, /No se detectan hallazgos/);
    assert.doesNotMatch(out.findingsText, /Ambos análisis/);
    assert.doesNotMatch(out.descriptionText, /No se observan signos de corrosión/);
    assert.equal(out.analysisDebug.openai.parsed.kpi_analysis, out.findingsText);
  });

  it('RCD_PRESENT no es hallazgo', () => {
    const slot = {
      slotCode: 'ELECTRICAL_PANEL',
      title: 'Tablero',
      status: 'ANALYZED',
      analysisCode: 'RCD_PRESENT',
      analysisSeverity: null,
      analysisMessage: 'Se ve diferencial.',
      analysisDebug: { openai: { parsed: { description: 'Tablero con diferencial.' } } }
    };
    const out = assembleReportSlot(slot, { scoreConfig: cfg });
    assert.equal(out.findingCode, 'OK');
    assert.equal(out.severity, null);
    assert.equal(out.slotScore, 100);
    assert.match(out.findingsText, /no se observan hallazgos/i);
  });

  it('cielo con humedad se queda en Muros', () => {
    const slot = {
      slotCode: 'LIVING_CEILING',
      title: 'Living – Cielo',
      status: 'ANALYZED',
      analysisCode: 'HUMIDITY_VISIBLE',
      analysisSeverity: 'medium',
      analysisMessage: 'Mancha de humedad en el cielo.',
      analysisDebug: { openai: { parsed: {} } }
    };
    const out = assembleReportSlot(slot, { scoreConfig: cfg });
    assert.equal(out.kpiKey, 'MUROS_PINTURA');
    assert.equal(out.slotScore, 60);
  });

  it('el mapa de slot manda: humedad en el cielo no se mueve a Humedad', () => {
    const key = classifyKpiFromSlot({
      slotCode: 'LIVING_CEILING',
      title: 'Living – Cielo',
      message: 'mancha de humedad y moho en el cielo'
    }, cfg.slotKpiMap);
    assert.equal(key, 'MUROS_PINTURA');
  });
});
