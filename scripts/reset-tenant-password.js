#!/usr/bin/env node
/**
 * Restablece la contraseña de un tenant por email.
 * Uso: node scripts/reset-tenant-password.js <email> <nueva-clave>
 * Requiere: Cloud SQL Proxy corriendo y DATABASE_URL configurado.
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

const email = process.argv[2]?.trim()?.toLowerCase();
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Uso: node scripts/reset-tenant-password.js <email> <nueva-clave>');
  console.error('Ejemplo: node scripts/reset-tenant-password.js seba.araya.silva@gmail.com MiClave123');
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error('La clave debe tener al menos 8 caracteres.');
  process.exit(1);
}

if (!/[A-Z]/.test(newPassword)) {
  console.error('La clave debe tener al menos 1 mayúscula.');
  process.exit(1);
}

if (!/[0-9]/.test(newPassword)) {
  console.error('La clave debe tener al menos 1 número.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { email }
  });
  if (!tenant) {
    console.error(`No se encontró tenant con email: ${email}`);
    console.error('Tenants existentes: ejecuta node scripts/list-tenants.js para ver la lista.');
    process.exit(1);
  }
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { passwordHash: hashPassword(newPassword) }
  });
  console.log(`Clave actualizada para ${email} (tenant: ${tenant.name})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
