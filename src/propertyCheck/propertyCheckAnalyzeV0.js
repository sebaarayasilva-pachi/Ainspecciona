/**
 * Análisis on-demand para PropertyCheck: fotos por URL + planItemId (slot-like).
 * Reutiliza el mismo flujo OpenAI (responses + json_schema) que el análisis por slot en server.js.
 */

import OpenAI from 'openai';
import crypto from 'node:crypto';
import { classifyKpiFromSlot, DEFAULT_SCORE_CONFIG, formatAiFindingExamplesBlock } from '../scoring/scoringV2_2.js';
import { getKbPromptBlock } from '../aintelligence/kb/promptBlock.js';
import { combinedTextHasAffirmativeDefectMention } from '../analysis/defectMentionFromText.js';
import {
  electricAnalysisPromptPreamble,
  correctWallElectricMatchesSlotFalsePositive,
  electricPanelInferiorWearLikelyDirtOnly,
  scrubElectricPanelInferiorDirtNarrative
} from '../analysis/electricSlotAnalysis.js';

function slotGroupTitleFromCode(slotCode = '') {
  const code = String(slotCode || '').toUpperCase();
  const bathMatch = code.match(/^BATHROOM_(\d+)_/);
  if (bathMatch) return { groupKey: `BATH_${bathMatch[1]}`, groupTitle: `Baño ${bathMatch[1]}` };
  const bedMatch = code.match(/^BEDROOM_(\d+)_/);
  if (bedMatch) return { groupKey: `BEDROOM_${bedMatch[1]}`, groupTitle: `Dormitorio ${bedMatch[1]}` };
  if (code.startsWith('KITCHEN_')) return { groupKey: 'KITCHEN', groupTitle: 'Cocina' };
  if (code.startsWith('LAUNDRY_')) return { groupKey: 'LAUNDRY', groupTitle: 'Loggia' };
  if (code.startsWith('LIVING_')) return { groupKey: 'LIVING', groupTitle: 'Living' };
  if (code.startsWith('ELECTRICAL_')) return { groupKey: 'ELECTRICAL', groupTitle: 'Electricidad' };
  if (code.startsWith('PUERTA_') || code.startsWith('DOOR_')) return { groupKey: 'DOORS', groupTitle: 'Puertas' };
  if (code.startsWith('REJA_')) return { groupKey: 'ENTRADA', groupTitle: 'Entrada' };
  if (code.startsWith('ELEVATOR') || code.startsWith('ASCENSOR')) return { groupKey: 'ELEVATOR', groupTitle: 'Ascensor' };
  if (code.startsWith('CERTIFICADO')) return { groupKey: 'CERTIFICADO', groupTitle: 'Certificado verde' };
  if (code.startsWith('ESTACIONAMIENTO') || code.startsWith('PARKING')) return { groupKey: 'PARKING', groupTitle: 'Estacionamiento' };
  return { groupKey: 'OTHER', groupTitle: 'Otros' };
}

/** Texto agregado o bloques `output` cuando `output_text` viene vacío (Responses API). */
function extractResponsesApiText(response) {
  const direct = String(response?.output_text || '').trim();
  if (direct) return direct;

  const parts = [];
  for (const item of response?.output || []) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block?.type === 'output_text' && block.text) {
          parts.push(String(block.text));
        } else if (block?.type === 'text' && block.text) {
          parts.push(String(block.text));
        }
      }
    }
    if (item?.type === 'output_text' && item.text) {
      parts.push(String(item.text));
    }
  }
  return parts.join('\n').trim();
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function fetchImageAsDataUrl(imageUrl, log) {
  const res = await fetch(imageUrl, { redirect: 'follow' });
  if (!res.ok) {
    const err = new Error(`IMAGE_FETCH_${res.status}`);
    err.code = 'IMAGE_FETCH';
    throw err;
  }
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  const maxBytes = Number(process.env.PROPERTYCHECK_MAX_IMAGE_BYTES || 15 * 1024 * 1024);
  if (buf.length > maxBytes) {
    const err = new Error('IMAGE_TOO_LARGE');
    err.code = 'IMAGE_TOO_LARGE';
    throw err;
  }
  const b64 = buf.toString('base64');
  return { photoUrl: `data:${mime};base64,${b64}`, mimeType: mime };
}

