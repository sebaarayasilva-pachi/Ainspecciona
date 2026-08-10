import {
  formatUnitLabel,
  normalizeAddress,
  normalizeComuna
} from './normalize.js';

const DEMO_WARRANTY = {
  domReceptionDate: new Date('2024-03-15'),
  cbrInscriptionDate: new Date('2024-04-20')
};

/** Maqueta demo: aceptar cualquier dirección y prevalidar garantía OK. Desactivar con POSTVENTA_DEMO_ACCEPT_ANY_ADDRESS=0 */
export function isPostventaDemoMaqueta() {
  const v = String(process.env.POSTVENTA_DEMO_ACCEPT_ANY_ADDRESS ?? '1')
    .trim()
    .toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function slugifyPart(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function demoProjectSlug(address, comuna) {
  const a = slugifyPart(address) || 'direccion';
  const c = slugifyPart(comuna) || 'comuna';
  return `mq-${a}-${c}`.slice(0, 80);
}

async function getOrCreateDemoOwner(prisma, tenantId) {
  let owner = await prisma.pvOwner.findFirst({
    where: { tenantId, fullName: 'Propietario Maqueta' }
  });
  if (!owner) {
    owner = await prisma.pvOwner.create({
      data: { tenantId, fullName: 'Propietario Maqueta' }
    });
  }
  return owner;
}

/**
 * Crea o reutiliza proyecto/unidad bajo tenant demo para cualquier dirección ingresada.
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function provisionDemoUnit(
  prisma,
  { address, comuna, unitNumber, tower = '', tenantSlugHint = '' }
) {
  const tenantSlug = tenantSlugHint || 'demo-inmobiliaria';
  let tenant = await prisma.pvTenant.findFirst({
    where: { slug: tenantSlug, status: 'ACTIVE' }
  });
  if (!tenant) {
    tenant = await prisma.pvTenant.create({
      data: {
        slug: tenantSlug,
        name:
          tenantSlug === 'demo-inmobiliaria'
            ? 'Inmobiliaria Demo Postventa'
            : tenantSlug,
        status: 'ACTIVE'
      }
    });
  }

  const slug = demoProjectSlug(address, comuna);
  let project = await prisma.pvProject.findFirst({
    where: { tenantId: tenant.id, slug }
  });
  if (!project) {
    project = await prisma.pvProject.create({
      data: {
        tenantId: tenant.id,
        slug,
        name: `Maqueta ${address}, ${comuna}`,
        address: normalizeAddress(address) || address,
        comuna: normalizeComuna(comuna) || comuna
      }
    });
  }

  const owner = await getOrCreateDemoOwner(prisma, tenant.id);
  const towerNorm = tower || '';

  let unit = await prisma.pvUnit.findFirst({
    where: { projectId: project.id, tower: towerNorm, unitNumber }
  });
  if (!unit) {
    unit = await prisma.pvUnit.create({
      data: {
        projectId: project.id,
        ownerId: owner.id,
        tower: towerNorm,
        unitNumber,
        label: formatUnitLabel(towerNorm, unitNumber) || `Depto ${unitNumber}`,
        domReceptionDate: DEMO_WARRANTY.domReceptionDate,
        cbrInscriptionDate: DEMO_WARRANTY.cbrInscriptionDate
      }
    });
  }

  return { unit, project, tenant };
}
