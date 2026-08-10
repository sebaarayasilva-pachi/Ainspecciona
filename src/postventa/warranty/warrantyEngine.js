/**
 * Prevalidación de garantía postventa inmobiliaria (Chile).
 * Base legal: Art. 18 LGUC (mod. Ley 20.016).
 *
 * Plazos:
 * - 10 años: estructura soportante → desde recepción definitiva DOM
 * - 5 años: elementos constructivos e instalaciones → desde recepción definitiva DOM
 * - 3 años: terminaciones y acabados → desde inscripción CBR a nombre del comprador
 * - 5 años: fallas no asimilables → desde recepción definitiva DOM
 */

/** @typedef {'estructura' | 'instalaciones' | 'terminaciones' | 'no_asimilable' | 'desconocido'} WarrantyTier */

export const WARRANTY_YEARS = {
  estructura: 10,
  instalaciones: 5,
  terminaciones: 3,
  no_asimilable: 5
};

const INSTALACIONES_CATEGORIES = new Set([
  'humedad_filtracion',
  'sanitarios',
  'electricidad_visible',
  'ductos_canalizaciones',
  'impermeabilizacion'
]);

const TERMINACIONES_CATEGORIES = new Set([
  'pintura_muros_cielos',
  'pisos',
  'puertas_cerraduras',
  'ventanas_sellos',
  'muebles_closets_cocina'
]);

/** Categorías donde el tier legal puede variar según causa (revisión humana recomendada). */
const AMBIGUOUS_CATEGORIES = new Set(['humedad_filtracion', 'espacios_comunes']);

/**
 * @param {string} category
 * @returns {{ tier: WarrantyTier, ambiguous: boolean }}
 */
export function categoryToWarrantyTier(category) {
  const c = String(category || '').trim();
  if (INSTALACIONES_CATEGORIES.has(c)) {
    return { tier: 'instalaciones', ambiguous: AMBIGUOUS_CATEGORIES.has(c) };
  }
  if (TERMINACIONES_CATEGORIES.has(c)) {
    return { tier: 'terminaciones', ambiguous: false };
  }
  if (c === 'otros') {
    return { tier: 'no_asimilable', ambiguous: true };
  }
  if (c === 'espacios_comunes') {
    return { tier: 'desconocido', ambiguous: true };
  }
  return { tier: 'desconocido', ambiguous: false };
}

/**
 * @param {Date | string | null | undefined} value
 * @returns {Date | null}
 */
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Fecha de inicio del plazo según Art. 18 LGUC (por tier, no una sola fecha global).
 *
 * @param {WarrantyTier} tier
 * @param {Date | string | null | undefined} domReceptionDate
 * @param {Date | string | null | undefined} cbrInscriptionDate
 * @returns {{ start: Date | null, startSource: 'dom' | 'cbr' | null }}
 */
export function getWarrantyStartDateForTier(tier, domReceptionDate, cbrInscriptionDate) {
  const dom = parseDate(domReceptionDate);
  const cbr = parseDate(cbrInscriptionDate);

  if (tier === 'terminaciones') {
    return { start: cbr, startSource: cbr ? 'cbr' : null };
  }
  if (tier === 'estructura' || tier === 'instalaciones' || tier === 'no_asimilable') {
    return { start: dom, startSource: dom ? 'dom' : null };
  }
  return { start: null, startSource: null };
}

/** @deprecated Usar getWarrantyStartDateForTier por tier. Mantener solo por compatibilidad. */
export function computeWarrantyStartDate(domReceptionDate, cbrInscriptionDate) {
  return getWarrantyStartDateForTier('instalaciones', domReceptionDate, cbrInscriptionDate).start;
}

/**
 * @param {Date} start
 * @param {number} years
 * @returns {Date}
 */
