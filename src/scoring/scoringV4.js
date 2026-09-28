/**
 * STI v4.0 — política en Admin (score_config), motor en este módulo.
 * Los casos persistidos con SCORING_V2_2_KPI no se recalculan solos.
 */

export const SCORE_VERSION_V4 = 'SCORING_V4';
export const ENGINE_VERSION_V4 = '4.0';

export const DEFAULT_COHERENCE_PHRASES = [
  'no se detecta',
  'no se detectan',
  'sin evidencia',
  'no se observan hallazgos',
  'no se observan hallazgos relevantes',
  'sin hallazgos relevantes',
  'no se identifican hallazgos',
  'sin señales visibles de humedad',
  'no se detectan señales visibles de humedad',
  'sin observaciones'
];

export const DEFAULT_FINDING_KPI_MAP = {
  paintToneVariation: 'MUROS_PINTURA',
  wallCrack: 'MUROS_PINTURA',
  visibleMoisture: 'HUMEDAD',
  moldLikeStaining: 'HUMEDAD',
  floorGap: 'PISOS',
  floorLift: 'PISOS',
  faucetCorrosion: 'SANITARIOS',
  pipeCorrosion: 'SANITARIOS',
  activeLeak: 'SANITARIOS',
  missingDifferential: 'ELECTRICIDAD',
  exposedWire: 'ELECTRICIDAD',
  brokenWindowSeal: 'VENTANAS_CERRAMIENTOS',
  doorHardwareDamage: 'PUERTAS_HERRAJES',
  furnitureScratch: 'MOBILIARIO_FIJO'
};

/** Código de consenso / slot → tipo v4. RCD_PRESENT no es hallazgo. */
export const CODE_TO_V4_TYPE = {
  PAINT_DISCOLORATION: 'paintToneVariation',
  WALL_CRACK: 'wallCrack',
  HUMIDITY_VISIBLE: 'visibleMoisture',
  MOLD_LIKE_STAINING: 'moldLikeStaining',
  FLOOR_GAP: 'floorGap',
  FLOOR_LIFT: 'floorLift',
  CORROSION: 'pipeCorrosion',
  ACTIVE_LEAK: 'activeLeak',
  RCD_MISSING: 'missingDifferential',
  EXPOSED_WIRE: 'exposedWire',
  BROKEN_WINDOW_SEAL: 'brokenWindowSeal',
  DOOR_HARDWARE_DAMAGE: 'doorHardwareDamage',
  FURNITURE_SCRATCH: 'furnitureScratch',
  RCD_PRESENT: null
};

function findingCodeOf(slot) {
  return String(slot?.findingCode || slot?.analysisCode || '').trim().toUpperCase();
}

function isOkFindingCode(code) {
  const c = String(code || '').trim().toUpperCase();
  return !c || c === 'OK' || c === 'NONE' || c === 'RCD_PRESENT' || c === 'NOT_CAPTURABLE' || c === 'NOT_EVALUABLE';
}

