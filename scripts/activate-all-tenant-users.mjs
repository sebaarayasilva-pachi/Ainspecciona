#!/usr/bin/env node
/**
 * Pone todos los User de un tenant en ACTIVE con la misma clave (hash distinto por usuario).
 * Uso: node scripts/activate-all-tenant-users.mjs <nombre-exacto-tenant> <clave>
 * Requiere DATABASE_URL (Cloud SQL Proxy típico: 127.0.0.1:3307).
 */
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const tenantName = process.argv[2]?.trim();
const pass = process.argv[3];

if (!tenantName || !pass) {
  console.error('Uso: node scripts/activate-all-tenant-users.mjs <nombre-tenant> <clave>');
  process.exit(1);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

const prisma = new PrismaClient();

const tenant = await prisma.tenant.findFirst({
  where: { name: tenantName },
  select: { id: true, name: true },
});
if (!tenant) {
  console.error(JSON.stringify({ ok: false, error: 'TENANT_NOT_FOUND', tenantName }));
  process.exit(1);
}

const users = await prisma.user.findMany({
  where: { tenantId: tenant.id },
  select: { id: true, email: true, fullName: true },
  orderBy: { email: 'asc' },
});

const now = new Date();
for (const u of users) {
  await prisma.user.update({
    where: { id: u.id },
    data: {
      status: 'ACTIVE',
      activatedAt: now,
      invitedAt: now,
      passwordHash: hashPassword(pass),
    },
  });
}

console.log(
  JSON.stringify({
    ok: true,
    tenant: tenant.name,
    updated: users.length,
    password: pass,
    emails: users.map((u) => u.email),
  }),
);

await prisma.$disconnect();
