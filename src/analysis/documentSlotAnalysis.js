/**
 * Slots de documentos (certificado verde, certificado de inspección de ascensor).
 */

export function isDocumentComplianceSlot(slotCode = '') {
  const c = String(slotCode || '').toUpperCase();
  return c.startsWith('CERTIFICADO') || c.startsWith('ASCENSOR');
}

export function isElevatorInspectionCertSlot(slotCode = '') {
  const c = String(slotCode || '').toUpperCase();
  return c.startsWith('ASCENSOR');
}

export function isGreenCertificateSlot(slotCode = '') {
  const c = String(slotCode || '').toUpperCase();
  return c.startsWith('CERTIFICADO');
}

export function documentAnalysisPromptPreamble(slotCode = '') {
  const c = String(slotCode || '').toUpperCase();
  if (isElevatorInspectionCertSlot(c)) {
    return (
      '[ALCANCE OBLIGATORIO DEL SLOT — ASCENSOR]\n' +
      'Este ítem es el CERTIFICADO DE INSPECCIÓN DEL ASCENSOR (placa, lámina o documento en hall/cabina), NO una foto de la cabina, botonera ni puertas del ascensor.\n' +
      'La imagen debe mostrar claramente el documento o placa con texto legible: identificación del ascensor o edificio, fecha de inspección y/o vencimiento, organismo certificador y resultado.\n' +
      'Evalúa ÚNICAMENTE: (1) si el encuadre corresponde al certificado solicitado; (2) legibilidad; (3) si las fechas visibles indican vigencia al momento de la foto (vigente, vencido o no determinable por falta de datos).\n' +
      'Si solo se ve cabina, espejo o botonera sin documento legible, matches_slot=false, proposed_severity="none", signals_detected=[].\n' +
      'Si el certificado está vencido o la fecha de vencimiento es anterior a hoy (según lo legible), proposed_severity debe ser "high" y en signals_detected incluye "certificado de inspección vencido" o equivalente.\n' +
      'Si está vigente y legible, proposed_severity="none" y concluye vigencia favorable.\n' +
      'Si el documento existe pero no se leen fechas ni estado, proposed_severity="medium" por información insuficiente.\n\n'
    );
  }
  if (isGreenCertificateSlot(c)) {
    return (
      '[ALCANCE OBLIGATORIO DEL SLOT — CERTIFICADO VERDE]\n' +
      'Este ítem es el documento de certificación energética / certificado verde, NO otras zonas del inmueble.\n' +
      'Evalúa legibilidad y, si hay fechas visibles, si el certificado aparece vigente o vencido.\n' +
      'Si no corresponde al documento, matches_slot=false.\n\n'
    );
  }
  return '';
}

/**
 * Guardarraíles post-IA para vigencia de certificados (ascensor y certificado verde).
 */
