/**
 * Ejecutivo "Google Tester" con clave activa, asociado a la corredora que ya creaste (nombre "Test", "test", etc.).
 *
 * No modifica la corredora (email, RUT, clave del panel /tenant siguen siendo los que ya guardaste).
 *
 * Uso (con DATABASE_URL en .env):
 *   node prisma/seed-google-play-tester.js
 *   npm run seed:google-play-tester
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PASSWORD = 'Test1234!';
/** Nombre de corredora a buscar (sin importar mayúsculas) */
const TENANT_NAME_LOOKUP = 'test';
const EXEC_EMAIL = 'test@ainspecciona.com';
const EXEC_FULL_NAME = 'Google Tester';
/** Email de la corredora (si el nombre no coincide, se busca por este mail) */
const TENANT_EMAIL_LOOKUP = 'test@ainspecciona.com';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

async function findTenantForSeed() {
  let rows = await prisma.$queryRaw`
    SELECT id, name FROM Tenant
    WHERE LOWER(TRIM(name)) = LOWER(${TENANT_NAME_LOOKUP})
    ORDER BY createdAt ASC
    LIMIT 1
  `;
  if (!rows?.[0]?.id) {
    rows = await prisma.$queryRaw`
      SELECT id, name FROM Tenant
      WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(${TENANT_EMAIL_LOOKUP})
      ORDER BY createdAt ASC
      LIMIT 1
    `;
  }
  const row = rows?.[0];
  if (!row?.id) return null;
  return { id: row.id, name: row.name };
}

async function main() {
  const passwordHash = hashPassword(PASSWORD);

  const tenant = await findTenantForSeed();
  if (!tenant) {
    throw new Error(
      `No encontré corredora: nombre "${TENANT_NAME_LOOKUP}" (sin importar mayúsculas) o email "${TENANT_EMAIL_LOOKUP}". ` +
        'Revisá DATABASE_URL y que la corredora exista en esa base.'
    );
  }

  console.log('Corredora encontrada:', tenant.name, `(${tenant.id})`);

  const existingCredit = await prisma.tenantCredit.findUnique({ where: { tenantId: tenant.id } });
  if (!existingCredit) {
    await prisma.tenantCredit.create({
      data: { tenantId: tenant.id, balance: 100 }
    });
    console.log('Creada cuenta de créditos con saldo 100.');
  } else if (existingCredit.balance < 50) {
    await prisma.tenantCredit.update({
      where: { tenantId: tenant.id },
      data: { balance: 100 }
    });
    console.log('Saldo de créditos ajustado a 100 (estaba bajo).');
  }

  const user = await prisma.user.upsert({
    where: { email: EXEC_EMAIL },
    create: {
      tenantId: tenant.id,
      email: EXEC_EMAIL,
      fullName: EXEC_FULL_NAME,
      role: 'TENANT_USER',
      status: 'ACTIVE',
      passwordHash,
      invitedAt: new Date(),
      activatedAt: new Date()
    },
    update: {
      tenantId: tenant.id,
      fullName: EXEC_FULL_NAME,
      role: 'TENANT_USER',
      status: 'ACTIVE',
      passwordHash,
      invitedAt: new Date(),
      activatedAt: new Date()
    }
  });

  console.log('');
  console.log('--- Ejecutivo listo (Google Play) ---');
  console.log('Corredora:', tenant.name);
  console.log('  Panel /tenant: usá el email y clave que ya configuraste al crear la corredora.');
  console.log('');
  console.log('Ejecutivo (app o /executive):');
  console.log('  Nombre:', EXEC_FULL_NAME);
  console.log('  Email:', EXEC_EMAIL);
  console.log('  Clave:', PASSWORD);
  console.log('  Estado:', user.status);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
