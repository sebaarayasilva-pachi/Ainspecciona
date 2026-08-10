/**
 * Seed idempotente: usuario demo Recepción/Entrega.
 * Uso:
 *   node scripts/seed-entrega-demo-user.mjs
 *   node scripts/seed-entrega-demo-user.mjs --email recepcion@demo.ainspecciona.com --password 'RecepcionDemo2026!'
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/entrega/auth.js';

const prisma = new PrismaClient();

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const TENANT_SLUG = String(arg('--tenant-slug', 'exxacon')).trim();
const TENANT_NAME = String(arg('--tenant-name', 'Inmobiliaria Demo')).trim();
const email = String(arg('--email', 'recepcion@demo.ainspecciona.com')).trim().toLowerCase();
const password = String(arg('--password', 'RecepcionDemo2026!'));
const fullName = String(arg('--name', 'Demo Recepcion'));
const role = String(arg('--role', 'ADMIN')).trim().toUpperCase();

async function main() {
  if (!email || !password || password.length < 8) {
    console.error('Email y clave (>=8) son obligatorios.');
    process.exit(1);
  }

  let tenant = await prisma.entregaTenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    console.error(`Tenant entrega no encontrado: ${TENANT_SLUG}. Corre primero seed-entrega-exxacon.mjs`);
    process.exit(1);
  }

  if (TENANT_NAME && tenant.name !== TENANT_NAME) {
    tenant = await prisma.entregaTenant.update({
      where: { id: tenant.id },
      data: { name: TENANT_NAME }
    });
    console.log('Updated tenant name →', tenant.name);
  }

  const passwordHash = hashPassword(password);
  const existing = await prisma.entregaUser.findUnique({ where: { email } });
  let user;
  if (existing) {
    user = await prisma.entregaUser.update({
      where: { email },
      data: {
        tenantId: tenant.id,
        fullName,
        role,
        status: 'ACTIVE',
        passwordHash
      }
    });
    console.log('Updated demo user', user.email, user.fullName);
  } else {
    user = await prisma.entregaUser.create({
      data: {
        tenantId: tenant.id,
        email,
        fullName,
        role,
        status: 'ACTIVE',
        passwordHash
      }
    });
    console.log('Created demo user', user.email);
  }

  console.log({
    ok: true,
    url: 'https://ainspecciona.com/entrega',
    email: user.email,
    password,
    fullName: user.fullName,
    role: user.role,
    tenant: { slug: tenant.slug, name: tenant.name }
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
