/**
 * Seed demo postventa: Padre Mariano 87, depto 205, Providencia
 *
 * Uso: node scripts/seed-postventa-demo.mjs
 * Requiere DATABASE_URL en .env (o proxy Cloud SQL).
 */
import { PrismaClient } from '@prisma/client';
import { formatUnitLabel } from '../src/postventa/normalize.js';

const prisma = new PrismaClient();

const DEMO = {
  tenantSlug: 'demo-inmobiliaria',
  tenantName: 'Inmobiliaria Demo Postventa',
  projectSlug: 'padre-mariano-87',
  projectName: 'Edificio Padre Mariano 87',
  address: 'Padre Mariano 87',
  comuna: 'Providencia',
  tower: '',
  unitNumber: '205',
  domReceptionDate: new Date('2024-03-15'),
  cbrInscriptionDate: new Date('2024-04-20'),
  owner: {
    fullName: 'Sebastián Araya',
    rut: '6972258K',
    phone: '56912345678',
    email: 'sebastian.araya@example.com'
  }
};

async function upsertProject(tenantId, data) {
  let project = await prisma.pvProject.findFirst({
    where: { tenantId, slug: data.projectSlug }
  });
  if (!project) {
    project = await prisma.pvProject.create({
      data: {
        tenantId,
        slug: data.projectSlug,
        name: data.projectName,
        address: data.address,
        comuna: data.comuna
      }
    });
    console.log('Created PvProject:', project.name);
    return project;
  }

  project = await prisma.pvProject.update({
    where: { id: project.id },
    data: {
      name: data.projectName,
      address: data.address,
      comuna: data.comuna
    }
  });
  console.log('Updated PvProject:', project.name);
  return project;
}

async function upsertUnit(projectId, ownerId, data) {
  const tower = data.tower || '';
  let unit = await prisma.pvUnit.findFirst({
    where: { projectId, tower, unitNumber: data.unitNumber }
  });
  const label = tower
    ? formatUnitLabel(tower, data.unitNumber)
    : `Depto ${data.unitNumber}`;

  if (!unit) {
    unit = await prisma.pvUnit.create({
      data: {
        projectId,
        ownerId,
        tower,
        unitNumber: data.unitNumber,
        label,
        domReceptionDate: data.domReceptionDate || null,
        cbrInscriptionDate: data.cbrInscriptionDate || null
      }
    });
    console.log('Created PvUnit:', unit.label);
    return unit;
  }

  unit = await prisma.pvUnit.update({
    where: { id: unit.id },
    data: {
      ownerId,
      label,
      domReceptionDate: data.domReceptionDate || null,
      cbrInscriptionDate: data.cbrInscriptionDate || null
    }
  });
  console.log('PvUnit exists:', unit.label);
  return unit;
}

async function main() {
  let tenant = await prisma.pvTenant.findFirst({ where: { slug: DEMO.tenantSlug } });
  if (!tenant) {
    tenant = await prisma.pvTenant.create({
      data: {
        slug: DEMO.tenantSlug,
        name: DEMO.tenantName,
        status: 'ACTIVE'
      }
    });
    console.log('Created PvTenant:', tenant.slug);
  } else {
    console.log('PvTenant exists:', tenant.slug);
  }

  const project = await upsertProject(tenant.id, DEMO);

  let owner = await prisma.pvOwner.findFirst({
    where: { tenantId: tenant.id, rut: DEMO.owner.rut }
  });
  if (!owner) {
    owner = await prisma.pvOwner.create({
      data: {
        tenantId: tenant.id,
        fullName: DEMO.owner.fullName,
        rut: DEMO.owner.rut,
        phone: DEMO.owner.phone,
        email: DEMO.owner.email
      }
    });
    console.log('Created PvOwner:', owner.fullName);
  } else {
    owner = await prisma.pvOwner.update({
      where: { id: owner.id },
      data: {
        fullName: DEMO.owner.fullName,
        phone: DEMO.owner.phone,
        email: DEMO.owner.email
      }
    });
    console.log('Updated PvOwner:', owner.fullName);
  }

  await upsertUnit(project.id, owner.id, DEMO);

  console.log('\nDemo listo para prueba ElevenLabs:');
  console.log(`  dirección: ${DEMO.address}`);
  console.log(`  comuna: ${DEMO.comuna}`);
  console.log(`  torre: (no aplica)`);
  console.log(`  depto: ${DEMO.unitNumber}`);
  console.log(`  RUT: 6.972.258-K`);
  console.log(`  propietario: ${DEMO.owner.fullName}`);
  console.log(`  recepción DOM: 2024-03-15 (instalaciones 5a / estructura 10a)`);
  console.log(`  inscripción CBR: 2024-04-20 (terminaciones 3a)`);
  console.log(`  inmobiliaria (deducida): ${DEMO.tenantName}`);
  console.log(`  garantía instalaciones (humedad): vigente hasta ~2029-03-15`);
  console.log(`  garantía terminaciones (pintura): vigente hasta ~2027-04-20`);
  console.log(
    `  "Tengo humedad en el baño, ${DEMO.address}, comuna ${DEMO.comuna}, depto ${DEMO.unitNumber}, RUT 6.972.258-K"`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
