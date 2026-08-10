import {
  addressMatches,
  comunaMatches,
  formatUnitLabel,
  normalizeAddress,
  normalizeComuna,
  normalizePhone,
  normalizeRut,
  normalizeTower,
  normalizeUnitNumber
} from '../normalize.js';
import { isPostventaDemoMaqueta, provisionDemoUnit } from '../demoMode.js';
import { getWarrantyStartDateForTier } from '../warranty/warrantyEngine.js';

/**
 * @param {object} unit
 * @param {object} tenant
 * @param {string} address
 * @param {string} comuna
 */
function buildLookupSuccess(unit, tenant, address, comuna) {
  const instalacionesStart = getWarrantyStartDateForTier(
    'instalaciones',
    unit.domReceptionDate,
    unit.cbrInscriptionDate
  );
  const terminacionesStart = getWarrantyStartDateForTier(
    'terminaciones',
    unit.domReceptionDate,
    unit.cbrInscriptionDate
  );

  return {
    ok: true,
    found: true,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    unitId: unit.id,
    ownerId: unit.ownerId || unit.owner?.id || null,
    projectId: unit.projectId,
    projectName: unit.project?.name || null,
    projectAddress: unit.project?.address || address,
    projectComuna: unit.project?.comuna || comuna,
    unitLabel: unit.label || formatUnitLabel(unit.tower, unit.unitNumber),
    ownerName: unit.owner?.fullName || null,
    domReceptionDate: unit.domReceptionDate?.toISOString?.()?.slice(0, 10) || null,
    cbrInscriptionDate: unit.cbrInscriptionDate?.toISOString?.()?.slice(0, 10) || null,
    warrantyStartInstalaciones: instalacionesStart.start
      ? instalacionesStart.start.toISOString().slice(0, 10)
      : null,
    warrantyStartTerminaciones: terminacionesStart.start
      ? terminacionesStart.start.toISOString().slice(0, 10)
      : null,
    ...(isPostventaDemoMaqueta() ? { demoMaqueta: true } : {})
  };
}

/**
 * Normaliza aliases que el LLM o ElevenLabs pueden enviar mal (Tower, OwnerRut, etc.).
 * @param {Record<string, unknown>} body
 */
function normalizeLookupBody(body) {
  const b = { ...(body || {}) };
  if (b.Tower != null && b.tower == null) b.tower = b.Tower;
  if (b.OwnerRut != null && b.ownerRut == null) b.ownerRut = b.OwnerRut;
  if (b.Depto != null && b.unitNumber == null) b.depto = b.Depto;
  if (b.Direccion != null && b.address == null) b.direccion = b.Direccion;
  if (b.Comuna != null && b.comuna == null) b.comuna = b.Comuna;
  if (b.ownerRut != null && typeof b.ownerRut !== 'string') {
    b.ownerRut = String(b.ownerRut);
  }
  return b;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Record<string, unknown>} body
 */
