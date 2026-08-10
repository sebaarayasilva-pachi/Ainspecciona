/**
 * Alcance del análisis eléctrico según código de slot (tablero vs placas de pared).
 */

export function isElectricalPanelSlot(slotCode = '') {
  const c = String(slotCode || '').toUpperCase();
  return c === 'ELECTRICAL_PANEL' || c.includes('TABLERO') || c === 'PANEL_ELECTRICO';
}

/** Interruptores o tomas de pared (no tablero). */
export function isWallSwitchOrOutletSlot(slotCode = '') {
  const c = String(slotCode || '').toUpperCase();
  if (isElectricalPanelSlot(c)) return false;
  if (c === 'ELEVATOR' || c.startsWith('ASCENSOR') || c.startsWith('CERTIFICADO')) return false;
  return c.endsWith('_SWITCHES') || c.endsWith('_OUTLETS') || c.includes('_OUTLETS');
}

/**
 * Párrafo previo al prompt KPI para que el modelo no exija tablero en slots de interruptor.
 */
export function electricAnalysisPromptPreamble(slotCode = '') {
  const c = String(slotCode || '').toUpperCase();
  if (isElectricalPanelSlot(c)) {
    return (
      '[ALCANCE OBLIGATORIO DEL SLOT]\n' +
      'Este ítem es el TABLERO ELÉCTRICO. Aquí sí evalúas tapa, elementos visibles e interruptor diferencial si el tablero se ve completo. ' +
      'matches_slot=true solo si el encuadre muestra claramente un tablero.\n\n'
    );
  }
  if (isWallSwitchOrOutletSlot(c)) {
    const isSwitchSlot = c.endsWith('_SWITCHES');
    const switchNote = isSwitchSlot
      ? 'En slots de INTERRUPTORES: identifica cada placa por separado. Conectores coaxiales (tipo F, rosca central, salida TV/audio-video/antena), tomas de corriente tipo L (3 orificios circulares) y placas ciegas NO son interruptores ni «mecanismos expuestos». No reportes «interruptores sin tapas» ni tapas faltantes si lo visible son salidas AV, enchufes o tapas ciegas en buen estado. Solo reporta defecto si ves un apagador/interruptor real sin placa, cable expuesto o daño claro.\n'
      : '';
    return (
      '[ALCANCE OBLIGATORIO DEL SLOT]\n' +
      'Este ítem es INTERRUPTOR(ES) o TOMA(S) DE PARED en el sector del título, NO el tablero general de la vivienda. ' +
      'NO evalúes ni menciones interruptor diferencial, ni "ausencia de tablero", ni exijas ver el panel. ' +
      'Si la imagen muestra placas de interruptor, enchufe, salida AV o placa ciega en pared acordes al sector, matches_slot=true. ' +
      switchNote +
      'Describe solo el estado visible de esas placas (integridad, tapas, cables expuestos, marcas térmicas, fijación).\n\n'
    );
  }
  return (
    '[ALCANCE]\n' +
    'Evalúa la instalación eléctrica visible según el título del slot. No exijas tablero ni diferencial salvo que el título indique tablero.\n\n'
  );
}

/**
 * El modelo a veces marca matches_slot=false porque "no se ve tablero" en un slot de interruptores.
 */
export function correctWallElectricMatchesSlotFalsePositive({
  kpiKey,
  slotCode,
  matchesSlot,
  description,
  kpiAnalysis,
  matchReason
}) {
  if (String(kpiKey || '').toUpperCase() !== 'ELECTRICIDAD') return matchesSlot;
  if (matchesSlot !== false) return matchesSlot;
  if (!isWallSwitchOrOutletSlot(slotCode)) return matchesSlot;
  const blob = `${description || ''} ${kpiAnalysis || ''} ${matchReason || ''}`.toLowerCase();
  const confusedByPanel = /tablero|diferencial|panel el[eé]ctrico/.test(blob);
  const hasWallDevice =
    /\b(interruptor|enchufe|toma|placa|bot[oó]n|apagador|dimmer|llave\s+t[eé]rmica)\b/.test(blob);
  if (confusedByPanel && hasWallDevice) return true;
  return matchesSlot;
}