export const DEFAULT_V4_POLICY = {
  engineVersion: ENGINE_VERSION_V4,
  severityScores: { ok: 100, low: 85, medium: 60, high: 25 },
  stars: {
    bands: [
      { from: 0, stars: 1, label: 'Condición deficiente' },
      { from: 50, stars: 2, label: 'Requiere intervención' },
      { from: 65, stars: 3, label: 'Condición intermedia' },
      { from: 80, stars: 4, label: 'Buen estado' },
      { from: 90, stars: 5, label: 'Muy buen estado' }
    ],
    highSafetyMaxStars: 3
  },
  caps: { highFunctional: 60, highSafety: 45 },
  confidence: { accept: 0.85, review: 0.65, highMin: 0.9 },
  coherencePhrases: DEFAULT_COHERENCE_PHRASES.slice(),
  findingKpiMap: { ...DEFAULT_FINDING_KPI_MAP },
  slotWeights: { ELECTRICAL_PANEL: 3 },
  criticalSlotCodes: ['ELECTRICAL_PANEL'],
  impactRules: {
    safetyFindingTypes: [
      'missingDifferential',
      'exposedWire',
      'activeLeak',
      'floorLift'
    ],
    functionalFindingTypes: [
      'pipeCorrosion',
      'brokenWindowSeal',
      'doorHardwareDamage',
      'faucetCorrosion',
      'wallCrack',
      'floorGap',
      'visibleMoisture',
      'moldLikeStaining'
    ],
    cosmeticFindingTypes: [
      'paintToneVariation',
      'furnitureScratch'
    ]
  },
  electricalInventory: {
    panelSlotCodes: ['ELECTRICAL_PANEL'],
    differentialIndicators: ['botón de prueba t', 'boton de prueba t', '30 ma', 'iδn', 'idn', 'rcd', 'diferencial'],
    missingDifferentialPhrases: [
      'falta interruptor diferencial',
      'carece de interruptor diferencial',
      'ausencia de interruptor diferencial',
      'sin interruptor diferencial',
      'no se observa interruptor diferencial',
      'no hay interruptor diferencial'
    ]
  },
  aiPromptsV4: {
    SLOT_ANALYSIS_SCHEMA: [
      'Además del JSON de análisis, clasifica el slot así:',
      '- evaluability: EVALUABLE si la foto permite confirmar o descartar; NO_EVALUABLE si no.',
      '- findingPresent: true solo si hay hallazgo visible.',
      '- findingType: tipo canónico (paintToneVariation, faucetCorrosion, visibleMoisture, missingDifferential, etc.).',
      '- impactType: COSMETIC | FUNCTIONAL | SAFETY | NONE.',
      '- observation: solo lo visible. inference: hipótesis, nunca como hecho.',
      '- evidence: lista de indicios visuales. criticalFlag: true si hay riesgo serio.',
      'Si el texto dice que no hay hallazgos, findingPresent=false y proposed_severity=none.'
    ].join('\n'),
    HIGH_VALIDATION: [
      'Valida si el hallazgo HIGH está confirmado por evidencia visual clara.',
      'No confirmes HIGH por una sola inferencia genérica.',
      'Responde JSON: { confirmed, confidence, evidence[], correctedSeverity }.',
      'correctedSeverity: OK | LOW | MEDIUM | HIGH | NO_EVALUABLE.',
      'Si la foto no permite confirmar, correctedSeverity=NO_EVALUABLE y confirmed=false.'
    ].join('\n'),
    ELECTRICAL_INVENTORY: [
      'Antes de acusar defectos en un tablero, haz inventario visual:',
      'breakersVisible, differentialSwitchesVisible (número), differentialEvidence (botón T, 30 mA, IΔn),',
      'labelingVisible, exposedConductorsVisible, burnMarksVisible.',
      'Si ves un dispositivo compatible con diferencial (botón T o 30 mA), NO declares ausencia de diferencial.',
      'Si no puedes leer el componente, evaluability=NO_EVALUABLE. Nunca asumas ausencia por no reconocerlo.'
    ].join('\n')
  }
};

const KPI_TITLES = {
  MUROS_PINTURA: 'Muros y pintura',
  HUMEDAD: 'Humedad visible',
  PISOS: 'Pisos',
  SANITARIOS: 'Sanitarios',
  ELECTRICIDAD: 'Electricidad visible',
  VENTANAS_CERRAMIENTOS: 'Ventanas y cerramientos',
  PUERTAS_HERRAJES: 'Puertas y herrajes',
  MOBILIARIO_FIJO: 'Mobiliario fijo',
  DOCUMENTOS_CUMPLIMIENTO: 'Documentos y cumplimiento'
};

export function kpiTitleFromKey(key) {
  const k = String(key || '').toUpperCase();
  return KPI_TITLES[k] || k;
}

export function isV4Engine(scoreConfig) {
  const v = String(scoreConfig?.engineVersion || '').trim();
  return v === '4.0' || v === '4' || v === ENGINE_VERSION_V4;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringList(value, fallback) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || '').trim()).filter(Boolean);
  }
  return fallback.slice();
}

function normalizeStarsBands(input, fallback) {
  if (!Array.isArray(input) || !input.length) return fallback.map((b) => ({ ...b }));
  return input
    .map((b) => ({
      from: num(b?.from, 0),
      stars: Math.max(1, Math.min(5, Math.round(num(b?.stars, 1)))),
      label: String(b?.label || '').trim()
    }))
    .sort((a, b) => a.from - b.from);
}

