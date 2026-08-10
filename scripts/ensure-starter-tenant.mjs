#!/usr/bin/env node
/**
 * Crea el tenant interno Starter si no existe (nombre fijo: Ainspecta Starter).
 * Mismo criterio que server.js / prisma seed para flujos B2C one-shot.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const STARTER_TENANT_NAME = 'Ainspecta Starter';

async function main() {
  const existing = await prisma.tenant.findFirst({ where: { name: STARTER_TENANT_NAME } });
  if (existing) {
    console.log(`Ya existe: "${STARTER_TENANT_NAME}" (${existing.id})`);
    await prisma.$disconnect();
    return;
  }

  const t = await prisma.tenant.create({
    data: {
      name: STARTER_TENANT_NAME,
      legalName: 'Ainspecta Starter',
      status: 'ACTIVE'
    }
  });
  console.log(`Creado tenant Starter: "${STARTER_TENANT_NAME}" (${t.id})`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
