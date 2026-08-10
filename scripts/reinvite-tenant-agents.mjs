#!/usr/bin/env node
/**
 * Reenvía invitación (email de activación) a todos los usuarios de un tenant.
 *
 * Uso:
 *   node scripts/reinvite-tenant-agents.mjs "REMAX PRINCIPAL"
 *   node scripts/reinvite-tenant-agents.mjs "REMAX PRINCIPAL" --dry-run
 *
 * Requiere DATABASE_URL (+ SMTP_* para enviar).
 * Producción: .\reinvite-remax-principal-prod.ps1 -Yes
 */
import crypto from 'node:crypto';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { sendExecutiveInvitationEmail } from '../src/email.js';

if (process.env.KICKOFF_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.KICKOFF_DATABASE_URL.trim();
}

const tenantName = process.argv[2]?.trim() || 'REMAX PRINCIPAL';
const dryRun = process.argv.includes('--dry-run');

function getWebBase() {
  return String(process.env.PUBLIC_URL || process.env.BASE_URL || 'https://ainspecciona.com')
    .trim()
    .replace(/\/$/, '');
}

async function createActivationForUser(prisma, userId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await prisma.activationToken.create({
    data: { userId, token, expiresAt },
  });
  return { token, activationUrl: `/activate?token=${encodeURIComponent(token)}` };
}

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [{ name: tenantName }, { rut: '77865198K' }],
    },
    select: { id: true, name: true, legalName: true, rut: true },
  });

  if (!tenant) {
    console.error(JSON.stringify({ ok: false, error: 'TENANT_NOT_FOUND', tenantName }));
    process.exit(1);
  }

  const company = String(tenant.legalName || tenant.name).trim();
  const users = await prisma.user.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, email: true, fullName: true, role: true, status: true },
    orderBy: { email: 'asc' },
  });

  if (!users.length) {
    console.error(JSON.stringify({ ok: false, error: 'NO_USERS', tenant: tenant.name }));
    process.exit(1);
  }

  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`Usuarios: ${users.length}`);
  console.log(`Base web: ${getWebBase()}`);
  if (dryRun) console.log('DRY RUN — no se envían correos ni se crean tokens\n');

  const results = [];
  for (const user of users) {
    const email = String(user.email || '').trim().toLowerCase();
    if (!email) {
      results.push({ email: null, ok: false, error: 'NO_EMAIL' });
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] ${email} (${user.role})`);
      results.push({ email, ok: true, dryRun: true });
      continue;
    }

    try {
      const { activationUrl } = await createActivationForUser(prisma, user.id);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          invitedAt: new Date(),
          status: user.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
        },
      });

      const absoluteUrl = `${getWebBase()}${activationUrl}`;
      const mail = await sendExecutiveInvitationEmail(
        email,
        user.fullName || '',
        company,
        absoluteUrl
      );

      const row = {
        email,
        role: user.role,
        ok: !!mail.ok,
        skipped: !!mail.skipped,
        error: mail.error || null,
      };
      results.push(row);
      const label = mail.ok ? 'SENT' : mail.skipped ? 'SKIPPED_SMTP' : 'FAIL';
      console.log(`[${label}] ${email}`);
    } catch (err) {
      console.log(`[FAIL] ${email} ${err.message}`);
      results.push({ email, ok: false, error: err.message });
    }
  }

  const sent = results.filter((r) => r.ok && !r.skipped && !r.dryRun).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok && !r.dryRun).length;

  console.log('\n=== Resumen ===');
  console.log(
    JSON.stringify(
      {
        ok: failed === 0,
        tenant: tenant.name,
        total: users.length,
        sent,
        skipped,
        failed,
      },
      null,
      2
    )
  );

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
