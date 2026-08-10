/**
 * Hallazgos típicos — instalaciones sanitarias (base Paulo / postventa).
 * Fuente: Hallazgos tipicos Inst. Sanitarias.docx
 */

/** @typedef {'photo' | 'video' | 'either'} MediaType */

/**
 * @typedef {object} SanitaryFinding
 * @property {string} code
 * @property {string} label
 * @property {string} visibleHint
 * @property {string} simpleExplanation
 * @property {'baja' | 'media' | 'alta'} urgency
 * @property {string[]} keywords
 */

export const SANITARY_FINDINGS = {
  filtracion: {
    code: 'filtracion',
    label: 'Filtración de agua',
    visibleHint: 'Humedad, goteo o mancha bajo lavaplatos, lavamanos o conexiones.',
    simpleExplanation: 'Fuga en unión, sifón, flexible o sellos.',
    urgency: 'media',
    keywords: [
      'filtr', 'goteo', 'gotea', 'humedad', 'fuga', 'moja', 'gote', 'sifon', 'sifón',
      'flexible', 'lavaplatos', 'bajo el lavaplatos', 'cañer', 'cañería', 'tuber'
    ]
  },
  baja_presion: {
    code: 'baja_presion',
    label: 'Baja presión de agua',
    visibleHint: 'Agua sale con poca fuerza en ducha o grifería.',
    simpleExplanation: 'Presión deficiente; puede ser aireador, sarro o red.',
    urgency: 'media',
    keywords: ['presión', 'presion', 'poca fuerza', 'poco agua', 'sale débil', 'sale debil', 'gotea poco']
  },
  mal_olor: {
    code: 'mal_olor',
    label: 'Malos olores sanitarios',
    visibleHint: 'Olor a alcantarillado en baño o cocina.',
    simpleExplanation: 'Retorno de gases del desagüe (sifón seco, ventilación, sellos).',
    urgency: 'media',
    keywords: ['olor', 'peste', 'alcantarill', 'desagüe', 'desague', 'hedor', 'huele']
  },
  retorno_agua: {
    code: 'retorno_agua',
    label: 'Retorno de agua',
    visibleHint: 'Agua sube por ducha o rebalse al usar WC.',
    simpleExplanation: 'Evacuación deficiente; riesgo de rebalse.',
    urgency: 'alta',
    keywords: ['retorno', 'rebals', 'sube el agua', 'sube agua', 'inunda', 'desbord', 'cola']
  },
  wc_suelto: {
    code: 'wc_suelto',
    label: 'WC suelto',
    visibleHint: 'El inodoro se mueve al sentarse o empujarlo.',
    simpleExplanation: 'WC mal fijado; riesgo de filtración al piso.',
    urgency: 'media',
    keywords: [
      'wc suelto', 'inodoro suelto', 'water suelto', 'se mueve', 'mueve el wc',
      'mueve el inodoro', 'wc flojo', 'inodoro flojo', 'pernos', 'despegado'
    ]
  }
};

/** @param {string} text */
export function detectSanitaryFinding(text) {
  const t = String(text || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const finding of Object.values(SANITARY_FINDINGS)) {
    let score = 0;
    for (const kw of finding.keywords) {
      if (t.includes(kw.toLowerCase())) score += kw.length > 6 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = finding;
    }
  }
  if (best && bestScore >= 1) return best;
  return SANITARY_FINDINGS.filtracion;
}

/**
 * @typedef {object} CaptureSlotDef
 * @property {string} slotCode
 * @property {string} title
 * @property {string} instructions
 * @property {MediaType} [mediaType]
 * @property {boolean} [required]
 * @property {boolean} [optional]
 */

