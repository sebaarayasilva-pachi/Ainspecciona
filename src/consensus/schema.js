/**
 * Contrato común A/B del consenso (analistas y Judge).
 */
import {
  TAXONOMY_VERSION,
  applyTaxonomyGuards,
  normalizeFindingCode,
  isOkConfirmCode
} from './taxonomy.js';

export const ANALYST_PROMPT_VERSION = '1.0';
export const JUDGE_PROMPT_VERSION = '1.2';
export const CONSENSUS_ENGINE_VERSION = '1.1';

export const EVALUABILITY = {
  EVALUABLE: 'EVALUABLE',
  NOT_EVALUABLE: 'NOT_EVALUABLE'
};

export const CONSENSUS_STATUS = {
  AGREE: 'AGREE',
  DISAGREE_SEVERITY: 'DISAGREE_SEVERITY',
  DISAGREE_FINDING: 'DISAGREE_FINDING',
  DISAGREE_EVALUABILITY: 'DISAGREE_EVALUABILITY',
  PROVIDER_FAIL: 'PROVIDER_FAIL'
};

export const FINAL_STATUS = {
  CONFIRMED_OK: 'CONFIRMED_OK',
  CONFIRMED_FINDING: 'CONFIRMED_FINDING',
  REVIEWED_FINDING: 'REVIEWED_FINDING',
  NO_EVALUABLE: 'NO_EVALUABLE',
  UNRESOLVED: 'UNRESOLVED'
};

export const SEVERITY_RANK = { OK: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

export function normalizeSeverity(value) {
  const s = String(value || '').toUpperCase();
  if (s === 'NONE' || s === 'OK' || s === '') return 'OK';
  if (s === 'LOW' || s === 'MEDIUM' || s === 'HIGH') return s;
  return 'OK';
}

export function normalizeEvaluability(value) {
  const s = String(value || '').toUpperCase().replace(/-/g, '_');
  if (s === 'NOT_EVALUABLE' || s === 'NO_EVALUABLE' || s === 'NONEVALUABLE') {
    return EVALUABILITY.NOT_EVALUABLE;
  }
  return EVALUABILITY.EVALUABLE;
}

export function emptyAnalysis(extra = {}) {
  return {
    evaluability: EVALUABILITY.EVALUABLE,
    observations: [],
    limitations: [],
    observation: '',
    interpretation: '',
    cause: '',
    taxonomyVersion: TAXONOMY_VERSION,
    ...extra
  };
}

export function normalizeAnalysis(raw, { findingKpiMap } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const evaluability = normalizeEvaluability(src.evaluability);
  const narrative = [src.observation, src.interpretation, src.cause, src.kpi_analysis, src.description]
    .filter(Boolean)
    .join(' ');
  const observations = applyTaxonomyGuards({
    observations: Array.isArray(src.observations) ? src.observations : inferObservationsFromLegacy(src),
    narrative,
    findingKpiMap
  });
  return {
    evaluability,
    observations,
    limitations: Array.isArray(src.limitations) ? src.limitations.map(String) : [],
    observation: String(src.observation || src.description || '').trim(),
    interpretation: String(src.interpretation || src.kpi_analysis || '').trim(),
    cause: String(src.cause || src.inference || '').trim(),
    taxonomyVersion: String(src.taxonomyVersion || TAXONOMY_VERSION)
  };
}

function inferObservationsFromLegacy(src) {
  const code = normalizeFindingCode(src.findingType || src.finalFindingCode || src.code);
  if (!code) return [];
  const present = src.findingPresent !== false && src.detected !== false;
  return [{
    code,
    detected: present,
    severity: normalizeSeverity(src.severity || src.proposed_severity || src.finalSeverity),
    confidence: src.confidence,
    evidence: src.evidence
  }];
}

export function primaryObservation(analysis) {
  const obs = Array.isArray(analysis?.observations) ? analysis.observations : [];
  const findings = obs.filter((o) => o.detected && !isOkConfirmCode(o.code));
  if (!findings.length) {
    const ok = obs.find((o) => o.detected && isOkConfirmCode(o.code));
    return ok || null;
  }
  return findings.slice().sort((a, b) => {
    const ra = SEVERITY_RANK[normalizeSeverity(a.severity)] ?? 0;
    const rb = SEVERITY_RANK[normalizeSeverity(b.severity)] ?? 0;
    return rb - ra;
  })[0];
}

export function detectedFindingCodes(analysis) {
  return (analysis?.observations || [])
    .filter((o) => o.detected && !isOkConfirmCode(o.code))
    .map((o) => o.code)
    .sort();
}

export function analysisSeverity(analysis) {
  if (normalizeEvaluability(analysis?.evaluability) === EVALUABILITY.NOT_EVALUABLE) return null;
  const primary = primaryObservation(analysis);
  if (!primary || isOkConfirmCode(primary.code)) return 'OK';
  return normalizeSeverity(primary.severity);
}

function firstFiniteConfidence(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  }
  return null;
}