export function addYears(start, years) {
  const d = new Date(start);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

/**
 * @param {Date} a
 * @param {Date} b
 * @returns {number}
 */
function diffDays(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function formatDateIso(d) {
  return d.toISOString().slice(0, 10);
}

const LEGAL_NOTE =
  'Art. 18 LGUC: estructura e instalaciones (10 y 5 años) cuentan desde recepción definitiva DOM; terminaciones (3 años) desde inscripción CBR a nombre del comprador.';

const SERNAC_NOTE =
  'Orientación SERNAC: los plazos se vinculan a la recepción definitiva DOM y/o la inscripción en el Conservador de Bienes Raíces, según el tipo de falla.';

const DISCLAIMER =
  'Prevalidación operativa basada en fechas registradas. No constituye dictamen legal ni resolución definitiva.';

const TIER_LABELS = {
  estructura: 'estructura soportante (10 años, desde recepción DOM)',
  instalaciones: 'instalaciones (5 años, desde recepción DOM)',
  terminaciones: 'terminaciones y acabados (3 años, desde inscripción CBR)',
  no_asimilable: 'elementos no asimilables (5 años, desde recepción DOM)'
};

/**
 * @param {WarrantyTier} tier
 * @returns {string}
 */
function requiredDateLabel(tier) {
  if (tier === 'terminaciones') return 'inscripción en el Conservador de Bienes Raíces';
  if (tier === 'estructura' || tier === 'instalaciones' || tier === 'no_asimilable') {
    return 'recepción definitiva de la Dirección de Obras Municipales';
  }
  return 'fechas de recepción o inscripción';
}

/**
 * @param {{
 *   domReceptionDate?: Date | string | null,
 *   cbrInscriptionDate?: Date | string | null,
 *   preliminaryCategory: string,
 *   referenceDate?: Date,
 * }} input
 */
export function validateWarranty(input) {
  const category = String(input.preliminaryCategory || '').trim();
  const { tier, ambiguous } = categoryToWarrantyTier(category);
  const now = input.referenceDate ? new Date(input.referenceDate) : new Date();
  const dom = parseDate(input.domReceptionDate);
  const cbr = parseDate(input.cbrInscriptionDate);
  const { start, startSource } = getWarrantyStartDateForTier(tier, dom, cbr);

  const base = {
    ok: true,
    preliminaryCategory: category,
    tier,
    ambiguous,
    legalNote: LEGAL_NOTE,
    sernacNote: SERNAC_NOTE,
    disclaimer: DISCLAIMER,
    domReceptionDate: dom ? formatDateIso(dom) : null,
    cbrInscriptionDate: cbr ? formatDateIso(cbr) : null,
    warrantyStartDate: start ? formatDateIso(start) : null,
    warrantyStartSource: startSource
  };

  if (tier === 'desconocido') {
    return {
      ...base,
      status: 'requiere_revision_manual',
      warrantyYears: null,
      warrantyExpiresAt: null,
      daysRemaining: null,
      messageForOwner:
        'Tu solicitud requiere revisión del equipo de postventa para determinar el plazo y tipo de garantía aplicable.',
      messageInternal: 'Categoría sin mapeo claro a plazo LGUC (ej. espacios comunes).'
    };
  }

  if (!start) {
    return {
      ...base,
      status: 'requiere_revision_manual',
      warrantyYears: WARRANTY_YEARS[tier],
      warrantyExpiresAt: null,
      daysRemaining: null,
      messageForOwner: `No tenemos registrada la ${requiredDateLabel(tier)}. Un ejecutivo revisará tu caso y confirmará el plazo de garantía.`,
      messageInternal: `Falta fecha requerida para tier ${tier}: ${startSource || requiredDateLabel(tier)}.`
    };
  }

  const warrantyYears = WARRANTY_YEARS[tier];
  const expiresAt = addYears(start, warrantyYears);
  const daysRemaining = diffDays(now, expiresAt);
  const vigente = now.getTime() <= expiresAt.getTime();
  const tierLabel = TIER_LABELS[tier] || tier;

  let messageForOwner = vigente
    ? `Según las fechas registradas, tu reclamo podría estar dentro del plazo de garantía de ${tierLabel}. El equipo confirmará al revisar las fotos y el detalle del caso.`
    : `Según las fechas registradas, el plazo de garantía de ${tierLabel} habría finalizado el ${formatDateIso(expiresAt)}. Igual registraremos tu solicitud para revisión del equipo de postventa; no implica rechazo automático.`;

  if (ambiguous) {
    messageForOwner +=
      ' La clasificación exacta puede depender de la causa del daño (instalaciones, terminaciones o estructura); un perito o el equipo de postventa lo confirmará.';
  }

  let status = vigente ? 'garantia_vigente' : 'garantia_vencida';
  if (ambiguous && vigente) {
    status = 'requiere_revision_manual';
  }

  return {
    ...base,
    status,
    warrantyYears,
    warrantyExpiresAt: formatDateIso(expiresAt),
    daysRemaining: vigente ? daysRemaining : 0,
    messageForOwner,
    messageInternal: vigente
      ? `Garantía ${tier} vigente hasta ${formatDateIso(expiresAt)} (inicio ${startSource}).`
      : `Garantía ${tier} vencida desde ${formatDateIso(expiresAt)} (inicio ${startSource}).`
  };
}