/** @param {string} findingCode @returns {CaptureSlotDef[]} */
export function slotsForSanitaryFinding(findingCode) {
  const code = findingCode || 'filtracion';

  if (code === 'wc_suelto') {
    return [
      {
        slotCode: 'san_wc_far',
        title: 'WC completo',
        instructions: 'Foto del inodoro completo desde lejos.',
        mediaType: 'photo',
        required: true
      },
      {
        slotCode: 'san_wc_base_detail',
        title: 'Base del WC',
        instructions: 'Primer plano de la base, pernos o unión con el piso.',
        mediaType: 'photo',
        required: true
      },
      {
        slotCode: 'san_wc_movement_video',
        title: 'Video — movimiento del WC',
        instructions:
          'Graba 5–10 segundos empujando suavemente el WC para mostrar el movimiento. Obligatorio para confirmar WC suelto.',
        mediaType: 'video',
        required: true
      },
      {
        slotCode: 'san_context',
        title: 'Baño completo',
        instructions: 'Foto del baño para contexto.',
        mediaType: 'photo',
        optional: true
      }
    ];
  }

  if (code === 'retorno_agua') {
    return [
      {
        slotCode: 'san_fixture_far',
        title: 'Ducha o WC',
        instructions: 'Foto del artefacto donde ocurre el retorno (ducha, WC o piso de ducha).',
        mediaType: 'photo',
        required: true
      },
      {
        slotCode: 'san_evidence_detail',
        title: 'Detalle del problema',
        instructions: 'Primer plano de la zona donde sube el agua o hay rebalse.',
        mediaType: 'photo',
        required: true
      },
      {
        slotCode: 'san_flush_video',
        title: 'Video — descarga del WC',
        instructions: 'Video corto (5–15 s) descargando el WC o abriendo la ducha para mostrar el retorno.',
        mediaType: 'video',
        required: true
      },
      {
        slotCode: 'san_context',
        title: 'Recinto completo',
        instructions: 'Foto del baño completo.',
        mediaType: 'photo',
        optional: true
      }
    ];
  }

  if (code === 'baja_presion') {
    return [
      {
        slotCode: 'san_fixture_far',
        title: 'Grifería o ducha',
        instructions: 'Foto de la ducha, lavamanos o lavaplatos afectado.',
        mediaType: 'photo',
        required: true
      },
      {
        slotCode: 'san_flow_video',
        title: 'Video — flujo de agua',
        instructions: 'Graba 5–10 s con el agua abierta para mostrar la presión baja.',
        mediaType: 'video',
        required: true
      },
      {
        slotCode: 'san_context',
        title: 'Recinto completo',
        instructions: 'Foto del baño o cocina.',
        mediaType: 'photo',
        optional: true
      }
    ];
  }

  if (code === 'mal_olor') {
    return [
      {
        slotCode: 'san_drain_far',
        title: 'Desagüe o sifón',
        instructions: 'Foto del sifón visible, rejilla o desagüe del baño/cocina.',
        mediaType: 'photo',
        required: true
      },
      {
        slotCode: 'san_drain_detail',
        title: 'Detalle del desagüe',
        instructions: 'Primer plano del sifón, sellos o unión al piso.',
        mediaType: 'photo',
        required: true
      },
      {
        slotCode: 'san_context',
        title: 'Recinto completo',
        instructions: 'Foto del baño o cocina.',
        mediaType: 'photo',
        optional: true
      }
    ];
  }

  // filtracion (default)
  return [
    {
      slotCode: 'san_fixture_far',
      title: 'Zona afectada (lejos)',
      instructions: 'Foto amplia del lavaplatos, lavamanos, ducha o zona con humedad/filtración.',
      mediaType: 'photo',
      required: true
    },
    {
      slotCode: 'san_leak_detail',
      title: 'Detalle de la filtración',
      instructions: 'Primer plano de la mancha, goteo o humedad.',
      mediaType: 'photo',
      required: true
    },
    {
      slotCode: 'san_under_connection',
      title: 'Conexión o sifón',
      instructions: 'Foto bajo el lavaplatos, sifón o unión visible si puedes acceder.',
      mediaType: 'photo',
      optional: true
    },
    {
      slotCode: 'san_context',
      title: 'Recinto completo',
      instructions: 'Foto del baño o cocina para contexto.',
      mediaType: 'photo',
      optional: true
    }
  ];
}

/** @param {string} findingCode */
export function buildSanitaryCapturePlan(summary, roomHint) {
  const text = [summary, roomHint].filter(Boolean).join(' ');
  const finding = detectSanitaryFinding(text);
  const slots = slotsForSanitaryFinding(finding.code);
  return {
    findingCode: finding.code,
    findingLabel: finding.label,
    urgency: finding.urgency,
    slots
  };
}

/** @param {string} slotCode */
export function getSanitarySlotMeta(slotCode) {
  const code = String(slotCode || '');
  if (code.endsWith('_video') || code.includes('movement_video') || code.includes('flush_video') || code.includes('flow_video')) {
    return { mediaType: 'video', required: true };
  }
  if (code === 'san_context' || code === 'san_under_connection') {
    return { mediaType: 'photo', optional: true };
  }
  return { mediaType: 'photo', required: true };
}