/**
 * @param {object} opts
 * @param {string} opts.photoUrl data URL
 * @param {string} opts.mimeType
 * @param {string} opts.planItemId
 * @param {object} opts.activeScoreConfig
 * @param {import('pino').Logger | Console} [opts.log]
 */
export async function analyzeOnePhotoDataUrlWithOpenAI({ photoUrl, mimeType, planItemId, activeScoreConfig, prisma, log }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const e = new Error('OPENAI_NOT_CONFIGURED');
    e.code = 'OPENAI_NOT_CONFIGURED';
    throw e;
  }

  const syntheticSlot = {
    id: 'propertycheck-external',
    slotCode: String(planItemId || '').trim() || 'OTHER',
    title: String(planItemId || '')
      .replace(/_/g, ' ')
      .trim() || 'Evidencia',
    message: ''
  };

  const kpiKey = classifyKpiFromSlot(syntheticSlot, activeScoreConfig?.slotKpiMap);
  const slotCodeUpper = String(syntheticSlot.slotCode || '').toUpperCase();
  const areaInfo = slotGroupTitleFromCode(syntheticSlot.slotCode);
  const areaDesc =
    syntheticSlot.title || `${areaInfo.groupTitle} – ${String(syntheticSlot.slotCode || '').replace(/_/g, ' ')}`;

  const kpiCriteriaDesc = {
    MUROS_PINTURA: 'estado de muros, cielos y pintura',
    HUMEDAD: 'presencia de humedad o filtraciones',
    PISOS: 'estado de pisos y superficies',
    SANITARIOS: 'estado de artefactos sanitarios y cañerías',
    ELECTRICIDAD: 'instalación eléctrica visible',
    VENTANAS_CERRAMIENTOS: 'ventanas y cerramientos',
    PUERTAS_HERRAJES: 'puertas y herrajes',
    MOBILIARIO_FIJO: 'mobiliario fijo'
  };
  const criteriaDesc = kpiCriteriaDesc[String(kpiKey || '').toUpperCase()] || 'el criterio evaluado';

  const generalPrompt = activeScoreConfig?.aiPrompts?.GENERAL || DEFAULT_SCORE_CONFIG.aiPrompts?.GENERAL || '';
  const kpiPrompt =
    activeScoreConfig?.aiPrompts?.[kpiKey] || DEFAULT_SCORE_CONFIG.aiPrompts?.[kpiKey] || '';
  const promptTemplate = [generalPrompt, kpiPrompt].filter(Boolean).join('\n\n') || [
    'Eres un inspector técnico profesional que realiza evaluaciones de inmuebles.',
    'Evalúa la imagen del área: {{AREA_DESCRIPTION}}, en cuanto a {{CRITERIA_DESCRIPTION}}.',
    'Redacta como un profesional: lenguaje claro, objetivo y técnico.',
    'Entrega el resultado en formato estructurado.'
  ].join('\n');

  const findingExamplesBlock = formatAiFindingExamplesBlock(kpiKey, activeScoreConfig);
  const electricPre =
    String(kpiKey || '').toUpperCase() === 'ELECTRICIDAD' ? electricAnalysisPromptPreamble(slotCodeUpper) : '';
  let resolvedPrompt =
    electricPre +
    String(promptTemplate)
      .replace(/\{\{SLOT_CODE\}\}/g, areaDesc)
      .replace(/\{\{AREA_DESCRIPTION\}\}/g, areaDesc)
      .replace(/\{\{CRITERIA_DESCRIPTION\}\}/g, criteriaDesc);
  if (findingExamplesBlock) resolvedPrompt += findingExamplesBlock;
  // KB unificada (RAG): criterios aprendidos de revisiones ITO
  const kbBlock = await getKbPromptBlock({
    prisma,
    text: `${areaDesc}. ${criteriaDesc}`,
    kpiKey,
    sources: ['PROPERTYCHECK', 'AINSPECTA'],
    log
  });
  if (kbBlock) resolvedPrompt += `\n${kbBlock}`;
  const prompt = resolvedPrompt;

  const outputFormat = [
    '',
    'Formato de salida (JSON válido):',
    '{',
    '  "description": "Descripción objetiva de lo visible",',
    '  "kpi_analysis": "Conclusión solo según el KPI",',
    '  "signals_detected": ["..."],',
    '  "details": [',
    '    { "signal": "...", "location": "...", "extent": "localizado|moderado|extendido" }',
    '  ],',
    '  "proposed_severity": "low|medium|high|none",',
    '  "severity_reason": "fundamento breve de severidad",',
    '  "matches_slot": true,',
    '  "match_confidence": 0.0,',
    '  "match_reason": "Justificación breve de correspondencia al slot",',
    '  "confidence": 0.0',
    '}',
    '',
    'Reglas obligatorias:',
    '- Si la imagen NO muestra el área o elemento solicitado en el slot, pon matches_slot=false, proposed_severity="none", signals_detected=[] y details=[]. Explica en description y kpi_analysis. No inventes severidad del KPI sobre otra zona.',
    '- En interruptores o enchufes de pared: NO marques matches_slot=false solo porque no se ve tablero o diferencial.'
  ].join('\n');

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';

  const requestPayload = {
    model,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `${prompt}\n${outputFormat}` },
          { type: 'input_image', image_url: photoUrl }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'image_analysis',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string', minLength: 1 },
            kpi_analysis: { type: 'string', minLength: 1 },
            signals_detected: { type: 'array', items: { type: 'string' } },
            details: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  signal: { type: 'string' },
                  location: { type: 'string' },
                  extent: { type: 'string', enum: ['localizado', 'moderado', 'extendido'] }
                },
                required: ['signal', 'location', 'extent']
              }
            },
            proposed_severity: { type: 'string', enum: ['low', 'medium', 'high', 'none'] },
            severity_reason: { type: 'string', minLength: 1 },
            matches_slot: { type: 'boolean' },
            match_confidence: { type: 'number' },
            match_reason: { type: 'string', minLength: 1 },
            confidence: { type: 'number' }
          },
          required: [
            'description',
            'kpi_analysis',
            'signals_detected',
            'details',
            'proposed_severity',
            'severity_reason',
            'matches_slot',
            'match_confidence',
            'match_reason',
            'confidence'
          ]
        }
      }
    },
    temperature: 0.2
  };

  const maxAttempts = Math.min(
    4,
    Math.max(1, Number(process.env.PROPERTYCHECK_OPENAI_RETRY_ATTEMPTS || 3)),
  );
  let rawText = '';
  let response;
  let lastEmpty = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = await client.responses.create(requestPayload);
    rawText = extractResponsesApiText(response);
    if (rawText) break;
    lastEmpty = new Error('EMPTY_OPENAI_RESPONSE');
    lastEmpty.code = 'EMPTY_OPENAI_RESPONSE';
    log?.warn?.(
      { planItemId, attempt, status: response?.status },
      'propertycheck-openai-empty-output-retry',
    );
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  if (!rawText) {
    throw lastEmpty;
  }

  const parseJson = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  };

  const parsed = parseJson(rawText) || {};
  const sanitizeTechnicalCodes = (text) => {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/\bLIVING_CEILING\b/gi, 'el techo del living')
      .replace(/\bLIVING_WALLS\b/gi, 'los muros del living')
      .replace(/\bLIVING_FLOOR\b/gi, 'el piso del living')
      .replace(/\bBATHROOM_\d+_\w+/g, (m) => m.replace(/_/g, ' ').toLowerCase())
      .replace(/\bKITCHEN_\w+/g, (m) => m.replace(/_/g, ' ').toLowerCase())
      .replace(/\bBEDROOM_\d+_\w+/g, (m) => m.replace(/_/g, ' ').toLowerCase());
  };

  let description = sanitizeTechnicalCodes(String(parsed.description || '').trim());
  let kpiAnalysis = sanitizeTechnicalCodes(String(parsed.kpi_analysis || '').trim());
  let signals = Array.isArray(parsed.signals_detected)
    ? parsed.signals_detected.map((s) => sanitizeTechnicalCodes(String(s)))
    : [];

  const qualityIssuePatterns = [
    /image_quality_issue/i,
    /calidad\s*(de\s*)?(imagen|foto)/i,
    /retomar\s*(la\s*)?foto/i,
    /falta\s*de\s*claridad/i,
    /imagen\s*borrosa/i,
    /blur/i,
    /poca\s*iluminación/i
  ];
  signals = signals.filter((sig) => {
    const s = String(sig || '').toLowerCase();
    return !qualityIssuePatterns.some((p) => p.test(s) || s.includes('image_quality'));
  });

  const removeRetakePhrases = (text) => {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/\s*No\s+se\s+puede\s+evaluar\s+por\s+falta\s+de\s+claridad\.?\s*/gi, ' ')
      .replace(/\s*Se\s+recomienda\s+retomar\s+(la\s*)?fotograf[ií]a\.?\s*/gi, ' ')
      .replace(/\s*Se\s+sugiere\s+retomar\s+(la\s*)?foto\.?\s*/gi, ' ')
      .replace(/\s*Retomar\s+(la\s*)?fotograf[ií]a\s+recomendado\.?\s*/gi, ' ')
      .replace(/\s*,\s*lo\s+que\s+dificulta\s+(la\s*)?visibilidad\.?\s*/gi, '. ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };
  kpiAnalysis = removeRetakePhrases(kpiAnalysis);
  description = removeRetakePhrases(description);

  let details = Array.isArray(parsed.details) ? [...parsed.details] : [];
  if (String(kpiKey || '').toUpperCase() === 'SANITARIOS') {
    const blobInterv = `${description} ${kpiAnalysis} ${signals.join(' ')}`.toLowerCase();
    const claimsNonStandard = /\bintervenc(i[oó]n|ion)\s+no\s+est(aá)ndar/i.test(blobInterv);
    const strongPlumbingIntervention =
      /\b(cinta\s+aislant|huincha|contrahuinch|tefl[oó]n\s+.{0,24}(excesiv|abundant|desorden)|empalme\s+.{0,32}(abiert|r[uú]stic|visible)|soldadur\w*.{0,20}(irregular|deficient|fr[ií]a)|abrazadera\w*.{0,20}(improv|pl[aá]stic|m[uú]ltiple)|rosca\w*.{0,20}destroz|pvc\w*.{0,40}(metal|flexible)|manguera\s+per\b|\bperico\b|uni[oó]n\s+mixta|relleno\s+con\s+masilla)/i.test(blobInterv);
    if (claimsNonStandard && !strongPlumbingIntervention) {
      signals = signals.filter((sig) => !/\bintervenc(i[oó]n|ion)\s+no\s+est(aá)ndar/i.test(String(sig || '')));
      details = details.filter((d) => !/\bintervenc(i[oó]n|ion)\s+no\s+est(aá)ndar/i.test(String(d?.signal || '')));
      const scrubInterventionClaim = (t) => {
        let s = String(t || '');
        s = s.replace(/\s*,\s*y\s+una\s+intervenc(i[oó]n|ion)\s+no\s+est(aá)ndar(\s+visible)?\b/gi, '');
        s = s.replace(/\s*y\s+una\s+intervenc(i[oó]n|ion)\s+no\s+est(aá)ndar(\s+visible)?\b/gi, '');
        s = s.replace(/\bintervenc(i[oó]n|ion)\s+no\s+est(aá)ndar(\s+visible)?\b/gi, '');
        return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').replace(/,\s*\./g, '.').trim();
      };
      description = scrubInterventionClaim(description);
      kpiAnalysis = scrubInterventionClaim(kpiAnalysis);
    }
  }

  const proposedSeverityRaw = String(parsed.proposed_severity || '').trim().toLowerCase();
  const proposedSeverity = ['low', 'medium', 'high'].includes(proposedSeverityRaw) ? proposedSeverityRaw : null;
  const severityReason = String(parsed.severity_reason || '').trim() || 'Sin fundamento de severidad.';
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7)));
  let matchesSlot = typeof parsed.matches_slot === 'boolean' ? parsed.matches_slot : true;
  const matchReason = String(parsed.match_reason || '').trim() || 'Correspondencia al área evaluada.';

  let analysisLower = `${description} ${kpiAnalysis}`.toLowerCase();
  const favorableNoIssuePhrases = [
    'sin observaciones',
    'sin hallazgos relevantes',
    'no se observan hallazgos',
    'no se observan hallazgos relevantes',
    'no se observan problemas',
    'no se observan problemas relevantes',
    'no se observan anomalías',
    'no se observan anomalias',
    'no se observan señales relevantes',
    'no se observan daños relevantes',
    'no se identifican hallazgos',
    'no se identifican hallazgos relevantes',
    'no se identifican problemas',
    'no se detectan hallazgos',
    'no se detectan hallazgos relevantes',
    'no se detectan problemas',
    'sin señales',
    'sin señales evidentes',
    'condiciones adecuadas',
    'condición adecuada',
    'sin daños',
    'sin deterioros',
    'sin anomalías',
    'sin anomalias',
    'sin signos',
    'no presenta señales'
  ];
  let analysisSaysNoIssue = favorableNoIssuePhrases.some((p) => analysisLower.includes(p));
  const signalsLower = signals.map((sig) => String(sig || '').toLowerCase());
  let hasRealDefect = combinedTextHasAffirmativeDefectMention(
    String(description || '').toLowerCase(),
    String(kpiAnalysis || '').toLowerCase(),
    signalsLower
  );
  if (hasRealDefect) {
    analysisSaysNoIssue = false;
  }
  const kpiLowerOnlyPc = String(kpiAnalysis || '').toLowerCase();
  const kpiConcludesNoRelevantPc = favorableNoIssuePhrases.some((p) => kpiLowerOnlyPc.includes(p));
  const kpiSelfContradictPc = /\b(excepto|salvo|a excepci[oó]n de|pero\s+s[ií]\s+hay|sin embargo[,]?\s+(?:s[ií]|hay|se observa))\b/i.test(kpiLowerOnlyPc);
  if (kpiConcludesNoRelevantPc && !kpiSelfContradictPc) {
    analysisSaysNoIssue = true;
    signals.length = 0;
    hasRealDefect = false;
  }
  if (analysisSaysNoIssue && signals.length) {
    signals.length = 0;
  }
  if (analysisSaysNoIssue) {
    signals = [];
    hasRealDefect = false;
  }
  analysisLower = `${description} ${kpiAnalysis}`.toLowerCase();
  if (!description) description = 'Descripcion no disponible.';
  if (!kpiAnalysis) {
    kpiAnalysis = signals.length
      ? 'Se observan señales visibles en el área evaluada.'
      : 'No se observan problemas en el área evaluada.';
  }
  if (kpiAnalysis.length < 120) {
    const defectPaddingContext =
      signals.length > 0 ||
      hasRealDefect ||
      !!proposedSeverity;
    const extra = defectPaddingContext
      ? 'Se aprecian detalles en el encuadre que conviene describir con precisión (ubicación y extensión) en coherencia con lo observado.'
      : 'Las superficies se ven uniformes y sin evidencias claras de deterioro.';
    kpiAnalysis = `${kpiAnalysis} ${extra}`.trim();
  }
  matchesSlot = correctWallElectricMatchesSlotFalsePositive({
    kpiKey,
    slotCode: slotCodeUpper,
    matchesSlot,
    description,
    kpiAnalysis,
    matchReason
  });

  const severityRank = { none: 0, low: 1, medium: 2, high: 3 };
  const normalizeSeverity = (value) => {
    const s = String(value || '').toLowerCase();
    return ['low', 'medium', 'high'].includes(s) ? s : null;
  };
  const extentText = details.map((d) => String(d?.extent || '').toLowerCase());
  const hasWide = extentText.some((t) => t.includes('extend') || t.includes('general') || t.includes('ampl'));
  let severityFromEvidence = (() => {
    if (analysisSaysNoIssue && (activeScoreConfig?.severityRules?.enforceFavorableOk ?? true)) return null;
    if (hasWide) return 'high';
    const kpiRules = activeScoreConfig?.severityRules?.byKpi?.[String(kpiKey || '').toUpperCase()] || {};
    const criticalKeywords = Array.isArray(kpiRules.criticalKeywords) ? kpiRules.criticalKeywords : [];
    const hasCriticalByKpi = criticalKeywords.some((k) => {
      const kw = String(k || '').toLowerCase().trim();
      return !!kw && (analysisLower.includes(kw) || signals.some((sig) => String(sig || '').toLowerCase().includes(kw)));
    });
    if (hasCriticalByKpi) return 'high';
    if (signals.length >= 2 || details.some((d) => String(d?.extent || '').toLowerCase().includes('moderad')))
      return 'medium';
    if (signals.length >= 1 || hasRealDefect) return 'low';
    return null;
  })();
  const chosenSeverity = (() => {
    if (analysisSaysNoIssue) return null;
    const proposed = normalizeSeverity(proposedSeverity);
    const minimum = normalizeSeverity(severityFromEvidence);
    if (!proposed && !minimum) return null;
    if (!proposed) return minimum;
    if (!minimum) return proposed;
    return severityRank[proposed] >= severityRank[minimum] ? proposed : minimum;
  })();
  let finalSeverity = chosenSeverity;
  let severitySource =
    analysisSaysNoIssue && finalSeverity === null
      ? 'forced_ok'
      : finalSeverity && proposedSeverity && finalSeverity === proposedSeverity
        ? 'ai_proposed'
        : finalSeverity
          ? 'rule_guardrail'
          : 'none';
  let hasSignals = !!finalSeverity;
  let scorePenaltyApplied =
    hasSignals && kpiKey && activeScoreConfig?.kpis?.[kpiKey]
      ? Number(activeScoreConfig.kpis[kpiKey][String(finalSeverity).toLowerCase()] ?? 0)
      : 0;

  if (hasSignals && electricPanelInferiorWearLikelyDirtOnly({
    slotCodeUpper,
    kpiKey,
    description,
    kpiAnalysis,
    signals,
    details
  })) {
    const scrubbed = scrubElectricPanelInferiorDirtNarrative(description, kpiAnalysis);
    description = scrubbed.description;
    kpiAnalysis = scrubbed.kpiAnalysis;
    signals = signals.filter((sig) => {
      const s = String(sig || '').toLowerCase();
      if (!/\b(desgaste|desgastad|deterioro)/i.test(s)) return true;
      if (/\b(inferior|fondo|base|bajo|parte\s+baja|riel)/i.test(s)) return false;
      return true;
    });
    details = details.filter((d) => {
      const s = String(d?.signal || '').toLowerCase();
      if (!/\b(desgaste|desgastad|deterioro)/i.test(s)) return true;
      if (/\b(inferior|fondo|base|bajo|parte\s+baja|riel)/i.test(s)) return false;
      return true;
    });
    finalSeverity = null;
    hasSignals = false;
    severitySource = 'rule_electric_panel_inferior_dirt_not_wear';
    scorePenaltyApplied = 0;
  }

  if (!matchesSlot) {
    finalSeverity = null;
    signals.length = 0;
    hasSignals = false;
    scorePenaltyApplied = 0;
    severitySource = 'slot_mismatch_no_penalty';
  }

  const parsedOut = {
    ...parsed,
    description,
    kpi_analysis: kpiAnalysis,
    signals_detected: signals,
    details,
    proposed_severity: proposedSeverityRaw || 'none',
    severity_reason: severityReason,
    final_severity: finalSeverity || null,
    severity_source: severitySource,
    matches_slot: matchesSlot,
    match_confidence: Math.max(0, Math.min(1, Number(parsed.match_confidence ?? 0.7))),
    match_reason: matchReason,
    score_penalty_applied: scorePenaltyApplied
  };

  log?.info?.(
    { planItemId, slotCodeUpper, kpiKey, finalSeverity, scorePenaltyApplied },
    'propertycheck-openai-done'
  );

  return {
    model,
    rawText,
    parsed: parsedOut,
    kpiKey,
    finalSeverity,
    scorePenaltyApplied,
    confidence
  };
}

