/**
 * Una sola foto por sesión de captura postventa.
 * El texto en pantalla usa el término chileno concreto (ej. guardapolvo).
 */

const CATEGORY_NOUN = {
  humedad_filtracion: 'humedad',
  pintura_muros_cielos: 'daño en muro o pintura',
  pisos: 'daño en el piso',
  puertas_cerraduras: 'puerta o cerradura',
  ventanas_sellos: 'ventana o sello',
  sanitarios: 'instalación sanitaria',
  electricidad_visible: 'enchufe o interruptor',
  muebles_closets_cocina: 'mueble o cubierta',
  ductos_canalizaciones: 'ducto o canalización',
  impermeabilizacion: 'filtración en cubierta',
  espacios_comunes: 'área común',
  otros: 'problema reportado'
};

/** @param {string} raw */
function norm(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * @param {{ summary?: string, roomHint?: string, category?: string }}
 * @returns {{ noun: string, phrase: string }}
 */
export function resolveCaptureSubject({ summary = '', roomHint = '', category = '' }) {
  const text = norm(`${summary} ${roomHint}`);

  const rules = [
    [/guardapolvo/, 'guardapolvo'],
    [/moldura/, 'moldura'],
    [/marco de puerta|marco de ventana|\bmarco\b/, 'marco'],
    [/zocalo|zócalo/, 'zócalo'],
    [/filtracion|filtración|\bgoteo\b|\bhumedad\b|\bmoho\b/, 'humedad'],
    [/mancha/, 'mancha'],
    [/lavaplatos|fregadero/, 'lavaplatos'],
    [/lavamanos/, 'lavamanos'],
    [/\bwc\b|inodoro|water\s*closet/, 'WC'],
    [/ducha|griferia|grifería/, 'grifería'],
    [/cerradura|manilla/, 'cerradura'],
    [/\bpuerta\b/, 'puerta'],
    [/ventana|persiana/, 'ventana'],
    [/enchufe|interruptor|luz que no/, 'enchufe o interruptor'],
    [/baldosa|ceramica|cerámica|piso levantado/, 'piso'],
    [/pintura descascar|descascarada/, 'pintura dañada'],
    [/cielo|rasa\b/, 'cielo raso'],
    [/\bmuro\b|\bpared\b/, 'muro']
  ];

  for (const [re, noun] of rules) {
    if (re.test(text)) {
      return { noun, phrase: `del ${noun}` };
    }
  }

  if (/\bpalito\b/.test(text)) {
    return { noun: 'guardapolvo', phrase: 'del guardapolvo' };
  }

  const fallback = CATEGORY_NOUN[String(category || '').trim()] || CATEGORY_NOUN.otros;
  return { noun: fallback, phrase: `del ${fallback}` };
}

/**
 * @param {{ summary?: string, roomHint?: string, category?: string }}
 */
export function buildSingleCaptureSlot({ summary = '', roomHint = '', category = '' }) {
  const { noun, phrase } = resolveCaptureSubject({ summary, roomHint, category });
  const room = String(roomHint || '').trim();
  const where = room ? ` en el ${room}` : '';
  const title = noun;
  const instructions = `Toma una foto clara ${phrase}${where}. Encuadra bien el daño.`;
  const spoken = `Necesito una sola foto ${phrase}${where}. Encuadra el daño, captura y súbela.`;

  return {
    slotCode: 'single_evidence',
    title,
    instructions,
    spoken,
    captureLabel: noun
  };
}

/**
 * @param {{ summary?: string, roomHint?: string, category?: string }}
 */
export function buildSingleCaptureGuide({ summary = '', roomHint = '', category = '' }) {
  const slot = buildSingleCaptureSlot({ summary, roomHint, category });
  return [
    {
      step: 1,
      title: slot.title,
      instructions: slot.instructions,
      spoken: slot.spoken,
      captureLabel: slot.captureLabel
    }
  ];
}
