#!/usr/bin/env node
/**
 * Aplica badge.yellowFrom=60 y badge.greenFrom=86 en AppSetting (DB) o vía API admin.
 * Uso: node scripts/patch-badge-60-86.mjs
 *      API_BASE=https://ainspecciona.com node scripts/patch-badge-60-86.mjs
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const YELLOW = 60;
const GREEN = 86;
const KEY = 'score_config';
const apiBase = (process.env.API_BASE || process.env.PUBLIC_URL || 'https://ainspecciona.com').replace(/\/$/, '');

async function patchViaApi() {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    console.log('Sin ADMIN_USER/ADMIN_PASS: omitiendo API');
    return false;
  }
  const headers = {
    'x-admin-user': user,
    'x-admin-pass': pass,
    'Content-Type': 'application/json'
  };
  const getRes = await fetch(`${apiBase}/api/admin/score-config`, { headers });
  if (!getRes.ok) {
    console.error('GET score-config:', getRes.status, await getRes.text());
    return false;
  }
  const data = await getRes.json();
  const config = data.config || {};
  config.badge = { ...(config.badge || {}), yellowFrom: YELLOW, greenFrom: GREEN };
  const postRes = await fetch(`${apiBase}/api/admin/score-config`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ config })
  });
  const out = await postRes.json().catch(() => ({}));
  if (!postRes.ok) {
    console.error('POST score-config:', postRes.status, out);
    return false;
  }
  console.log(`OK API ${apiBase}: badge`, out.config?.badge || config.badge);
  return true;
}

async function patchViaDb() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT jsonValue FROM AppSetting WHERE keyName = ? LIMIT 1',
      KEY
    );
    const raw = rows?.[0]?.jsonValue;
    const config = raw ? JSON.parse(String(raw)) : {};
    config.badge = { ...(config.badge || {}), yellowFrom: YELLOW, greenFrom: GREEN };
    const next = JSON.stringify(config);
    await prisma.$executeRawUnsafe(
      'INSERT INTO AppSetting (keyName, jsonValue) VALUES (?, ?) ON DUPLICATE KEY UPDATE jsonValue = VALUES(jsonValue), updatedAt = CURRENT_TIMESTAMP(3)',
      KEY,
      next
    );
    console.log('OK DB: badge', config.badge);
    return true;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const viaApi = await patchViaApi();
  if (!viaApi && process.env.DATABASE_URL) {
    await patchViaDb();
  } else if (!viaApi) {
    console.log('Configura ADMIN_USER/ADMIN_PASS en .env o DATABASE_URL para aplicar.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