/**
 * Tablero abierto: el modelo suele llamar «desgaste en la parte inferior» a suciedad/residuos en el fondo o riel DIN.
 * Sin defecto eléctrico serio en el texto, no debe aplicarse penalización por COSMETIC_WEAR.
 */
export function electricPanelInferiorWearLikelyDirtOnly({
  slotCodeUpper,
  kpiKey,
  description,
  kpiAnalysis,
  signals,
  details
}) {
  if (String(kpiKey || '').toUpperCase() !== 'ELECTRICIDAD') return false;
  if (!isElectricalPanelSlot(slotCodeUpper)) return false;
  const sigPart = [
    ...(Array.isArray(signals) ? signals : []).map((x) => String(x || '')),
    ...(Array.isArray(details) ? details : []).map((d) => String(d?.signal || ''))
  ].join(' ');
  const blob = `${description || ''} ${kpiAnalysis || ''} ${sigPart}`.toLowerCase();
  const claimsInferiorWear =
    /\b(desgaste|desgastad[oa]s?|deterioro\s+superficial)\b[\s\S]{0,180}\b(inferior|fondo|base|zona\s+baja|parte\s+baja|riel\s+din|sector\s+inferior|bajo\s+los\s+breakers|bajo\s+el\s+diferencial)\b/i.test(blob) ||
    /\b(inferior|fondo\s+del\s+tablero|base\s+del\s+tablero|zona\s+inferior|bajo\s+los\s+breakers)\b[\s\S]{0,180}\b(desgaste|desgastad|deterioro\s+superficial)\b/i.test(blob);
  if (!claimsInferiorWear) return false;
  const strongPanelElectricalDefect =
    /\b(cable[s]?\s+expuest|conductor(?:es)?\s+expuest|quemadur|derretim|tapa[s]?\s+[^.]{0,40}(falt|suelta|ausente)|breaker[s]?\s+[^.]{0,50}(roto|partido|quebrad)|carcasa[s]?\s+[^.]{0,35}(partid|trizad)|chispazo|\barco\b|marcas?\s+(?:de\s+)?t[eé]rmic|huellas?\s+de\s+calor|oxid\w*\s+(?:sever|marcad|activ)|corrosi\w*\s+(?:sever|marcad|activa)|\brayad\w*\s+profund|\brayones?\s+profund|\barañad\w*\s+profund)\b/i.test(blob);
  return !strongPanelElectricalDefect;
}

/** Limpia narrativa típica «desgaste inferior del tablero» cuando aplicamos guardarraíl de suciedad. */
export function scrubElectricPanelInferiorDirtNarrative(description, kpiAnalysis) {
  const scrub = (t) => {
    let s = String(t || '');
    s = s.replace(
      /\bse\s+observa(?:n)?\s+desgaste\w*\s+en\s+la\s+parte\s+inferior\s+del\s+tablero[^.!?]*[.!?]?/gi,
      'En la zona inferior del fondo del tablero se observa acumulación de suciedad o residuos, sin deterioro mecánico claro de los elementos eléctricos visibles. '
    );
    s = s.replace(
      /\bdesgaste\w*\s+en\s+(?:la\s+)?(?:parte\s+)?inferior\s+del\s+tablero[^.!?]*[.!?]?/gi,
      'acumulación de suciedad o residuos en la zona inferior del fondo del tablero. '
    );
    s = s.replace(
      /\bdesgaste\w*\s+(?:en\s+)?(?:la\s+)?(?:zona\s+)?inferior[^.!?]*[.!?]?/gi,
      'suciedad o residuos en zona inferior del fondo. '
    );
    return s.replace(/\s{2,}/g, ' ').replace(/\.\s+\./g, '.').replace(/,\s*\./g, '.').trim();
  };
  return { description: scrub(description), kpiAnalysis: scrub(kpiAnalysis) };
}