export function normalizeV4Policy(input) {
  const base = structuredClone(DEFAULT_V4_POLICY);
  const src = input && typeof input === 'object' ? input : {};
  const next = {
    ...base,
    engineVersion: String(src.engineVersion || base.engineVersion).trim() || ENGINE_VERSION_V4,
    severityScores: {
      ok: num(src.severityScores?.ok, base.severityScores.ok),
      low: num(src.severityScores?.low, base.severityScores.low),
      medium: num(src.severityScores?.medium, base.severityScores.medium),
      high: num(src.severityScores?.high, base.severityScores.high)
    },
    stars: {
      bands: normalizeStarsBands(src.stars?.bands, base.stars.bands),
      highSafetyMaxStars: Math.max(1, Math.min(5, Math.round(num(src.stars?.highSafetyMaxStars, base.stars.highSafetyMaxStars))))
    },
    caps: {
      highFunctional: num(src.caps?.highFunctional, base.caps.highFunctional),
      highSafety: num(src.caps?.highSafety, base.caps.highSafety)
    },
    confidence: {
      accept: num(src.confidence?.accept, base.confidence.accept),
      review: num(src.confidence?.review, base.confidence.review),
      highMin: num(src.confidence?.highMin, base.confidence.highMin)
    },
    coherencePhrases: stringList(src.coherencePhrases, base.coherencePhrases),
    findingKpiMap: { ...base.findingKpiMap },
    slotWeights: { ...base.slotWeights },
    criticalSlotCodes: stringList(src.criticalSlotCodes, base.criticalSlotCodes).map((c) => c.toUpperCase()),
    impactRules: {
      safetyFindingTypes: stringList(src.impactRules?.safetyFindingTypes, base.impactRules.safetyFindingTypes),
      functionalFindingTypes: stringList(src.impactRules?.functionalFindingTypes, base.impactRules.functionalFindingTypes),
      cosmeticFindingTypes: stringList(src.impactRules?.cosmeticFindingTypes, base.impactRules.cosmeticFindingTypes)
    },
    electricalInventory: {
      panelSlotCodes: stringList(src.electricalInventory?.panelSlotCodes, base.electricalInventory.panelSlotCodes)
        .map((c) => c.toUpperCase()),
      differentialIndicators: stringList(
        src.electricalInventory?.differentialIndicators,
        base.electricalInventory.differentialIndicators
      ).map((s) => s.toLowerCase()),
      missingDifferentialPhrases: stringList(
        src.electricalInventory?.missingDifferentialPhrases,
        base.electricalInventory.missingDifferentialPhrases
      ).map((s) => s.toLowerCase())
    },
    aiPromptsV4: {
      SLOT_ANALYSIS_SCHEMA: String(src.aiPromptsV4?.SLOT_ANALYSIS_SCHEMA || base.aiPromptsV4.SLOT_ANALYSIS_SCHEMA),
      HIGH_VALIDATION: String(src.aiPromptsV4?.HIGH_VALIDATION || base.aiPromptsV4.HIGH_VALIDATION),
      ELECTRICAL_INVENTORY: String(src.aiPromptsV4?.ELECTRICAL_INVENTORY || base.aiPromptsV4.ELECTRICAL_INVENTORY)
    }
  };

  if (src.findingKpiMap && typeof src.findingKpiMap === 'object') {
    for (const [k, v] of Object.entries(src.findingKpiMap)) {
      const key = String(k || '').trim();
      const kpi = String(v || '').toUpperCase().trim();
      if (key && kpi) next.findingKpiMap[key] = kpi;
    }
  }
  if (src.slotWeights && typeof src.slotWeights === 'object') {
    for (const [k, v] of Object.entries(src.slotWeights)) {
      const code = String(k || '').toUpperCase().trim();
      const w = Number(v);
      if (code && Number.isFinite(w) && w > 0) next.slotWeights[code] = w;
    }
  }
  return next;
}

export function v4PenaltyMirrors(severityScores) {
  const s = severityScores || DEFAULT_V4_POLICY.severityScores;
  return {
    low: Math.max(0, Math.round(100 - num(s.low, 85))),
    medium: Math.max(0, Math.round(100 - num(s.medium, 60))),
    high: Math.max(0, Math.round(100 - num(s.high, 25)))
  };
}

