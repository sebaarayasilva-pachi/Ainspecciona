/**
 * Seed idempotente: Inmobiliaria Exxacon + admin Pablo Almuna.
 * Uso: node scripts/seed-entrega-exxacon.mjs
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/entrega/auth.js';

const prisma = new PrismaClient();

const TENANT = {
  slug: 'exxacon',
  name: 'Inmobiliaria Demo'
};

const ADMIN = {
  email: 'palmuna@exxacon.cl',
  fullName: 'Pablo Almuna',
  role: 'ADMIN',
  password: 'Exxacon2026'
};

async function main() {
  const tenant = await prisma.entregaTenant.upsert({
    where: { slug: TENANT.slug },
    create: {
      slug: TENANT.slug,
      name: TENANT.name,
      status: 'ACTIVE'
    },
    update: {
      name: TENANT.name,
      status: 'ACTIVE'
    }
  });

  const passwordHash = hashPassword(ADMIN.password);
  const existing = await prisma.entregaUser.findUnique({ where: { email: ADMIN.email } });
  let user;
  if (existing) {
    user = await prisma.entregaUser.update({
      where: { email: ADMIN.email },
      data: {
        tenantId: tenant.id,
        fullName: ADMIN.fullName,
        role: ADMIN.role,
        status: 'ACTIVE',
        passwordHash
      }
    });
    console.log('Updated user', user.email);
  } else {
    user = await prisma.entregaUser.create({
      data: {
        tenantId: tenant.id,
        email: ADMIN.email,
        fullName: ADMIN.fullName,
        role: ADMIN.role,
        status: 'ACTIVE',
        passwordHash
      }
    });
    console.log('Created user', user.email);
  }

  console.log({
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role }
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
