/**
 * Taxonomía versionada del consenso (códigos, no texto libre).
 * El mapa finding→KPI reusa findingKpiMap de STI v4 como default Admin.
 */
import { DEFAULT_FINDING_KPI_MAP } from '../scoring/scoringV4.js';

export const TAXONOMY_VERSION = '1.0';

export const FINDING_CODES = {
  RCD_PRESENT: 'RCD_PRESENT',
  RCD_MISSING: 'RCD_MISSING',
  EXPOSED_WIRE: 'EXPOSED_WIRE',
  HUMIDITY_VISIBLE: 'HUMIDITY_VISIBLE',
  MOLD_LIKE_STAINING: 'MOLD_LIKE_STAINING',
  CORROSION: 'CORROSION',
  ACTIVE_LEAK: 'ACTIVE_LEAK',
  PAINT_DISCOLORATION: 'PAINT_DISCOLORATION',
  WALL_CRACK: 'WALL_CRACK',
  FLOOR_GAP: 'FLOOR_GAP',
  FLOOR_LIFT: 'FLOOR_LIFT',
  BROKEN_WINDOW_SEAL: 'BROKEN_WINDOW_SEAL',
  DOOR_HARDWARE_DAMAGE: 'DOOR_HARDWARE_DAMAGE',
  FURNITURE_SCRATCH: 'FURNITURE_SCRATCH'
};

/** Códigos que confirman OK (no son hallazgo). */
export const OK_CONFIRM_CODES = new Set([FINDING_CODES.RCD_PRESENT]);

/** Cosméticos: rúbrica = LOW; no subir automático a MEDIUM. */
export const COSMETIC_CODES = new Set([
  FINDING_CODES.PAINT_DISCOLORATION,
  FINDING_CODES.FURNITURE_SCRATCH
]);

export const DEFAULT_CODE_KPI = {
  RCD_PRESENT: 'ELECTRICIDAD',
  RCD_MISSING: 'ELECTRICIDAD',
  EXPOSED_WIRE: 'ELECTRICIDAD',
  HUMIDITY_VISIBLE: 'HUMEDAD',
  MOLD_LIKE_STAINING: 'HUMEDAD',
  CORROSION: 'SANITARIOS',
  ACTIVE_LEAK: 'SANITARIOS',
  PAINT_DISCOLORATION: 'MUROS_PINTURA',
  WALL_CRACK: 'MUROS_PINTURA',
  FLOOR_GAP: 'PISOS',
  FLOOR_LIFT: 'PISOS',
  BROKEN_WINDOW_SEAL: 'VENTANAS_CERRAMIENTOS',
  DOOR_HARDWARE_DAMAGE: 'PUERTAS_HERRAJES',
  FURNITURE_SCRATCH: 'MOBILIARIO_FIJO'
};

/** Alias v4 (camelCase) → código de consenso. */
export const V4_TYPE_TO_CODE = {
  paintToneVariation: FINDING_CODES.PAINT_DISCOLORATION,
  wallCrack: FINDING_CODES.WALL_CRACK,
  visibleMoisture: FINDING_CODES.HUMIDITY_VISIBLE,
  moldLikeStaining: FINDING_CODES.MOLD_LIKE_STAINING,
  floorGap: FINDING_CODES.FLOOR_GAP,
  floorLift: FINDING_CODES.FLOOR_LIFT,
  faucetCorrosion: FINDING_CODES.CORROSION,
  pipeCorrosion: FINDING_CODES.CORROSION,
  activeLeak: FINDING_CODES.ACTIVE_LEAK,
  missingDifferential: FINDING_CODES.RCD_MISSING,
  exposedWire: FINDING_CODES.EXPOSED_WIRE,
  brokenWindowSeal: FINDING_CODES.BROKEN_WINDOW_SEAL,
  doorHardwareDamage: FINDING_CODES.DOOR_HARDWARE_DAMAGE,
  furnitureScratch: FINDING_CODES.FURNITURE_SCRATCH
};

export const DEFAULT_SAFETY_CODES = [
  FINDING_CODES.RCD_MISSING,
  FINDING_CODES.EXPOSED_WIRE,
  FINDING_CODES.ACTIVE_LEAK,
  FINDING_CODES.FLOOR_LIFT
];