export function publicScoreConfigSubset(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  return {
    kpis: cfg.kpis,
    badge: cfg.badge,
    kpiWeights: cfg.kpiWeights,
    messages: cfg.messages,
    recommendations: cfg.recommendations,
    engineVersion: cfg.engineVersion,
    severityScores: cfg.severityScores,
    stars: cfg.stars,
    caps: cfg.caps,
    slotKpiMap: cfg.slotKpiMap
  };
}

export function slotScoreFromSeverity(severity, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const sev = String(severity || '').toLowerCase();
  if (!sev || sev === 'ok' || sev === 'none') return v4.severityScores.ok;
  if (sev === 'low') return v4.severityScores.low;
  if (sev === 'medium') return v4.severityScores.medium;
  if (sev === 'high') return v4.severityScores.high;
  return v4.severityScores.ok;
}

export function inferFindingType(text) {
  const t = String(text || '').toLowerCase();
  if (/corrosi[oó]n.{0,40}grifer|grifer.{0,40}(corrosi|óxido|oxido)|desconchado del cromado/.test(t)) {
    return 'faucetCorrosion';
  }
  if (/variaci[oó]n de tono|diferencia(?:s)? de tono|tono en pintura/.test(t)) return 'paintToneVariation';
  if (/\bgrieta(?:s)?\b/.test(t) && !/uni[oó]n|junta de placas|discontinuidad/.test(t)) return 'wallCrack';
  if (/fuga activa|goteo visible|filtraci[oó]n activa/.test(t)) return 'activeLeak';
  if (/humedad visible|mancha(?:s)? de humedad|moho/.test(t)) {
    return /moho/.test(t) ? 'moldLikeStaining' : 'visibleMoisture';
  }
  if (/piso levant|piezas sueltas|riesgo de tropiezo/.test(t)) return 'floorLift';
  if (/separaci[oó]n.{0,20}piso|junta abierta/.test(t)) return 'floorGap';
  if (/cable(?:s)? expos|conductor expos/.test(t)) return 'exposedWire';
  if (/falta.{0,40}diferencial|carece.{0,40}diferencial|ausencia.{0,40}diferencial/.test(t)) {
    return 'missingDifferential';
  }
  if (/sello.{0,20}ventana|vidrio triz/.test(t)) return 'brokenWindowSeal';
  if (/herraje|cerradura dañ|bisagra/.test(t)) {
    if (/sin dañ|no se observan dañ|no se observa dañ|buen estado|no presentan? signos|no presenta signos/.test(t)) {
      return null;
    }
    return 'doorHardwareDamage';
  }
  if (/ray[oó]n.{0,20}mueble|mobiliario/.test(t)) return 'furnitureScratch';
  return null;
}

export function inferImpactType(findingType, scoreConfig) {
  if (!findingType) return 'NONE';
  const v4 = normalizeV4Policy(scoreConfig || {});
  const key = String(findingType);
  if (v4.impactRules.safetyFindingTypes.includes(key)) return 'SAFETY';
  if (v4.impactRules.functionalFindingTypes.includes(key)) return 'FUNCTIONAL';
  if (v4.impactRules.cosmeticFindingTypes.includes(key)) return 'COSMETIC';
  return 'NONE';
}

export function validateFindingKpi(findingType, assignedKpi, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const type = String(findingType || '').trim();
  const assigned = String(assignedKpi || '').toUpperCase();
  const expected = type ? String(v4.findingKpiMap[type] || '').toUpperCase() : '';
  if (!type || !expected) {
    return { ok: true, kpi: assigned || null, findingType: type || null, corrected: false };
  }
  if (assigned && assigned !== expected) {
    return { ok: false, kpi: expected, findingType: type, corrected: true, previousKpi: assigned };
  }
  return { ok: true, kpi: expected, findingType: type, corrected: false };
}

export function textHasCoherenceNoFinding(text, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const blob = String(text || '').toLowerCase();
  if (!blob) return false;
  const hit = v4.coherencePhrases.some((p) => blob.includes(String(p).toLowerCase()));
  if (!hit) return false;
  const contradicts = /\b(excepto|salvo|sin embargo|pero\s+s[ií]|aunque\s+se observa)\b/i.test(blob);
  return !contradicts;
}