function confidenceFromObservations(observations) {
  if (!Array.isArray(observations) || !observations.length) return null;
  const primary = primaryObservation({ observations });
  return firstFiniteConfidence(
    primary?.confidence,
    ...observations.map((o) => o?.confidence)
  );
}

function unwrapJudgePayload(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (raw.error) return raw;
  const hasVerdict = raw.chosenSide != null
    || raw.confidence != null
    || raw.finalFindingCode != null
    || Array.isArray(raw.observations);
  if (hasVerdict) return raw;
  if (raw.verdict && typeof raw.verdict === 'object') return unwrapJudgePayload(raw.verdict);
  if (raw.judge && typeof raw.judge === 'object') return unwrapJudgePayload(raw.judge);
  if (raw.analysis && typeof raw.analysis === 'object') return unwrapJudgePayload(raw.analysis);
  return raw;
}

/**
 * Contrato canónico del juez. Sube `confidence` si Claude lo dejó solo en observations.
 */
export function normalizeJudgeVerdict(raw) {
  const src = unwrapJudgePayload(raw);
  const observations = Array.isArray(src.observations) ? src.observations : [];
  const nested = src.analysis && typeof src.analysis === 'object' ? src.analysis : null;
  const nestedObs = Array.isArray(nested?.observations) ? nested.observations : [];
  const allObs = observations.length ? observations : nestedObs;
  const side = String(src.chosenSide || src.chosen_side || '').toUpperCase();
  const chosenSide = ['A', 'B', 'NEITHER'].includes(side) ? side : null;
  const primary = primaryObservation({ observations: allObs });
  const code = normalizeFindingCode(src.finalFindingCode || src.code || primary?.code) || null;
  const confidence = firstFiniteConfidence(
    src.confidence,
    src.finalConfidence,
    nested?.confidence,
    confidenceFromObservations(allObs)
  );
  return {
    evaluability: normalizeEvaluability(src.evaluability || nested?.evaluability),
    chosenSide,
    finalFindingCode: code,
    detected: src.detected !== false,
    severity: normalizeSeverity(src.severity || src.finalSeverity || primary?.severity),
    confidence,
    rationale: String(src.rationale || src.observation || src.reason || nested?.observation || '').trim(),
    observations: allObs
  };
}

export function analystJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      evaluability: { type: 'string', enum: ['EVALUABLE', 'NOT_EVALUABLE'] },
      observations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string' },
            detected: { type: 'boolean' },
            severity: { type: 'string', enum: ['OK', 'LOW', 'MEDIUM', 'HIGH'] },
            confidence: { type: 'number' },
            evidence: { type: 'array', items: { type: 'string' } }
          },
          required: ['code', 'detected', 'severity', 'confidence', 'evidence']
        }
      },
      limitations: { type: 'array', items: { type: 'string' } },
      observation: { type: 'string' },
      interpretation: { type: 'string' },
      cause: { type: 'string' }
    },
    required: ['evaluability', 'observations', 'limitations', 'observation', 'interpretation', 'cause']
  };
}

export function judgeJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      evaluability: { type: 'string', enum: ['EVALUABLE', 'NOT_EVALUABLE'] },
      chosenSide: { type: 'string', enum: ['A', 'B', 'NEITHER'] },
      finalFindingCode: { type: 'string' },
      detected: { type: 'boolean' },
      severity: { type: 'string', enum: ['OK', 'LOW', 'MEDIUM', 'HIGH'] },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Certeza 0-1 del veredicto. Obligatoria en la raíz, no solo en observations.'
      },
      rationale: { type: 'string' },
      observations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string' },
            detected: { type: 'boolean' },
            severity: { type: 'string', enum: ['OK', 'LOW', 'MEDIUM', 'HIGH'] },
            confidence: { type: 'number' },
            evidence: { type: 'array', items: { type: 'string' } }
          },
          required: ['code', 'detected', 'severity', 'confidence', 'evidence']
        }
      }
    },
    required: [
      'evaluability', 'chosenSide', 'finalFindingCode', 'detected',
      'severity', 'confidence', 'rationale', 'observations'
    ]
  };
}

