import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrateFindingFromText,
  validateFindingKpi,
  applyElectricalInventoryRules,
  computeScoringV4,
  starsFromScoreV4,
  DEFAULT_V4_POLICY
} from './scoringV4.js';
import { normalizeScoreConfig, computeScoringV2_2 } from './scoringV2_2.js';

const cfg = DEFAULT_V4_POLICY;
const classify = (s) => s.kpiKey;

describe('STI v4 tests', () => {
  it('Test 1: variación de tono => LOW / 85 / COSMETIC', () => {
    const a = calibrateFindingFromText('variación de tono en pintura, sin grietas', 'MUROS_PINTURA', cfg);
    assert.equal(a.severity, 'low');
    assert.equal(a.score, 85);
    assert.equal(a.impactType, 'COSMETIC');
    assert.equal(a.findingType, 'paintToneVariation');
  });

  it('Test 2: "No se detecta humedad" => OK / 100', () => {
    const a = calibrateFindingFromText('No se detecta humedad', 'HUMEDAD', cfg);
    assert.equal(a.findingPresent, false);
    assert.equal(a.severity, null);
    assert.equal(a.score, 100);
  });

  it('Test 3: corrosión de grifería => SANITARIOS not HUMEDAD', () => {
    const a = calibrateFindingFromText('corrosión de grifería en el lavaplatos', 'HUMEDAD', cfg);
    assert.equal(a.findingType, 'faucetCorrosion');
    assert.equal(a.kpi, 'SANITARIOS');
    const check = validateFindingKpi('faucetCorrosion', 'HUMEDAD', cfg);
    assert.equal(check.ok, false);
    assert.equal(check.kpi, 'SANITARIOS');
    assert.equal(check.corrected, true);
  });

  it('Test 4: tablero con T y 30mA => missingDifferential false', () => {
    const analysis = {
      findingType: 'missingDifferential',
      description: 'El tablero carece de interruptor diferencial visible',
      kpi_analysis: 'carece de interruptor diferencial',
      severity: 'high'
    };
    const next = applyElectricalInventoryRules(
      analysis,
      {
        differentialSwitchesVisible: 2,
        differentialEvidence: ['botón de prueba T visible', 'sensibilidad 30 mA visible'],
        readable: true
      },
      cfg,
      'ELECTRICAL_PANEL'
    );
    assert.equal(next.missingDifferential, false);
    assert.equal(next.severity, null);
    assert.equal(next.score, 100);
    assert.notEqual(next.evaluability, 'NO_EVALUABLE');
  });

  it('Test 5: tablero ambiguo => NO_EVALUABLE, not HIGH', () => {
    const next = applyElectricalInventoryRules(
      { findingType: 'missingDifferential', severity: 'high', description: 'posible ausencia de diferencial' },
      { differentialSwitchesVisible: 0, differentialEvidence: [], readable: false },
      cfg,
      'ELECTRICAL_PANEL'
    );
    assert.equal(next.evaluability, 'NO_EVALUABLE');
    assert.equal(next.severity, null);
    assert.notEqual(next.severity, 'high');
  });

  it('Test 6: 100, 100, 25 HIGH SAFETY => KPI <= 45', () => {
    const slots = [
      { slotCode: 'LIVING_SWITCHES', kpiKey: 'ELECTRICIDAD', severity: null },
      { slotCode: 'KITCHEN_OUTLETS', kpiKey: 'ELECTRICIDAD', severity: null },
      {
        slotCode: 'ELECTRICAL_PANEL',
        kpiKey: 'ELECTRICIDAD',
        severity: 'high',
        impactType: 'SAFETY',
        findingType: 'exposedWire',
        criticalFlag: true
      }
    ];
    const result = computeScoringV4(slots, cfg, classify);
    const elec = result.byGroup.find((g) => g.groupKey === 'ELECTRICIDAD');
    assert.ok(elec);
    assert.ok(elec.scoreIfOnlyGroup <= 45);
  });

  it('Test 7: STI 88 + HIGH SAFETY => 3 stars', () => {
    assert.equal(starsFromScoreV4(88, cfg, { highSafety: true }), 3);
  });

  it('Test 8: STI 92 sin HIGH SAFETY => 5 stars', () => {
    assert.equal(starsFromScoreV4(92, cfg, { highSafety: false }), 5);
  });

  it('normalizeScoreConfig activa motor v4 y computeScoringV2_2 usa SCORING_V4', () => {
    const normalized = normalizeScoreConfig({});
    assert.equal(normalized.engineVersion, '4.0');
    assert.equal(normalized.severityScores.low, 85);
    const slots = [
      { slotCode: 'LIVING_WALLS', kpiKey: 'MUROS_PINTURA', severity: 'low', title: 'Living muros' }
    ];
    const scoring = computeScoringV2_2([], slots, normalized);
    assert.equal(scoring.scoreVersion, 'SCORING_V4');
    assert.equal(scoring.score, 85);
  });

  it('findingType viejo no mueve un clóset a puertas; el KPI es el de la foto', () => {
    const slots = [
      { slotCode: 'PUERTA_ENTRADA', kpiKey: 'PUERTAS_HERRAJES', findingCode: 'OK', severity: null, message: 'herrajes en buen estado' },
      { slotCode: 'BEDROOM_3_WINDOWS', kpiKey: 'VENTANAS_CERRAMIENTOS', findingCode: 'OK', findingType: 'doorHardwareDamage', severity: null },
      {
        slotCode: 'BEDROOM_4_CLOSET',
        kpiKey: 'MOBILIARIO_FIJO',
        findingCode: 'EXPOSED_WIRE',
        findingType: 'doorHardwareDamage',
        severity: 'medium',
        message: 'cables sueltos junto al clóset'
      }
    ];
    const result = computeScoringV4(slots, cfg, classify);
    const doors = result.byGroup.find((g) => g.groupKey === 'PUERTAS_HERRAJES');
    const elec = result.byGroup.find((g) => g.groupKey === 'ELECTRICIDAD');
    const furn = result.byGroup.find((g) => g.groupKey === 'MOBILIARIO_FIJO');
    assert.equal(doors?.scoreIfOnlyGroup, 100);
    assert.ok(!elec);
    assert.ok(furn.scoreIfOnlyGroup < 100);
  });

  it('el 60 del cielo baja Muros; no se escapa a Humedad', () => {
    const slots = [
      { slotCode: 'LIVING_WALLS', kpiKey: 'MUROS_PINTURA', findingCode: 'OK', severity: null },
      { slotCode: 'BEDROOM_1_WALLS', kpiKey: 'MUROS_PINTURA', findingCode: 'OK', severity: null },
      { slotCode: 'BEDROOM_2_WALLS', kpiKey: 'MUROS_PINTURA', findingCode: 'OK', severity: null },
      {
        slotCode: 'LIVING_CEILING',
        kpiKey: 'MUROS_PINTURA',
        findingCode: 'HUMIDITY_VISIBLE',
        severity: 'medium',
        message: 'revestimiento de madera con variaciones de tonalidad'
      }
    ];
    const result = computeScoringV4(slots, cfg, classify);
    const walls = result.byGroup.find((g) => g.groupKey === 'MUROS_PINTURA');
    const hum = result.byGroup.find((g) => g.groupKey === 'HUMEDAD');
    assert.ok(!hum);
    assert.ok(walls.scoreIfOnlyGroup < 100);
    assert.notEqual(walls.scoreIfOnlyGroup, 100);
  });

  it('corrosión bajo lavaplatos se queda en el KPI de esa foto (Humedad)', () => {
    const slots = [
      {
        slotCode: 'KITCHEN_UNDER_SINK',
        kpiKey: 'HUMEDAD',
        findingCode: 'CORROSION',
        severity: 'medium',
        message: 'corrosión avanzada en la llave de paso'
      }
    ];
    const result = computeScoringV4(slots, cfg, classify);
    const hum = result.byGroup.find((g) => g.groupKey === 'HUMEDAD');
    const san = result.byGroup.find((g) => g.groupKey === 'SANITARIOS');
    assert.equal(hum?.scoreIfOnlyGroup, 60);
    assert.ok(!san);
  });
});