export function applyCoherenceFromConfig(analysis, scoreConfig) {
  const text = [
    analysis?.observation,
    analysis?.inference,
    analysis?.kpi_analysis,
    analysis?.description,
    analysis?.message
  ].filter(Boolean).join(' ');
  if (!textHasCoherenceNoFinding(text, scoreConfig)) return analysis;
  const v4 = normalizeV4Policy(scoreConfig || {});
  return {
    ...analysis,
    findingPresent: false,
    severity: null,
    impactType: 'NONE',
    evaluability: analysis?.evaluability === 'NO_EVALUABLE' ? 'NO_EVALUABLE' : 'EVALUABLE',
    score: analysis?.evaluability === 'NO_EVALUABLE' ? null : v4.severityScores.ok
  };
}

export function applyConfidenceGating(analysis, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const c = Number(analysis?.confidence);
  if (!Number.isFinite(c)) return analysis;
  const sev = String(analysis?.severity || '').toLowerCase();
  if (sev === 'high' && c < v4.confidence.highMin) {
    return {
      ...analysis,
      evaluability: 'NO_EVALUABLE',
      severity: null,
      score: null,
      needsReview: true,
      confidenceGate: 'highMin'
    };
  }
  if (c < v4.confidence.review) {
    return {
      ...analysis,
      evaluability: 'NO_EVALUABLE',
      severity: null,
      score: null,
      confidenceGate: 'belowReview'
    };
  }
  if (c < v4.confidence.accept) {
    return { ...analysis, needsReview: true, confidenceGate: 'review' };
  }
  return analysis;
}

export function applyHighValidationResult(analysis, validation) {
  if (validation?.confirmed) return { ...analysis, highValidated: true };
  const raw = String(validation?.correctedSeverity || 'NO_EVALUABLE').toUpperCase();
  if (raw === 'NO_EVALUABLE' || raw === 'OK' && validation?.correctedSeverity == null) {
    return {
      ...analysis,
      evaluability: raw === 'NO_EVALUABLE' ? 'NO_EVALUABLE' : 'EVALUABLE',
      severity: raw === 'OK' ? null : null,
      findingPresent: false,
      score: raw === 'NO_EVALUABLE' ? null : 100,
      highValidated: false
    };
  }
  if (raw === 'OK') {
    return {
      ...analysis,
      evaluability: 'EVALUABLE',
      severity: null,
      findingPresent: false,
      score: 100,
      highValidated: false
    };
  }
  const sev = raw.toLowerCase();
  return {
    ...analysis,
    severity: ['low', 'medium', 'high'].includes(sev) ? sev : null,
    evaluability: 'EVALUABLE',
    highValidated: false
  };
}

export function isElectricalPanelSlot(slotCode, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const code = String(slotCode || '').toUpperCase();
  return v4.electricalInventory.panelSlotCodes.includes(code) || code.includes('ELECTRICAL_PANEL');
}

function inventoryHasDifferential(inventory, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const count = Number(inventory?.differentialSwitchesVisible);
  if (Number.isFinite(count) && count > 0) return true;
  const evidence = [
    ...(Array.isArray(inventory?.differentialEvidence) ? inventory.differentialEvidence : []),
    inventory?.labelingVisible ? 'label' : ''
  ].join(' ').toLowerCase();
  return v4.electricalInventory.differentialIndicators.some((ind) => evidence.includes(ind));
}

function inventoryIsAmbiguous(inventory) {
  if (!inventory || typeof inventory !== 'object') return true;
  const count = Number(inventory.differentialSwitchesVisible);
  const evidence = Array.isArray(inventory.differentialEvidence) ? inventory.differentialEvidence : [];
  const readable = (Number.isFinite(count) && count > 0) || evidence.length > 0;
  const explicitUnreadable = inventory.readable === false || inventory.canRead === false;
  return explicitUnreadable || !readable;
}

