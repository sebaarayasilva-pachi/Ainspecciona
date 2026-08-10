/**
 * Detecta menciones reales de deterioro en texto (español), evitando falsos positivos
 * cuando la palabra aparece en contexto negado: "sin roturas", "no hay manchas", etc.
 */

/** @param {string} s */
function isLikelyNegatedSpanish(s, defectIndex) {
  if (defectIndex <= 0) return false;
  const before = s.slice(0, defectIndex);
  const window = before.slice(-180);

  const embargoIdx = before.lastIndexOf('sin embargo');
  if (embargoIdx !== -1) {
    const afterEmbargo = before.slice(embargoIdx + 'sin embargo'.length);
    if (/\b(se\s+observ|se\s+detect|se\s+aprecia|se\s+identific|hay\s+evidencia|presenta)\w*/i.test(afterEmbargo)) {
      return false;
    }
  }

  const negPatterns = [
    /\bno\s+se\s+(?:observa|observan|detectan|identifican)\s+[\wáéíóúñ\s,]*$/i,
    /\bno\s+hay\s+[\wáéíóúñ\s,]*$/i,
    /\bno\s+presenta\s+[\wáéíóúñ\s,]*$/i,
    /\bno\s+(?:existen|existe)\s+[\wáéíóúñ\s,]*$/i,
    /\bno\s+muestra\s+[\wáéíóúñ\s,]*$/i,
    /\bno\s+aprecian?\s+[\wáéíóúñ\s,]*$/i,
    /\btampoco\s+hay\s+[\wáéíóúñ\s,]*$/i,
    /\bsin\s+(?!embargo\b)[\wáéíóúñ\s,]*$/i,
    /\bausencia\s+de\s+[\wáéíóúñ\s,]*$/i,
    /\bsin\s+signos\s+de\s+[\wáéíóúñ\s,]*$/i,
    /\bsin\s+evidencia\s+de\s+[\wáéíóúñ\s,]*$/i,
    /\bsin\s+señales\s+de\s+[\wáéíóúñ\s,]*$/i
  ];

  return negPatterns.some((p) => p.test(window));
}

// Patrones sobre texto ya en minúsculas (incl. normalización de tildes comunes en minúscula)
const DEFECT_REGEXES = [
  /\b(?:corros|corrosion|óxido|oxido)\w*\b/g,
  /\bmanch\w*\b/g,
  /\bgriet\w*\b/g,
  /\bfisur\w*\b/g,
  /\bfiltr\w*\b/g,
  /\bhumedad\b/g,
  /\bmoh\w*\b/g,
  /\bsalitr\w*\b/g,
  /\bdescascar\w*\b/g,
  /\bdesprend\w*\b/g,
  /\bdeform\w*\b/g,
  /\bdesaline\w*\b/g,
  /\bdañ\w*\b/g,
  /\bdanos?\b/g,
  /\bgolpe\w*\b/g,
  /\bquiebr\w*\b/g,
  /\btrizad\w*\b/g,
  /\brot(?:o|a|os|as|ura|uras|ados?|adas?)\b/g,
  /\brayón\w*\b/g,
  /\brayon\w*\b/g,
  /\bdesgaste\w*\b/g,
  /\bcondens\w+\b/g,
  /\bdeterioro\s+(?:visible|aparente|en|del|de\s+la|de\s+los)\b/g,
  /\b(?:rotura|roturas)\s+de\s+vidrio\b/g,
  /\bvidri\w*\s+trizad\w*\b/g
];

/**
 * @param {string} descriptionLower
 * @param {string} kpiAnalysisLower
 * @param {string[]} signalStrings — strings ya en minúsculas o mixtas
 */
export function combinedTextHasAffirmativeDefectMention(descriptionLower, kpiAnalysisLower, signalStrings) {
  const pieces = [
    `${descriptionLower || ''} ${kpiAnalysisLower || ''}`.trim(),
    ...(Array.isArray(signalStrings) ? signalStrings.map((x) => String(x || '').toLowerCase()) : [])
  ].filter(Boolean);

  for (const piece of pieces) {
    const s = piece.toLowerCase();
    for (const re of DEFECT_REGEXES) {
      const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      let m;
      while ((m = r.exec(s)) !== null) {
        if (!isLikelyNegatedSpanish(s, m.index)) return true;
      }
    }
  }
  return false;
}

const SEAL_ISSUE_RES = [
  /\bcondens\w+\b/g,
  /\bsellad\w*\b/g,
  /\bsello\s+(?:defectuoso|dañado|deteriorado|perdido)\b/g,
  /\bpérdida\s+de\s+sellado\b/g,
  /\bperdida\s+de\s+sellado\b/g,
  /\brotura\s+de\s+vidrio\b/g,
  /\bvidri\w*\s+trizad\w*\b/g,
  /\b(?:paso\s+de\s+aire|corriente\s+de\s+aire)\s+(?:en|por|desde)\b/g
];

/**
 * Ventanas: condensación / sellos encaja mejor en riesgo de sellado que en cosmético genérico.
 * Respeta negación ("no hay condensación", "sin pérdida de sellado").
 * @param {string} analysisLower description + kpi en minúsculas
 */
export function windowAnalysisSuggestsSealIssue(analysisLower) {
  const s = String(analysisLower || '').toLowerCase();
  for (const re of SEAL_ISSUE_RES) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = r.exec(s)) !== null) {
      if (!isLikelyNegatedSpanish(s, m.index)) return true;
    }
  }
  return false;
}

/** Piso laminado/flotante: levantamiento o hinchazón en juntas de cabezales suele ir asociado a humedad, no a simple rayón. */
const FLOOR_JOINT_MOISTURE_RES = [
  /\b(?:junta|juntas|cabezal|cabezales)\b[\s\S]{0,90}\b(?:hinch|levant|deform|irregular|escalon|filtr|humedad|mojad|hinchaz|abult|ondul|peaking|cupping)\w*\b/gi,
  /\b(?:hinch|levant|deform|irregular|escalon|filtr|humedad|abult|ondul|peaking|cupping)\w*\b[\s\S]{0,90}\b(?:junta|juntas|cabezal|cabezales|encuentro\s+entre\s+tablones)\b/gi,
  /\b(?:piso|tablones?|laminad|flotante)\b[\s\S]{0,120}\b(?:deformaci[oó]n|exposici[oó]n\s+a\s+humedad|da[nñ]o\s+por\s+humedad|hinchaz[oó]n\s+por\s+humedad)\w*\b/gi,
  /\b(?:water|moisture)\s+damage\b[\s\S]{0,80}\b(?:joint|seam|plank)\b/gi,
  /\b(?:swollen|warped)\s+(?:end\s+)?joints?\b/gi
];

/**
 * @param {string} analysisLower description + kpi en minúsculas
 * @param {string} signalsLower señales y detalles.signal unidos, en minúsculas
 */
export function pisosAnalysisSuggestsJointMoistureDamage(analysisLower, signalsLower) {
  const s = `${String(analysisLower || '').toLowerCase()} ${String(signalsLower || '').toLowerCase()}`;
  for (const re of FLOOR_JOINT_MOISTURE_RES) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = r.exec(s)) !== null) {
      if (!isLikelyNegatedSpanish(s, m.index)) return true;
    }
  }
  return false;
}
