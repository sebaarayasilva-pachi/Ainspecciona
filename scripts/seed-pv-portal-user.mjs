/**
 * Crea (o actualiza) un usuario demo del portal Postventa ligado al primer PvTenant ACTIVE.
 *
 * Uso:
 *   node scripts/seed-pv-portal-user.mjs
 *   node scripts/seed-pv-portal-user.mjs --email ops@ejemplo.com --password 'ClaveSegura1' --tenant-slug mi-tenant
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  return process.argv[i + 1] ?? def;
}

const email = String(arg('--email', 'postventa@demo.ainspecciona.com')).trim().toLowerCase();
const password = String(arg('--password', 'PostventaDemo2026!'));
const tenantSlug = arg('--tenant-slug', null);
const fullName = String(arg('--name', 'Operador Postventa Demo'));

const prisma = new PrismaClient();

try {
  let tenants;
  if (tenantSlug) {
    tenants = await prisma.$queryRaw`
      SELECT id, slug, name FROM pv_tenant
      WHERE slug = ${String(tenantSlug).trim()} AND status = 'ACTIVE'
      LIMIT 1
    `;
  } else {
    tenants = await prisma.$queryRaw`
      SELECT id, slug, name FROM pv_tenant
      WHERE status = 'ACTIVE'
      ORDER BY createdAt ASC
      LIMIT 1
    `;
  }

  const tenant = tenants?.[0];
  if (!tenant) {
    console.error('No hay PvTenant ACTIVE. Crea un tenant postventa primero.');
    process.exit(1);
  }

  const passwordHash = hashPassword(password);
  const id = crypto.randomUUID();
  const existing = await prisma.$queryRaw`
    SELECT id FROM pv_user WHERE email = ${email} LIMIT 1
  `;

  if (existing?.[0]?.id) {
    await prisma.$executeRaw`
      UPDATE pv_user
      SET tenantId = ${tenant.id},
          fullName = ${fullName},
          role = 'ADMIN',
          status = 'ACTIVE',
          passwordHash = ${passwordHash},
          updatedAt = UTC_TIMESTAMP(3)
      WHERE email = ${email}
    `;
    console.log('Usuario actualizado:', email);
  } else {
    await prisma.$executeRaw`
      INSERT INTO pv_user (id, tenantId, email, fullName, role, status, passwordHash, createdAt, updatedAt)
      VALUES (${id}, ${tenant.id}, ${email}, ${fullName}, 'ADMIN', 'ACTIVE', ${passwordHash}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
    `;
    console.log('Usuario creado:', email);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        password,
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        loginUrl: '/postventa/portal/login'
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