export function applyDocumentComplianceAnalysisRules({
  slotCode = '',
  kpiKey,
  matchesSlot,
  description = '',
  kpiAnalysis = '',
  signals = [],
  details = [],
  proposedSeverity,
  finalSeverity,
  analysisSaysNoIssue,
  hasRealDefect
}) {
  if (String(kpiKey || '').toUpperCase() !== 'DOCUMENTOS_CUMPLIMIENTO') {
    return {
      matchesSlot,
      description,
      kpiAnalysis,
      signals,
      details,
      finalSeverity,
      analysisSaysNoIssue,
      hasRealDefect,
      analysisCode: null,
      severitySource: null
    };
  }

  const code = String(slotCode || '').toUpperCase();
  if (!isDocumentComplianceSlot(code)) {
    return {
      matchesSlot,
      description,
      kpiAnalysis,
      signals,
      details,
      proposedSeverity,
      finalSeverity,
      analysisSaysNoIssue,
      hasRealDefect,
      analysisCode: null,
      severitySource: null
    };
  }

  let nextMatches = matchesSlot;
  let desc = description;
  let kpi = kpiAnalysis;
  let sigs = [...signals];
  let dets = [...details];
  let severity = finalSeverity;
  let noIssue = analysisSaysNoIssue;
  let realDefect = hasRealDefect;
  let analysisCode = null;
  let severitySource = null;

  const blob = `${desc} ${kpi} ${sigs.join(' ')}`.toLowerCase();

  const isCabinaNotCert =
    isElevatorInspectionCertSlot(code) &&
    /\b(cabina|botonera|botones|espejo|puerta\s+del\s+ascensor|interior\s+del\s+ascensor)\b/i.test(blob) &&
    !/\b(certificado|inspecci[oó]n|placa|vencim|vigencia|sello|entidad\s+certificadora|registro)\b/i.test(blob);

  if (isCabinaNotCert) {
    nextMatches = false;
    severity = null;
    noIssue = true;
    realDefect = false;
    sigs = [];
    dets = [];
    severitySource = 'rule_elevator_not_certificate';
    return {
      matchesSlot: nextMatches,
      description: desc,
      kpiAnalysis: kpi,
      signals: sigs,
      details: dets,
      finalSeverity: severity,
      analysisSaysNoIssue: noIssue,
      hasRealDefect: realDefect,
      analysisCode: 'OK',
      severitySource
    };
  }

  const expiredEvidence =
    /\b(vencid[oa]s?|expirad[oa]s?|caducad[oa]s?|fuera\s+de\s+plazo|no\s+vigent[ea]s?|plazo\s+vencido|fecha\s+de\s+vencimiento\s+.{0,40}(pasad|anterior|vencid))\b/i.test(blob) ||
    /\b(inspecci[oó]n|certificado).{0,60}(vencid|expirad|no\s+vigent)/i.test(blob);

  const vigenteEvidence =
    !expiredEvidence &&
    /\b(vigent[ea]s?|al\s+d[ií]a|v[aá]lid[oa]s?|en\s+plazo|vigencia\s+favorable|dentro\s+de\s+plazo|certificado\s+vigente)\b/i.test(blob);

  const illegibleEvidence =
    /\b(ilegible|no\s+legible|desenfocad|borros|no\s+se\s+leen\s+las\s+fechas|texto\s+no\s+discernible|reflejo\s+que\s+impide)\b/i.test(blob);

  if (expiredEvidence) {
    severity = 'high';
    noIssue = false;
    realDefect = true;
    if (!sigs.some((s) => /vencid|expirad|no\s+vigent/i.test(String(s)))) {
      sigs.push(
        isElevatorInspectionCertSlot(code)
          ? 'Certificado de inspección de ascensor vencido o no vigente'
          : 'Certificado verde vencido o no vigente'
      );
    }
    analysisCode = 'CERTIFICATE_EXPIRED';
    severitySource = 'rule_document_expired';
  } else if (illegibleEvidence && !vigenteEvidence) {
    severity = 'medium';
    noIssue = false;
    realDefect = true;
    if (!sigs.some((s) => /ilegible|legibilidad/i.test(String(s)))) {
      sigs.push('Documento con legibilidad insuficiente para confirmar vigencia');
    }
    analysisCode = 'DOCUMENT_ILLEGIBLE';
    severitySource = 'rule_document_illegible';
  } else if (vigenteEvidence) {
    severity = null;
    noIssue = true;
    realDefect = false;
    sigs = sigs.filter((s) => !/vencid|expirad|ilegible/i.test(String(s)));
    analysisCode = 'OK';
    severitySource = 'rule_document_valid';
  }

  return {
    matchesSlot: nextMatches,
    description: desc,
    kpiAnalysis: kpi,
    signals: sigs,
    details: dets,
    finalSeverity: severity,
    analysisSaysNoIssue: noIssue,
    hasRealDefect: realDefect,
    analysisCode,
    severitySource
  };
}
