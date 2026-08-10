#!/usr/bin/env node
/**
 * Crea o reactiva un código promo (1 inspección gratis por defecto).
 *
 * Uso:
 *   node scripts/add-promo-code.mjs BIENVENIDO
 *   node scripts/add-promo-code.mjs BIENVENIDO --credits=1 --label="Lanzamiento"
 *   node scripts/add-promo-code.mjs VIEJO --deactivate
 *
 * Producción: KICKOFF_DATABASE_URL="mysql://..." node scripts/add-promo-code.mjs BIENVENIDO
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

if (process.env.KICKOFF_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.KICKOFF_DATABASE_URL.trim();
}

const prisma = new PrismaClient();

function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

async function main() {
  const args = process.argv.slice(2);
  const deactivate = args.includes('--deactivate');
  const codeArg = args.find((a) => !a.startsWith('--'));
  const creditsArg = args.find((a) => a.startsWith('--credits='));
  const labelArg = args.find((a) => a.startsWith('--label='));

  const code = normalizeCode(codeArg);
  if (!code) {
    console.error('Uso: node scripts/add-promo-code.mjs CODIGO [--credits=1] [--label="..."] [--deactivate]');
    process.exit(1);
  }

  const credits = Math.max(1, Math.floor(Number(creditsArg?.split('=')[1] || 1)) || 1);
  const label = labelArg ? String(labelArg.split('=').slice(1).join('=') || '').trim() || null : null;

  const existing = await prisma.promoCode.findUnique({ where: { code } });

  if (deactivate) {
    if (!existing) {
      console.error(`No existe código: ${code}`);
      process.exit(1);
    }
    await prisma.promoCode.update({ where: { code }, data: { active: false } });
    console.log(`OK: ${code} desactivado`);
    return;
  }

  if (existing) {
    const updated = await prisma.promoCode.update({
      where: { code },
      data: {
        active: true,
        credits,
        ...(label != null ? { label } : {})
      }
    });
    console.log(`OK: ${code} actualizado (active=${updated.active}, credits=${updated.credits})`);
    return;
  }

  const created = await prisma.promoCode.create({
    data: {
      id: crypto.randomUUID(),
      code,
      active: true,
      credits,
      label
    }
  });
  console.log(`OK: ${code} creado (id=${created.id}, credits=${created.credits})`);
}

main()
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  })
  .then(async () => {
    await prisma.$disconnect();
  });