export function applyElectricalInventoryRules(analysis, inventory, scoreConfig, slotCode) {
  if (!isElectricalPanelSlot(slotCode, scoreConfig)) return analysis;
  const v4 = normalizeV4Policy(scoreConfig || {});
  const text = [
    analysis?.observation,
    analysis?.inference,
    analysis?.kpi_analysis,
    analysis?.description,
    analysis?.message
  ].filter(Boolean).join(' ').toLowerCase();
  const claimsMissing = v4.electricalInventory.missingDifferentialPhrases.some((p) => text.includes(p))
    || analysis?.findingType === 'missingDifferential';

  if (inventoryIsAmbiguous(inventory) && !inventoryHasDifferential(inventory, scoreConfig)) {
    return {
      ...analysis,
      evaluability: 'NO_EVALUABLE',
      severity: null,
      findingPresent: false,
      findingType: analysis?.findingType === 'missingDifferential' ? null : analysis?.findingType,
      missingDifferential: false,
      score: null
    };
  }

  if (inventoryHasDifferential(inventory, scoreConfig) && claimsMissing) {
    return {
      ...analysis,
      missingDifferential: false,
      findingType: analysis?.findingType === 'missingDifferential' ? null : analysis?.findingType,
      findingPresent: false,
      severity: null,
      evaluability: 'EVALUABLE',
      score: v4.severityScores.ok,
      impactType: 'NONE'
    };
  }

  return { ...analysis, missingDifferential: false };
}

export function calibrateFindingFromText(text, assignedKpi, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const findingType = inferFindingType(text);
  const kpiCheck = validateFindingKpi(findingType, assignedKpi, v4);
  let impactType = inferImpactType(findingType, v4);
  let severity = null;
  if (findingType === 'paintToneVariation' && !/grieta|descascar|desprend/.test(String(text || '').toLowerCase())) {
    severity = 'low';
    impactType = 'COSMETIC';
  } else if (findingType) {
    severity = impactType === 'SAFETY' ? 'high' : impactType === 'FUNCTIONAL' ? 'medium' : 'low';
  }
  let analysis = {
    findingType,
    kpi: kpiCheck.kpi,
    impactType,
    severity,
    findingPresent: !!findingType,
    evaluability: 'EVALUABLE',
    observation: String(text || '').trim(),
    inference: null
  };
  analysis = applyCoherenceFromConfig(analysis, v4);
  if (analysis.findingPresent === false) {
    analysis.severity = null;
    analysis.score = v4.severityScores.ok;
    analysis.impactType = 'NONE';
  } else {
    analysis.score = slotScoreFromSeverity(analysis.severity, v4);
  }
  return analysis;
}

function parsedFromSlot(slot) {
  return slot?.analysisDebug?.openai?.parsed && typeof slot.analysisDebug.openai.parsed === 'object'
    ? slot.analysisDebug.openai.parsed
    : {};
}

export function isOmittedOrNotEvaluable(slot) {
  if (!slot) return true;
  if (slot.omitted) return true;
  const status = String(slot.status || '').toUpperCase();
  if (status === 'NOT_CAPTURABLE') return true;
  const code = String(slot.findingCode || slot.analysisCode || '').toUpperCase();
  if (code === 'NOT_CAPTURABLE') return true;
  const parsed = parsedFromSlot(slot);
  const ev = String(slot.evaluability || parsed.evaluability || '').toUpperCase();
  return ev === 'NO_EVALUABLE';
}

function slotImpactType(slot) {
  const parsed = parsedFromSlot(slot);
  return String(slot.impactType || parsed.impactType || '').toUpperCase();
}

function slotFindingType(slot) {
  const code = findingCodeOf(slot);
  if (Object.prototype.hasOwnProperty.call(CODE_TO_V4_TYPE, code)) {
    return CODE_TO_V4_TYPE[code];
  }
  if (isOkFindingCode(code) && !slot.severity) return null;
  const parsed = parsedFromSlot(slot);
  const raw = slot.findingType || parsed.findingType;
  const normalized = String(raw || '').trim();
  if (normalized && !['NONE', 'OK', 'NULL', 'UNDEFINED'].includes(normalized.toUpperCase())) {
    return raw;
  }
  return inferFindingType(slot.message || parsed.kpi_analysis || parsed.description || '');
}

