#!/usr/bin/env node
/**
 * Lista usuarios ejecutivos (tabla User). Misma DATABASE_URL que otros scripts.
 * Uso: node scripts/list-executive-users.js
 *
 * Si ves 0 usuarios pero el panel tiene datos, casi seguro DATABASE_URL no está
 * definida (Prisma usa .env local) o no es la misma que Cloud Run.
 */
import { PrismaClient } from '@prisma/client';

function summarizeDbUrl(raw) {
  if (!raw || !String(raw).trim()) return '(DATABASE_URL vacía — define el secret como en reset-executive-password.ps1)';
  try {
    const normalized = String(raw).replace(/^mysql:\/\//i, 'http://');
    const u = new URL(normalized);
    const db = (u.pathname || '').replace(/^\//, '').split('?')[0] || '(sin nombre de base)';
    return `${u.hostname}:${u.port || '3306'} → base "${db}"`;
  } catch {
    return '(no se pudo resumir DATABASE_URL; revisa formato)';
  }
}

const prisma = new PrismaClient();
const take = Number(process.argv[2]) || 80;

console.log('Conexión:', summarizeDbUrl(process.env.DATABASE_URL));

const [tenantCount, userCount] = await Promise.all([
  prisma.tenant.count(),
  prisma.user.count()
]);
console.log(`Conteos: Tenant=${tenantCount}, User=${userCount}`);

const users = await prisma.user.findMany({
  orderBy: { createdAt: 'desc' },
  take,
  select: { email: true, fullName: true, status: true, tenantId: true, createdAt: true }
});
console.log(`Usuarios ejecutivos (últimos ${users.length}):`);
users.forEach((u) =>
  console.log(`  - ${u.email} | ${u.fullName} | ${u.status} | tenantId: ${u.tenantId || '(null)'}`)
);
await prisma.$disconnect();