export async function lookupOwnerUnit(prisma, body) {
  const input = normalizeLookupBody(body);
  const addressRaw = input.address ?? input.direccion ?? input.propertyAddress ?? '';
  const comunaRaw = input.comuna ?? input.commune ?? '';
  const address = String(addressRaw || '').trim();
  const comuna = String(comunaRaw || '').trim();
  const unitNumber = normalizeUnitNumber(input.unitNumber ?? input.depto ?? input.unit);
  const towerRaw = input.tower ?? input.torre ?? input.towerName ?? '';
  const tower = normalizeTower(towerRaw);
  const ownerRut = input.ownerRut || input.rut ? normalizeRut(input.ownerRut || input.rut) : null;
  const ownerPhone = input.ownerPhone || input.phone ? normalizePhone(input.ownerPhone || input.phone) : null;
  const tenantSlugHint = String(input.tenantSlug || input.tenant || '').trim();

  if (!address) {
    return {
      ok: false,
      status: 400,
      error: 'MISSING_FIELDS',
      message: 'address (dirección del edificio) es obligatorio.'
    };
  }

  if (!comuna) {
    return {
      ok: false,
      status: 400,
      error: 'MISSING_FIELDS',
      message: 'comuna es obligatoria.'
    };
  }

  if (!unitNumber) {
    return {
      ok: false,
      status: 400,
      error: 'MISSING_FIELDS',
      message: 'unitNumber es obligatorio (número de departamento, ej. 402).'
    };
  }

  /** RUT opcional: si no viene, se valida solo por dirección + depto (+ torre). */

  /** @type {import('@prisma/client').Prisma.PvProjectWhereInput} */
  const projectWhere = {
    ...(tenantSlugHint
      ? { tenant: { slug: tenantSlugHint, status: 'ACTIVE' } }
      : { tenant: { status: 'ACTIVE' } })
  };

  const allProjects = await prisma.pvProject.findMany({
    where: projectWhere,
    include: { tenant: { select: { id: true, slug: true, name: true } } }
  });

  const projects = allProjects.filter(
    (p) => comunaMatches(p.comuna, comuna) && addressMatches(p.address, address)
  );

  if (!projects.length) {
    if (isPostventaDemoMaqueta()) {
      const demo = await provisionDemoUnit(prisma, {
        address,
        comuna,
        unitNumber,
        tower,
        tenantSlugHint
      });
      return buildLookupSuccess(
        { ...demo.unit, project: demo.project, owner: null },
        demo.tenant,
        address,
        comuna
      );
    }
    return {
      ok: true,
      found: false,
      message: `No encontré un proyecto en ${comuna} con dirección similar a "${address}". Verifica calle, número y comuna.`
    };
  }

  const projectIds = projects.map((p) => p.id);

  /** @type {import('@prisma/client').Prisma.PvUnitInclude} */
  const include = {
    owner: true,
    project: { include: { tenant: { select: { id: true, slug: true, name: true } } } }
  };

  let units = await prisma.pvUnit.findMany({
    where: {
      projectId: { in: projectIds },
      unitNumber,
      ...(tower ? { tower } : {})
    },
    include
  });

  if (!units.length && !tower) {
    units = await prisma.pvUnit.findMany({
      where: { projectId: { in: projectIds }, unitNumber },
      include
    });
  }

  if (!units.length && tower) {
    const byNumber = await prisma.pvUnit.findMany({
      where: { projectId: { in: projectIds }, unitNumber },
      include
    });
    if (byNumber.length === 1) units = byNumber;
  }

  if (!units.length) {
    if (isPostventaDemoMaqueta()) {
      const demo = await provisionDemoUnit(prisma, {
        address,
        comuna,
        unitNumber,
        tower,
        tenantSlugHint: tenantSlugHint || projects[0]?.tenant?.slug || ''
      });
      return buildLookupSuccess(
        { ...demo.unit, project: demo.project, owner: null },
        demo.tenant,
        address,
        comuna
      );
    }
    const projectNames = projects.map((p) => p.name).join(', ');
    return {
      ok: true,
      found: false,
      message: `Proyecto encontrado (${projectNames}) pero no hay depto ${unitNumber}${tower ? ` torre ${tower}` : ''}. Verifica torre y número.`
    };
  }

  let unit = units[0];

  if (units.length > 1 && (ownerRut || ownerPhone)) {
    const matched = units.find((u) => {
      if (!u.owner) return false;
      if (ownerRut && u.owner.rut && normalizeRut(u.owner.rut) === ownerRut) return true;
      if (ownerPhone && u.owner.phone && normalizePhone(u.owner.phone) === ownerPhone) return true;
      return false;
    });
    if (matched) unit = matched;
  } else if (units.length > 1 && ownerRut) {
    const byRut = units.find(
      (u) => u.owner?.rut && normalizeRut(u.owner.rut) === ownerRut
    );
    if (byRut) unit = byRut;
  }

  const tenant = unit.project.tenant;

  if (!isPostventaDemoMaqueta() && unit.owner?.rut && ownerRut) {
    const storedRut = normalizeRut(unit.owner.rut);
    if (storedRut !== ownerRut) {
      return {
        ok: true,
        found: false,
        error: 'OWNER_RUT_MISMATCH',
        message:
          'Encontré la unidad en la dirección indicada, pero el RUT no coincide con el propietario registrado. Verifica número de departamento.'
      };
    }
  }

  return buildLookupSuccess(unit, tenant, address, comuna);
}
