/** Etiquetas humanas para categorías postventa (Chile). */
export const CATEGORY_LABELS = {
  humedad_filtracion: 'Humedad y filtración',
  pintura_muros_cielos: 'Pintura en muros y cielos',
  pisos: 'Pisos y revestimientos',
  puertas_cerraduras: 'Puertas y cerraduras',
  ventanas_sellos: 'Ventanas y sellos',
  sanitarios: 'Sanitarios y grifería',
  electricidad_visible: 'Electricidad visible',
  muebles_closets_cocina: 'Muebles fijos y cocina',
  ductos_canalizaciones: 'Ductos y canalizaciones',
  impermeabilizacion: 'Impermeabilización',
  espacios_comunes: 'Espacios comunes',
  otros: 'Otros'
};

/** @param {string} code */
export function categoryLabel(code) {
  return CATEGORY_LABELS[String(code || '').trim()] || code || 'Sin categoría';
}

export const WARRANTY_STATUS_LABELS = {
  garantia_vigente: 'Garantía vigente (prevalidación)',
  garantia_vencida: 'Plazo vencido (revisión humana)',
  requiere_revision_manual: 'Requiere revisión manual',
  no_aplica: 'No aplica prevalidación automática'
};

/** @param {string} status */
export function warrantyStatusLabel(status) {
  return WARRANTY_STATUS_LABELS[String(status || '').trim()] || status || 'Sin dato';
}