export function slotWeightForScoring(slot, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  if (Number(slot?.weight) > 0) return Number(slot.weight);
  const code = String(slot?.slotCode || '').toUpperCase();
  if (Number(v4.slotWeights[code]) > 0) return Number(v4.slotWeights[code]);
  if (v4.criticalSlotCodes.includes(code)) return 3;
  const findingType = slotFindingType(slot);
  const inferredImpact = inferImpactType(findingType, v4);
  const impact = inferredImpact !== 'NONE' ? inferredImpact : slotImpactType(slot);
  if (impact === 'SAFETY' || slot?.criticalFlag || parsedFromSlot(slot).criticalFlag) return 3;
  if (impact === 'FUNCTIONAL') return 2;
  const sev = String(slot?.severity || '').toLowerCase();
  if (sev === 'high') return 3;
  return 1;
}

function classifyKpiKey(slot, scoreConfig, classifyFn) {
  const parsed = parsedFromSlot(slot);
  return slot.kpiKey
    || parsed.kpi
    || (classifyFn ? classifyFn(slot, scoreConfig?.slotKpiMap) : null)
    || null;
}

function applyKpiCaps(score, slotsInGroup, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  let next = score;
  const highs = (slotsInGroup || []).filter((s) => String(s.severity || '').toLowerCase() === 'high');
  const hasSafety = highs.some((s) => {
    const impact = slotImpactType(s) || inferImpactType(slotFindingType(s), v4);
    return impact === 'SAFETY' || s.criticalFlag || parsedFromSlot(s).criticalFlag;
  });
  const hasFunctional = highs.some((s) => {
    const impact = slotImpactType(s) || inferImpactType(slotFindingType(s), v4);
    return impact === 'FUNCTIONAL';
  });
  if (hasSafety) next = Math.min(next, v4.caps.highSafety);
  else if (hasFunctional) next = Math.min(next, v4.caps.highFunctional);
  return next;
}

export function caseHasHighSafety(slots, scoreConfig) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  return (slots || []).some((s) => {
    if (isOmittedOrNotEvaluable(s)) return false;
    if (String(s.severity || '').toLowerCase() !== 'high') return false;
    const impact = slotImpactType(s) || inferImpactType(slotFindingType(s), v4);
    return impact === 'SAFETY' || s.criticalFlag || parsedFromSlot(s).criticalFlag;
  });
}

export function starsFromScoreV4(score, scoreConfig, opts = {}) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  let stars = 1;
  for (const band of v4.stars.bands) {
    if (n >= band.from) stars = band.stars;
  }
  if (opts.highSafety) {
    stars = Math.min(stars, v4.stars.highSafetyMaxStars);
  }
  return stars;
}

/**
 * Post-proceso de un análisis IA: coherencia, KPI, tablero, confianza.
 * No llama a OpenAI (la validación HIGH se orquesta en server.js).
 */
export function applyV4PostAnalysis({
  kpiKey,
  slotCode,
  finalSeverity,
  confidence,
  parsed,
  description,
  kpiAnalysis,
  scoreConfig
}) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const textBlob = [description, kpiAnalysis, parsed?.observation, parsed?.inference, parsed?.severity_reason]
    .filter(Boolean)
    .join(' ');
  let analysis = {
    description,
    kpi_analysis: kpiAnalysis,
    observation: parsed?.observation || description,
    inference: parsed?.inference || null,
    findingType: parsed?.findingType || inferFindingType(textBlob),
    impactType: String(parsed?.impactType || '').toUpperCase() || null,
    evaluability: String(parsed?.evaluability || 'EVALUABLE').toUpperCase(),
    findingPresent: parsed?.findingPresent,
    severity: finalSeverity,
    confidence,
    recommendedAction: parsed?.recommendedAction || null,
    evidence: Array.isArray(parsed?.evidence) ? parsed.evidence : [],
    electricalInventory: parsed?.electricalInventory || parsed?.electrical_inventory || null,
    criticalFlag: !!parsed?.criticalFlag
  };

  analysis = applyCoherenceFromConfig(analysis, v4);
  if (analysis.findingPresent === false && textHasCoherenceNoFinding(textBlob, v4)) {
    analysis.severity = null;
    analysis.score = v4.severityScores.ok;
  }

  const kpiCheck = validateFindingKpi(analysis.findingType, kpiKey, v4);
  analysis.kpi = kpiCheck.kpi || kpiKey;

  if (!analysis.impactType || analysis.impactType === 'NONE' && analysis.findingType) {
    analysis.impactType = inferImpactType(analysis.findingType, v4);
  }

  analysis = applyElectricalInventoryRules(
    analysis,
    analysis.electricalInventory,
    v4,
    slotCode
  );
  analysis = applyConfidenceGating(analysis, v4);

  if (String(analysis.evaluability || '').toUpperCase() === 'NO_EVALUABLE') {
    analysis.severity = null;
    analysis.score = null;
    analysis.findingPresent = false;
  }

  if (analysis.severity) {
    analysis.score = slotScoreFromSeverity(analysis.severity, v4);
    analysis.findingPresent = true;
  } else if (analysis.evaluability !== 'NO_EVALUABLE') {
    analysis.score = v4.severityScores.ok;
    analysis.findingPresent = false;
  }

  return { analysis, kpiCheck, v4 };
}

