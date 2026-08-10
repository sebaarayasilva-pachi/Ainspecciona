#!/usr/bin/env node
/**
 * Establece la contraseña de un tenant por email (sin reglas de complejidad).
 * Uso: node scripts/set-tenant-password-simple.mjs <email> <clave>
 * Requiere DATABASE_URL (p. ej. vía Cloud SQL Proxy en 127.0.0.1:3307).
 */
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const email = process.argv[2]?.trim()?.toLowerCase();
const newPassword = process.argv[3];

if (!email || newPassword === undefined || newPassword === '') {
  console.error('Uso: node scripts/set-tenant-password-simple.mjs <email> <clave>');
  process.exit(1);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { email } });
  if (!tenant) {
    console.error(`No se encontró tenant con email: ${email}`);
    process.exit(1);
  }
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { passwordHash: hashPassword(newPassword), status: 'ACTIVE' }
  });
  console.log(`Clave actualizada para ${email} (tenant: ${tenant.name})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