export function buildAnalystPrompt({ slotTitle, slotCode, kpiKey, extra = '' } = {}) {
  const codes = [
    'RCD_PRESENT — se ve diferencial / botón T / 30 mA (OK, no es hallazgo)',
    'RCD_MISSING — ausencia de diferencial (solo si el encuadre permite confirmarlo)',
    'EXPOSED_WIRE — conductor expuesto',
    'HUMIDITY_VISIBLE — humedad visible (mancha, aureola, eflorescencia). Si el texto dice que NO hay humedad, detected=false',
    'MOLD_LIKE_STAINING — tinción tipo moho',
    'CORROSION — óxido / corrosión de grifería o cañería (KPI Sanitarios, no Humedad)',
    'ACTIVE_LEAK — fuga o goteo activo',
    'PAINT_DISCOLORATION — variación de tono / decoloración (cosmético = LOW, no subir a MEDIUM)',
    'WALL_CRACK — grieta o fisura de muro',
    'FLOOR_GAP — junta / separación de piso',
    'FLOOR_LIFT — levantamiento de piso',
    'BROKEN_WINDOW_SEAL — sello de ventana fallido',
    'DOOR_HARDWARE_DAMAGE — herraje de puerta dañado',
    'FURNITURE_SCRATCH — rayón de mobiliario (cosmético = LOW)'
  ];
  return [
    'Eres un inspector técnico. Analiza SOLO evidencia visual. Responde JSON del contrato.',
    `Slot: ${slotTitle || slotCode || 'desconocido'}. Código: ${slotCode || ''}. KPI sugerido: ${kpiKey || ''}.`,
    'Códigos permitidos (usa el código, no parafrasees):',
    ...codes.map((c) => `- ${c}`),
    'Reglas:',
    '- Si la foto no permite confirmar ni descartar: evaluability=NOT_EVALUABLE y observations=[].',
    '- Si no hay hallazgo: evaluability=EVALUABLE, observations con detected=false o RCD_PRESENT/OK.',
    '- Compara por código. No inventes un hallazgo porque el texto es largo.',
    '- Fallo de API no es hallazgo (no aplica aquí).',
    extra
  ].filter(Boolean).join('\n');
}

export function buildJudgePrompt({ analysisA, analysisB }) {
  return [
    'Eres un juez anónimo. Recibes la FOTO y analysis_a / analysis_b SIN nombre de proveedor.',
    'La evidencia es la imagen. Los análisis son opiniones: no elijas un hallazgo solo porque un texto es más detallado.',
    'Mira la foto y vota. Regla 2/3: chosenSide A o B solo si la imagen respalda ese lado (mismo hallazgo principal o mismo OK).',
    'NEITHER si ves otra cosa, no puedes desempatar, o la foto no permite confirmar.',
    'confidence: >= 0.65 solo si la foto respalda el voto con claridad. < 0.65 si dudas (ese caso va a revisión humana).',
    'Si uno acusa RCD_MISSING y el otro RCD_PRESENT, no declares RCD_MISSING sin ver la ausencia en la foto.',
    'Si ambos son NOT_EVALUABLE y la foto tampoco permite evaluar, confirma NOT_EVALUABLE.',
    'No promedies códigos distintos. No declares un hallazgo que no se vea.',
    'Responde JSON del contrato de juez, con TODOS los campos en la raíz:',
    'evaluability, chosenSide (A|B|NEITHER), finalFindingCode, detected, severity (OK|LOW|MEDIUM|HIGH),',
    'confidence (número 0-1, OBLIGATORIO en la raíz; no lo dejes solo en observations), rationale, observations.',
    'rationale: describe SOLO lo visible en la foto (1-3 frases). Nunca menciones analysis_a, analysis_b, chosenSide ni “ambos análisis”.',
    'analysis_a:',
    JSON.stringify(analysisA),
    'analysis_b:',
    JSON.stringify(analysisB)
  ].join('\n');
}