export function computeCoverage(slots) {
  const list = Array.isArray(slots) ? slots : [];
  const expected = list.length;
  const evaluable = list.filter((s) => !isOmittedOrNotEvaluable(s)).length;
  const pct = expected > 0 ? (evaluable / expected) * 100 : 0;
  return {
    expectedSlots: expected,
    evaluableSlots: evaluable,
    coverage: Math.round(pct * 10) / 10
  };
}

export function computeScoringV4(slots, scoreConfig, classifyFn) {
  const v4 = normalizeV4Policy(scoreConfig || {});
  const byGroup = new Map();
  const validSlots = [];

  (slots || []).forEach((s) => {
    if (isOmittedOrNotEvaluable(s)) return;
    const key = classifyKpiKey(s, scoreConfig, classifyFn);
    if (!key) return;
    validSlots.push(s);
    if (!byGroup.has(key)) {
      byGroup.set(key, { groupKey: key, title: kpiTitleFromKey(key), impact: 0, slotsCount: 0, slots: [] });
    }
    const group = byGroup.get(key);
    const score = slotScoreFromSeverity(s.severity, v4);
    const weight = slotWeightForScoring(s, v4);
    group.slots.push({ slot: s, score, weight });
    group.slotsCount += 1;
    group.impact += Math.max(0, 100 - score);
  });

  const byGroupArr = Array.from(byGroup.values()).map((g) => {
    const tw = g.slots.reduce((acc, x) => acc + x.weight, 0);
    const raw = tw > 0
      ? g.slots.reduce((acc, x) => acc + x.score * x.weight, 0) / tw
      : 100;
    const capped = applyKpiCaps(raw, g.slots.map((x) => x.slot), v4);
    const scoreIfOnlyGroup = Math.max(0, Math.min(100, Math.round(capped)));
    const stiWeight = (() => {
      const w = Number(scoreConfig?.kpiWeights?.[g.groupKey]);
      return Number.isFinite(w) && w > 0 ? w : 1;
    })();
    return {
      groupKey: g.groupKey,
      title: g.title,
      impact: g.impact,
      slotsCount: g.slotsCount,
      stiWeight,
      scoreIfOnlyGroup,
      scoreExact: Math.round(capped * 10) / 10
    };
  });

  const scoredGroups = byGroupArr.filter((g) => g.slotsCount > 0);
  const weightedTotal = scoredGroups.reduce((acc, g) => acc + (g.stiWeight || 1), 0);
  const weightedScoreSum = scoredGroups.reduce((acc, g) => acc + g.scoreIfOnlyGroup * (g.stiWeight || 1), 0);
  const avgExact = weightedTotal > 0 ? weightedScoreSum / weightedTotal : 0;
  const score = Math.max(0, Math.min(100, Math.round(avgExact)));
  const highSafety = caseHasHighSafety(slots, v4);
  const stars = starsFromScoreV4(score, v4, { highSafety });
  const coverage = computeCoverage(slots);
  const yellowFrom = Number(scoreConfig?.badge?.yellowFrom ?? 60);
  const greenFrom = Number(scoreConfig?.badge?.greenFrom ?? 86);
  const badge = score < yellowFrom ? 'RED' : score < greenFrom ? 'YELLOW' : 'GREEN';

  return {
    scoreVersion: SCORE_VERSION_V4,
    score,
    scoreExact: Math.round(avgExact * 10) / 10,
    badge,
    stars,
    highSafety,
    totalImpact: scoredGroups.reduce((acc, g) => acc + g.impact, 0),
    byGroup: byGroupArr,
    coverage
  };
}
