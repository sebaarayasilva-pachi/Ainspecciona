const STATUS_LABELS = {
  draft: 'Borrador',
  pending_evidence: 'Pendiente de fotos',
  evidence_received: 'Fotos recibidas',
  pending_ai_analysis: 'En análisis',
  classified: 'Clasificado',
  recibido: 'Recibida',
  asignada: 'Asignada',
  programado: 'Programada',
  en_ejecucion: 'En ejecución',
  terminado: 'Terminada',
  routed: 'Derivado',
  in_review: 'En revisión',
  closed: 'Cerrado',
  rejected: 'Rechazado'
};

const NEXT_STEP = {
  draft: 'Completa la validación y genera el link de captura.',
  pending_evidence: 'Completa las fotos en el link enviado.',
  evidence_received: 'El equipo está procesando las fotos enviadas.',
  pending_ai_analysis: 'Estamos generando el informe técnico preliminar con IA.',
  classified: 'Tu solicitud fue analizada y será gestionada por postventa.',
  recibido: 'Tu solicitud fue recibida por postventa.',
  asignada: 'Tu solicitud fue asignada a un inspector de la obra.',
  programado: 'La visita o reparación ya fue programada.',
  en_ejecucion: 'Los trabajos de postventa están en ejecución.',
  terminado: 'Tu solicitud fue terminada.',
  routed: 'Tu solicitud fue derivada al área correspondiente.',
  in_review: 'Un ejecutivo está revisando tu caso.',
  closed: 'Tu solicitud fue cerrada.',
  rejected: 'Consulta con postventa para más detalle.'
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function nextStepForOwner(status) {
  return NEXT_STEP[status] || 'Te contactaremos con novedades.';
}
