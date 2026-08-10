import { VALID_CATEGORIES } from '../capture/slotTemplates.js';
import { isPostventaDemoMaqueta } from '../demoMode.js';
import {
  addYears,
  categoryToWarrantyTier,
  getWarrantyStartDateForTier,
  validateWarranty as runWarrantyEngine,
  WARRANTY_YEARS
} from '../warranty/warrantyEngine.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Record<string, unknown>} body
 */
export async function validatePostventaWarranty(prisma, body) {
  const unitId = String(body.unitId || '').trim();
  const preliminaryCategory = String(body.preliminaryCategory || body.category || '').trim();

  if (!unitId || !preliminaryCategory) {
    return {
      ok: false,
      status: 400,
      error: 'MISSING_FIELDS',
      message: 'unitId y preliminaryCategory son obligatorios.'
    };
  }

  if (!VALID_CATEGORIES.has(preliminaryCategory)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_CATEGORY',
      message: `Categoría no válida: ${preliminaryCategory}`
    };
  }

  const unit = await prisma.pvUnit.findUnique({
    where: { id: unitId },
    select: {
      id: true,
      domReceptionDate: true,
      cbrInscriptionDate: true,
      label: true,
      project: { select: { name: true } }
    }
  });

  if (!unit) {
    return {
      ok: false,
      status: 404,
      error: 'UNIT_NOT_FOUND',
      message: 'Unidad no encontrada.'
    };
  }

  if (isPostventaDemoMaqueta()) {
    const { tier, ambiguous } = categoryToWarrantyTier(preliminaryCategory);
    const effectiveTier = tier === 'desconocido' ? 'instalaciones' : tier;
    const dom = unit.domReceptionDate || new Date('2024-03-15');
    const cbr = unit.cbrInscriptionDate || new Date('2024-04-20');
    const { start, startSource } = getWarrantyStartDateForTier(effectiveTier, dom, cbr);
    const warrantyYears = WARRANTY_YEARS[effectiveTier];
    const expiresAt = start ? addYears(start, warrantyYears) : addYears(new Date(), warrantyYears);

    return {
      ok: true,
      status: 'garantia_vigente',
      preliminaryCategory,
      tier: effectiveTier,
      ambiguous,
      warrantyYears,
      warrantyExpiresAt: expiresAt.toISOString().slice(0, 10),
      daysRemaining: Math.max(1, Math.ceil((expiresAt - new Date()) / (86400000))),
      warrantyStartDate: start ? start.toISOString().slice(0, 10) : null,
      warrantyStartSource: startSource,
      messageForOwner:
        'Según las fechas registradas, tu reclamo podría estar dentro del plazo de garantía vigente. El equipo confirmará al revisar las fotos y el detalle del caso.',
      disclaimer:
        'Prevalidación operativa (maqueta demo). No constituye dictamen legal ni resolución definitiva.',
      demoMaqueta: true,
      unitId: unit.id,
      unitLabel: unit.label,
      projectName: unit.project?.name || null
    };
  }

  const result = runWarrantyEngine({
    domReceptionDate: unit.domReceptionDate,
    cbrInscriptionDate: unit.cbrInscriptionDate,
    preliminaryCategory
  });

  return {
    ...result,
    unitId: unit.id,
    unitLabel: unit.label,
    projectName: unit.project?.name || null
  };
}
