/**
 * Ejecutivo demo con clave activa. Encuentra la corredora por: usuario tester@/test@, nombre conocido (test, Real State Premium), etc.
 *
 * No modifica la corredora (email, RUT, clave del panel /tenant siguen siendo los que ya guardaste).
 *
 * Uso (con DATABASE_URL en .env):
 *   node prisma/seed-google-play-tester.js
 *   npm run seed:google-play-tester
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/** Demo ejecutivo (app Capture): misma clave para emails legacy y actuales */
const PASSWORD = 'Test1234A';
/** Nombres de corredora conocidos (demo / prod), sin importar mayúsculas */
const TENANT_NAME_ALIASES = ['test', 'real state premium'];
/** Emails que pueden iniciar sesión como ejecutivo demo (User.email único) */
const EXEC_EMAILS = ['tester@ainspecciona.com', 'test@ainspecciona.com'];
const EXEC_FULL_NAME = 'Google Tester';
/** Email de la corredora (si el nombre no coincide, se busca por este mail) */
const TENANT_EMAIL_LOOKUP = 'test@ainspecciona.com';

/** Opcional: forzar corredora por ID (misma BD que DATABASE_URL). Ej: SEED_TENANT_ID=uuid */
const SEED_TENANT_ID = process.env.SEED_TENANT_ID?.trim() || '';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

async function findTenantForSeed() {
  if (SEED_TENANT_ID) {
    const t = await prisma.tenant.findUnique({
      where: { id: SEED_TENANT_ID },
      select: { id: true, name: true }
    });
    if (t) return t;
    throw new Error(`SEED_TENANT_ID=${SEED_TENANT_ID} no existe en esta base.`);
  }

  // Ya existe un ejecutivo demo: usar su corredora (vale para prod donde el tenant no se llama "test")
  for (const email of EXEC_EMAILS) {
    const u = await prisma.user.findUnique({
      where: { email },
      select: { tenantId: true }
    });
    if (u?.tenantId) {
      const t = await prisma.tenant.findUnique({
        where: { id: u.tenantId },
        select: { id: true, name: true }
      });
      if (t) return t;
    }
  }

  for (const nm of TENANT_NAME_ALIASES) {
    const rows = await prisma.$queryRaw`
      SELECT id, name FROM Tenant
      WHERE LOWER(TRIM(name)) = LOWER(${nm})
      ORDER BY createdAt ASC
      LIMIT 1
    `;
    if (rows?.[0]?.id) return { id: rows[0].id, name: rows[0].name };
  }

  let rows = await prisma.$queryRaw`
    SELECT id, name FROM Tenant
    WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(${TENANT_EMAIL_LOOKUP})
    ORDER BY createdAt ASC
    LIMIT 1
  `;
  const row = rows?.[0];
  if (!row?.id) return null;
  return { id: row.id, name: row.name };
}

async function main() {
  const passwordHash = hashPassword(PASSWORD);

  const tenant = await findTenantForSeed();
  if (!tenant) {
    throw new Error(
      `No encontré corredora: ejecutivo ${EXEC_EMAILS.join('/')}, nombres [${TENANT_NAME_ALIASES.join(', ')}], email tenant "${TENANT_EMAIL_LOOKUP}" o SEED_TENANT_ID. ` +
        'Revisá DATABASE_URL (¿prod vs local?) o definí SEED_TENANT_ID=<uuid de la corredora>.'
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

  // SQL directo: funciona aunque la BD local no tenga migración `mustChangePassword` (Prisma Client sí lo espera en user.*).
  const userTable = Prisma.raw('`User`');
  for (const email of EXEC_EMAILS) {
    const updated = await prisma.$executeRaw`
      UPDATE ${userTable}
      SET
        passwordHash = ${passwordHash},
        fullName = ${EXEC_FULL_NAME},
        tenantId = ${tenant.id},
        role = 'TENANT_USER',
        status = 'ACTIVE',
        invitedAt = COALESCE(invitedAt, NOW(3)),
        activatedAt = COALESCE(activatedAt, NOW(3))
      WHERE LOWER(TRIM(email)) = LOWER(${email})
    `;
    const n = typeof updated === 'bigint' ? Number(updated) : Number(updated);
    if (n === 0) {
      const id = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO ${userTable} (id, tenantId, email, fullName, passwordHash, role, status, invitedAt, activatedAt, createdAt)
        VALUES (
          ${id},
          ${tenant.id},
          ${email},
          ${EXEC_FULL_NAME},
          ${passwordHash},
          'TENANT_USER',
          'ACTIVE',
          NOW(3),
          NOW(3),
          NOW(3)
        )
      `;
      console.log('Creado usuario:', email);
    }
  }

  console.log('');
  console.log('--- Ejecutivo listo (Google Play / demo) ---');
  console.log('Corredora:', tenant.name);
  console.log('  Panel /tenant: usá el email y clave que ya configuraste al crear la corredora.');
  console.log('');
  console.log('Ejecutivo (app o /executive):');
  console.log('  Nombre:', EXEC_FULL_NAME);
  console.log('  Emails:', EXEC_EMAILS.join(', '));
  console.log('  Clave:', PASSWORD);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