const HUMIDITY_ABSENT_PHRASES = [
  'no se detecta humedad',
  'no se detectan humedad',
  'no se detectan señales visibles de humedad',
  'sin señales visibles de humedad',
  'sin evidencia de humedad',
  'no se observa humedad',
  'no se observan señales de humedad'
];

const TONE_PHRASES = [
  'variación de tono',
  'variacion de tono',
  'cambio de tono',
  'diferencia de tono',
  'decoloración',
  'decoloracion',
  'mancha de pintura'
];

export function normalizeFindingCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (FINDING_CODES[s]) return FINDING_CODES[s];
  const upper = s.toUpperCase().replace(/[\s-]+/g, '_');
  if (FINDING_CODES[upper]) return FINDING_CODES[upper];
  const camel = s.charAt(0).toLowerCase() + s.slice(1);
  if (V4_TYPE_TO_CODE[s]) return V4_TYPE_TO_CODE[s];
  if (V4_TYPE_TO_CODE[camel]) return V4_TYPE_TO_CODE[camel];
  return upper;
}

export function kpiForFindingCode(code, findingKpiMap = DEFAULT_FINDING_KPI_MAP) {
  const normalized = normalizeFindingCode(code);
  if (!normalized) return null;
  if (DEFAULT_CODE_KPI[normalized]) return DEFAULT_CODE_KPI[normalized];
  const v4Key = Object.entries(V4_TYPE_TO_CODE).find(([, c]) => c === normalized)?.[0];
  if (v4Key && findingKpiMap?.[v4Key]) return String(findingKpiMap[v4Key]).toUpperCase();
  return null;
}

export function isOkConfirmCode(code) {
  return OK_CONFIRM_CODES.has(normalizeFindingCode(code));
}

export function isCosmeticCode(code) {
  return COSMETIC_CODES.has(normalizeFindingCode(code));
}

export function isSafetyCode(code, safetyCodes = DEFAULT_SAFETY_CODES) {
  const n = normalizeFindingCode(code);
  return (safetyCodes || DEFAULT_SAFETY_CODES).map((c) => normalizeFindingCode(c)).includes(n);
}

export function capCosmeticSeverity(code, severity) {
  const sev = String(severity || '').toUpperCase();
  if (!isCosmeticCode(code)) return sev || null;
  if (sev === 'MEDIUM' || sev === 'HIGH') return 'LOW';
  return sev === 'LOW' || sev === 'OK' ? sev : 'LOW';
}

export function textNegatesHumidity(text) {
  const blob = String(text || '').toLowerCase();
  return HUMIDITY_ABSENT_PHRASES.some((p) => blob.includes(p));
}

export function textSuggestsToneVariation(text) {
  const blob = String(text || '').toLowerCase();
  return TONE_PHRASES.some((p) => blob.includes(p));
}

export function applyTaxonomyGuards({ observations, narrative, findingKpiMap } = {}) {
  const text = String(narrative || '');
  const humidityNegated = textNegatesHumidity(text);
  const toneOnly = textSuggestsToneVariation(text) && !/\b(grieta|fisura|desprend|humedad|filtraci)/i.test(text);
  const next = (Array.isArray(observations) ? observations : []).map((obs) => {
    const code = normalizeFindingCode(obs?.code);
    if (!code) return null;
    let detected = !!obs.detected;
    let severity = String(obs.severity || 'OK').toUpperCase();
    if (humidityNegated && code === FINDING_CODES.HUMIDITY_VISIBLE) {
      detected = false;
      severity = 'OK';
    }
    if (toneOnly && code === FINDING_CODES.PAINT_DISCOLORATION) {
      detected = true;
      severity = capCosmeticSeverity(code, severity || 'LOW');
    } else if (detected && isCosmeticCode(code)) {
      severity = capCosmeticSeverity(code, severity);
    }
    if (isOkConfirmCode(code)) {
      detected = true;
      severity = 'OK';
    }
    return {
      code,
      detected,
      severity: detected ? severity : 'OK',
      confidence: Math.max(0, Math.min(1, Number(obs.confidence ?? 0.7))),
      evidence: Array.isArray(obs.evidence) ? obs.evidence.map(String) : [],
      kpi: kpiForFindingCode(code, findingKpiMap)
    };
  }).filter(Boolean);

  return next;
}
