/** Guía hablada corta por slot (para prompt del agente y pantalla de captura). */
export const SLOT_SPOKEN_HINTS = {
  wall_overview: 'Primero, una foto **desde lejos** del muro afectado: abre la cámara, encuadra todo el muro, captura y cierra.',
  stain_close: 'Ahora una foto **de cerca** de la mancha o humedad: abre la cámara, acércate al detalle, captura y cierra.',
  floor_base: 'Siguiente, la unión **muro y piso** o zócalo: abre la cámara, captura y cierra.',
  context: 'Una foto del **recinto completo** — baño, cocina o dormitorio — para contexto: captura y cierra.',
  active_leak: 'Si hay goteo activo, una foto o video corto; si no aplica, puedes omitir esta.',
  operation_video: 'Video corto abriendo y cerrando la puerta; si no aplica, puedes omitir esta.',
  door_overview: 'Foto **de lejos** de la puerta completa, cerrada: captura y cierra.',
  lock_detail: 'Foto **de cerca** de la cerradura o manilla: captura y cierra.',
  frame_gap: 'Detalle del **marco o bisagra**: captura y cierra.',
  overview: 'Foto **desde lejos** del área afectada: captura y cierra.',
  detail_1: 'Foto **de cerca** del daño: captura y cierra.',
  detail_2: 'Otro **ángulo** del mismo problema: captura y cierra.',
  paint_wall_far: 'Foto **desde lejos** del muro con el daño de pintura: encuadra el muro, captura y cierra.',
  paint_damage_close: 'Foto **de cerca** de la mancha, descascarado o pintura dañada: captura y cierra.',
  paint_context: 'Foto del **recinto completo** (living, dormitorio, etc.) para contexto: captura y cierra.',
  san_fixture_far: 'Foto **desde lejos** del lavaplatos, ducha, WC o zona afectada: captura y cierra.',
  san_leak_detail: 'Foto **de cerca** de la mancha, goteo o humedad: captura y cierra.',
  san_under_connection: 'Foto bajo el lavaplatos o del sifón si puedes acceder; si no, puedes omitir.',
  san_wc_far: 'Foto del **inodoro completo** desde lejos: captura y cierra.',
  san_wc_base_detail: 'Foto **de cerca** de la base del WC o pernos: captura y cierra.',
  san_wc_movement_video:
    '**Video obligatorio:** graba 5–10 segundos **empujando suavemente el WC** para mostrar el movimiento.',
  san_drain_far: 'Foto del **desagüe o sifón** visible: captura y cierra.',
  san_drain_detail: 'Primer plano del sifón o sellos: captura y cierra.',
  san_evidence_detail: 'Foto **de cerca** donde sube el agua o hay rebalse: captura y cierra.',
  san_flush_video: '**Video obligatorio:** graba descargando el WC o abriendo la ducha para mostrar el retorno.',
  san_flow_video: '**Video obligatorio:** graba 5–10 s con el agua abierta para mostrar la presión baja.',
  san_context: 'Foto del **baño o cocina completo** para contexto; puedes omitir si ya enviaste suficiente.'
};

/**
 * @param {string} category
 * @returns {Array<{ step: number, title: string, instructions: string, spoken: string }>}
 */
export function getCaptureGuideForCategory(category) {
  const slots = getSlotsForCategory(category);
  return slots.map((slot, index) => ({
    step: index + 1,
    title: slot.title,
    instructions: slot.instructions,
    spoken:
      SLOT_SPOKEN_HINTS[slot.slotCode] ||
      `Foto ${index + 1}: ${slot.instructions} Abre la cámara, captura y cierra.`
  }));
}

/** @param {string} category */
export function formatSpokenCaptureScript(category) {
  const guide = getCaptureGuideForCategory(category);
  const lines = guide.map(
    (g) => `Paso ${g.step} — ${g.title}: ${g.spoken.replace(/\*\*/g, '')}`
  );
  return lines.join('\n');
}

const DEFAULT_SLOTS = [
  {
    slotCode: 'overview',
    title: 'Vista general',
    instructions: 'Foto amplia del área afectada desde lejos.'
  },
  {
    slotCode: 'detail_1',
    title: 'Detalle del daño',
    instructions: 'Primer plano del problema reportado.'
  },
  {
    slotCode: 'detail_2',
    title: 'Segundo ángulo',
    instructions: 'Otra perspectiva del mismo daño.'
  }
];

const CATEGORY_SLOTS = {
  pintura_muros_cielos: [
    {
      slotCode: 'paint_wall_far',
      title: 'Muro afectado (lejos)',
      instructions: 'Vista general del muro con daño de pintura, descascarado o mancha.'
    },
    {
      slotCode: 'paint_damage_close',
      title: 'Daño de cerca',
      instructions: 'Primer plano de la mancha o pintura dañada en el muro.'
    },
    {
      slotCode: 'paint_context',
      title: 'Recinto completo',
      instructions: 'Foto del living, dormitorio o recinto para contexto.'
    }
  ],
  pisos: [
    {
      slotCode: 'overview',
      title: 'Piso afectado (lejos)',
      instructions: 'Vista general del piso o zona dañada desde lejos.'
    },
    {
      slotCode: 'detail_1',
      title: 'Daño de cerca',
      instructions: 'Primer plano de baldosa levantada, grieta o daño en el piso.'
    },
    {
      slotCode: 'detail_2',
      title: 'Segundo ángulo',
      instructions: 'Otra perspectiva del mismo daño en el piso.'
    }
  ],
  humedad_filtracion: [
    {
      slotCode: 'wall_overview',
      title: 'Muro afectado',
      instructions: 'Vista general del muro con humedad o filtración.'
    },
    {
      slotCode: 'stain_close',
      title: 'Mancha de cerca',
      instructions: 'Primer plano de la mancha, burbujeo o decoloración.'
    },
    {
      slotCode: 'floor_base',
      title: 'Zócalo o piso',
      instructions: 'Unión muro-piso o zócalo si aplica.'
    },
    {
      slotCode: 'context',
      title: 'Recinto completo',
      instructions: 'Foto del baño, cocina o dormitorio para contexto.'
    },
    {
      slotCode: 'active_leak',
      title: 'Goteo activo (opcional)',
      instructions: 'Video o foto si hay goteo o humedad fresca visible.'
    }
  ],
  puertas_cerraduras: [
    {
      slotCode: 'door_overview',
      title: 'Puerta completa',
      instructions: 'Foto de la puerta cerrada, vista frontal.'
    },
    {
      slotCode: 'lock_detail',
      title: 'Cerradura o manilla',
      instructions: 'Detalle del mecanismo dañado o desalineado.'
    },
    {
      slotCode: 'frame_gap',
      title: 'Marco o bisagra',
      instructions: 'Marco, bisagras o espacio entre puerta y marco.'
    },
    {
      slotCode: 'operation_video',
      title: 'Funcionamiento (opcional)',
      instructions: 'Video corto abriendo/cerrando la puerta.'
    }
  ]
};

/** @param {string} category */
export function getSlotsForCategory(category) {
  const key = String(category || '').trim();
  return CATEGORY_SLOTS[key] || DEFAULT_SLOTS;
}

export const VALID_CATEGORIES = new Set([
  'humedad_filtracion',
  'pintura_muros_cielos',
  'pisos',
  'puertas_cerraduras',
  'ventanas_sellos',
  'sanitarios',
  'electricidad_visible',
  'muebles_closets_cocina',
  'ductos_canalizaciones',
  'impermeabilizacion',
  'espacios_comunes',
  'otros'
]);
