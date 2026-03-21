import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

const prisma = new PrismaClient();

const STARTER_TENANT_NAME = 'Ainspecta Starter';

async function main() {
  // Tenant de prueba
  let existing = await prisma.tenant.findFirst({ where: { rut: '123456789' } });
  if (!existing) {
    await prisma.tenant.create({
      data: {
        name: 'Corredora Demo',
        rut: '123456789',
        passwordHash: hashPassword('local123'),
        status: 'ACTIVE',
      },
    });
    console.log('Tenant de prueba creado. RUT: 12345678-9, clave: local123');
  } else {
    console.log('Tenant de prueba ya existe.');
  }

  // Tenant interno para plan Starter (1 pago = 1 caso, sin dashboard)
  existing = await prisma.tenant.findFirst({ where: { name: STARTER_TENANT_NAME } });
  if (!existing) {
    await prisma.tenant.create({
      data: {
        name: STARTER_TENANT_NAME,
        legalName: 'Ainspecta Starter',
        status: 'ACTIVE',
      },
    });
    console.log('Tenant Starter creado (créditos one-shot).');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