/**
 * En slots *_SWITCHES el modelo confunde conectores coaxiales AV / enchufes / placas ciegas con «interruptores sin tapas».
 */
export function wallSwitchAvCoaxialFalsePositive({
  slotCodeUpper,
  kpiKey,
  description,
  kpiAnalysis,
  signals,
  details
}) {
  if (String(kpiKey || '').toUpperCase() !== 'ELECTRICIDAD') return false;
  if (!String(slotCodeUpper || '').endsWith('_SWITCHES')) return false;
  const sigPart = [
    ...(Array.isArray(signals) ? signals : []).map((x) => String(x || '')),
    ...(Array.isArray(details) ? details : []).map((d) => String(d?.signal || ''))
  ].join(' ');
  const blob = `${description || ''} ${kpiAnalysis || ''} ${sigPart}`.toLowerCase();
  const avOrCoaxOrOutletContext =
    /\b(coaxial|coax\b|antena|audio\s*[-\s]?video|audio.?video|tipo\s+f\b|conector\s+f\b|salida\s+de\s+tv|televisi[oó]n|\brf\b|rosca\s+central|conector(?:es)?\s+roscad|mecanismo\s+roscad|placa\s+ciega|tapa\s+ciega|blank\s+plate|enchufe\s+tipo\s+l|toma\s+de\s+corriente|tomacorriente|orificios\s+circulares|3\s+orificios)\b/i.test(blob);
  const claimsMissingSwitchCovers =
    /\b(interruptor(?:es)?\s+sin\s+tapa|sin\s+tapa[s]?|mecanismos?\s+expuest|switch(?:es)?\s+sin|falta\s+de\s+tapa|tapas?\s+faltante|sin\s+cubiertas?)\b/i.test(blob);
  const onlyMisidentifiedSwitchDefect =
    claimsMissingSwitchCovers &&
    !/\b(apagador|llave\s+de\s+luz|bot[oó]n\s+de\s+luz|interruptor\s+de\s+luz)\b/i.test(blob) &&
    /\b(placa(?:s)?|salida|conector|enchufe|coaxial|antena|tomacorriente)\b/i.test(blob);
  const hasRealElectricDefect =
    /\b(cable[s]?\s+expuest|conductor(?:es)?\s+expuest|quemadur|derretim|tapa[s]?\s+[^.]{0,30}(quebr|partid|rot[oa]|colg)|fijaci[oó]n\s+deficiente|separaci[oó]n\s+del\s+muro|chisp|arco\b|sobrecalent|apagador\s+sin\s+placa)\b/i.test(blob);
  return (avOrCoaxOrOutletContext || onlyMisidentifiedSwitchDefect) && claimsMissingSwitchCovers && !hasRealElectricDefect;
}

export function scrubWallSwitchAvFalsePositiveNarrative(description, kpiAnalysis) {
  const scrub = (t) => {
    let s = String(t || '');
    s = s.replace(/\b(?:una\s+de\s+las\s+)?placas?\s+tiene\s+interruptores?\s+sin\s+tapa[s]?[^.!?]*[.!?]?/gi, '');
    s = s.replace(/\binterruptores?\s+sin\s+tapa[s]?[^.!?]*[.!?]?/gi, '');
    s = s.replace(/\bmecanismos?\s+expuestos?[^.!?]*[.!?]?/gi, '');
    s = s.replace(/\bdejando\s+los\s+mecanismos?\s+expuestos?[^.!?]*[.!?]?/gi, '');
    s = s.replace(/\bsin\s+tapa[s]?\s*,?\s*dejando[^.!?]*[.!?]?/gi, '');
    return s.replace(/\s{2,}/g, ' ').replace(/\.\s+\./g, '.').replace(/,\s*\./g, '.').trim();
  };
  return { description: scrub(description), kpiAnalysis: scrub(kpiAnalysis) };
}