/**
 * @param {object} p
 * @param {object} p.body - { externalInspectionId, photoPlan, photos[] }
 * @param {() => Promise<{ config: object, updatedAt?: Date }>} p.getRuntimeScoreConfig
 * @param {import('pino').Logger} [p.log]
 */
export async function runPropertyCheckPhotoBatchAnalysisV0({ body, getRuntimeScoreConfig, prisma, log }) {
  const requestId = crypto.randomUUID();
  const externalInspectionId = String(body?.externalInspectionId || '').trim();
  const photoPlan = body?.photoPlan || {};
  const photos = Array.isArray(body?.photos) ? body.photos : [];

  if (!externalInspectionId) {
    return { kind: 'error', ok: false, requestId, code: 'VALIDATION', message: 'externalInspectionId requerido.' };
  }
  if (!photos.length) {
    return { kind: 'error', ok: false, requestId, code: 'VALIDATION', message: 'photos[] no puede estar vacío.' };
  }
  const maxPhotos = Math.min(80, Math.max(1, Number(process.env.PROPERTYCHECK_MAX_PHOTOS_PER_REQUEST || 50)));
  if (photos.length > maxPhotos) {
    return {
      kind: 'error',
      ok: false,
      requestId,
      code: 'VALIDATION',
      message: `Máximo ${maxPhotos} fotos por solicitud.`
    };
  }

  let runtimeCfg;
  try {
    runtimeCfg = await getRuntimeScoreConfig();
  } catch (e) {
    return {
      kind: 'error',
      ok: false,
      requestId,
      code: 'CONFIG',
      message: String(e?.message || e)
    };
  }
  const activeScoreConfig = runtimeCfg?.config || DEFAULT_SCORE_CONFIG;

  for (let i = 0; i < photos.length; i++) {
    const ph = photos[i] || {};
    const captureId = String(ph.captureId || '').trim();
    const planItemId = String(ph.planItemId || '').trim();
    const imageUrl = String(ph.imageUrl || '').trim();
    if (!captureId || !planItemId || !imageUrl) {
      return {
        kind: 'error',
        ok: false,
        requestId,
        code: 'VALIDATION',
        message: `Foto índice ${i}: captureId, planItemId e imageUrl son obligatorios.`
      };
    }
  }

  const concurrency = Math.min(
    8,
    Math.max(1, Number(process.env.PROPERTYCHECK_ANALYZE_CONCURRENCY || 4)),
  );

  let byCapture;
  try {
    byCapture = await mapPool(photos, concurrency, async (ph, i) => {
      const captureId = String(ph.captureId || '').trim();
      const planItemId = String(ph.planItemId || '').trim();
      const imageUrl = String(ph.imageUrl || '').trim();
      const { photoUrl } = await fetchImageAsDataUrl(imageUrl, log);
      const one = await analyzeOnePhotoDataUrlWithOpenAI({
        photoUrl,
        mimeType: 'image/jpeg',
        planItemId,
        activeScoreConfig,
        prisma,
        log
      });
      const p = one.parsed;
      return {
        captureId,
        planItemId,
        sequence: ph.sequence ?? i + 1,
        kpiKey: one.kpiKey,
        parsed: {
          description: p.description,
          kpi_analysis: p.kpi_analysis,
          proposed_severity: p.proposed_severity,
          final_severity: p.final_severity,
          signals_detected: p.signals_detected,
          score_penalty_applied: p.score_penalty_applied
        }
      };
    });
  } catch (err) {
    log?.warn?.({ err: err?.message }, 'propertycheck-photo-failed');
    return {
      kind: 'error',
      ok: false,
      requestId,
      code: err?.code || 'ANALYSIS_FAILED',
      message: String(err?.message || err)
    };
  }
  let penaltySum = 0;
  const byKpiPenalty = {};
  for (const row of byCapture) {
    const pen = Number(row.parsed?.score_penalty_applied || 0);
    penaltySum += pen;
    const k = String(row.kpiKey || 'OTHER');
    byKpiPenalty[k] = (byKpiPenalty[k] || 0) + pen;
  }

  const global = Math.max(0, Math.min(100, Math.round(100 - penaltySum)));

  return {
    kind: 'sync',
    ok: true,
    requestId,
    externalInspectionId,
    photoPlan: {
      planId: String(photoPlan.planId || ''),
      planVersion: photoPlan.planVersion != null ? String(photoPlan.planVersion) : undefined
    },
    analysis: {
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      parsed: {
        description: `Análisis de ${byCapture.length} evidencia(s) para inspección ${externalInspectionId}.`,
        kpi_analysis: byCapture.map((c) => `[${c.planItemId}] ${c.parsed.kpi_analysis}`).join('\n\n'),
        signals_detected: byCapture.flatMap((c) => c.parsed.signals_detected || []),
        proposed_severity: 'none',
        final_severity: null,
        score_penalty_applied: penaltySum
      },
      byCapture,
      raw: undefined
    },
    scores: {
      global,
      byKpi: byKpiPenalty,
      notes: 'global = 100 - suma(score_penalty_applied) por foto, acotado a [0,100].'
    }
  };
}
