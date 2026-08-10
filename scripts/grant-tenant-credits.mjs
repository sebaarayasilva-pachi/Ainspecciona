#!/usr/bin/env node
/**
 * Acredita créditos a un tenant por nombre (misma lógica que POST /api/admin/tenants/:id/credits).
 *
 * Uso:
 *   node scripts/grant-tenant-credits.mjs "Real State Premium" 50
 *
 * Producción (túnel + secreto): ver grant-credits-prod.ps1 o:
 *   KICKOFF_DATABASE_URL="mysql://..." node scripts/grant-tenant-credits.mjs "Real State Premium" 50
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

if (process.env.KICKOFF_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.KICKOFF_DATABASE_URL.trim();
}

const prisma = new PrismaClient();

const tenantName = (process.argv[2] || process.env.GRANT_TENANT_NAME || 'Real State Premium').trim();
const amount = Math.floor(Number(process.argv[3] || process.env.GRANT_CREDITS || 50));

async function main() {
  if (!tenantName) {
    console.error('Uso: node scripts/grant-tenant-credits.mjs "<nombre tenant>" <cantidad>');
    process.exit(1);
  }
  if (!Number.isFinite(amount) || amount < 1) {
    console.error('La cantidad debe ser un entero >= 1');
    process.exit(1);
  }

  const tenant = await prisma.tenant.findFirst({
    where: { name: tenantName },
    select: { id: true, name: true }
  });
  if (!tenant) {
    console.error(`No existe tenant con nombre: "${tenantName}"`);
    process.exit(1);
  }

  const result = await prisma.$transaction(async (tx) => {
    let account = await tx.tenantCredit.findUnique({ where: { tenantId: tenant.id } });
    if (!account) {
      await tx.tenantCredit.create({ data: { tenantId: tenant.id, balance: 0 } });
    }
    await tx.tenantCredit.update({
      where: { tenantId: tenant.id },
      data: { balance: { increment: amount } }
    });
    await tx.creditTransaction.create({
      data: {
        tenantId: tenant.id,
        amount,
        type: 'ADJUSTMENT',
        description: `Admin script: +${amount} créditos (demo)`
      }
    });
    const updated = await tx.tenantCredit.findUnique({ where: { tenantId: tenant.id } });
    return updated?.balance ?? amount;
  });

  console.log(`OK: "${tenant.name}" (${tenant.id}) -> balance ${result} (+${amount})`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
