#!/usr/bin/env node
/**
 * Limpieza de BD para kickoff:
 * - Borra TODAS las inspecciones (Case y datos en cascada).
 * - Borra todos los tenants excepto los indicados por nombre.
 * - Limpia analíticas de página, sesiones, WhatsApp, pagos starter pendientes, etc.
 * - Resetea créditos e historial de los tenants conservados.
 *
 * No borra archivos en GCS/storage (solo registros en MySQL).
 *
 * Un solo tenant conservado:
 *   CONFIRM=YES node scripts/kickoff-cleanup.mjs
 *   KICKOFF_KEEP_TENANT="Real State Premium" CONFIRM=YES node scripts/kickoff-cleanup.mjs
 *
 * Varios tenants (coma, sin espacios extra en nombres o usa comillas):
 *   KICKOFF_KEEP_TENANTS="Real State Premium,Corredora Testers" CONFIRM=YES node scripts/kickoff-cleanup.mjs
 *
 * Si el nombre no existe, créalo antes en admin o usa (solo modo un tenant):
 *   KICKOFF_CREATE_IF_MISSING=YES CONFIRM=YES node scripts/kickoff-cleanup.mjs
 *
 * Dry-run: node scripts/kickoff-cleanup.mjs
 *
 * Producción (Cloud SQL vía proxy): usa `kickoff-cleanup-prod.ps1` en la raíz de ainspecta_web,
 * o exporta KICKOFF_DATABASE_URL con la URL ya convertida a 127.0.0.1:3307.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Producción / túnel: si está definida, gana sobre .env local (evita limpiar la BD equivocada).
if (process.env.KICKOFF_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.KICKOFF_DATABASE_URL.trim();
}

const prisma = new PrismaClient();

function logDatabaseTarget() {
  const raw = process.env.DATABASE_URL || '';
  if (!raw) {
    console.error('[kickoff] DATABASE_URL vacío. Configura .env o KICKOFF_DATABASE_URL.');
    return;
  }
  const masked = raw.replace(/:([^:@/]+)@/, ':****@');
  try {
    const normalized = raw.replace(/^mysql:\/\//i, 'http://');
    const u = new URL(normalized);
    console.log(`[kickoff] Conectando a: ${u.hostname}:${u.port || '3306'} (base: ${u.pathname?.replace(/^\//, '') || '?'})`);
  } catch {
    console.log('[kickoff] DATABASE_URL (enmascarada):', masked.slice(0, 80) + (masked.length > 80 ? '…' : ''));
  }
}

const CONFIRM = process.env.CONFIRM === 'YES';
const CREATE_IF_MISSING = process.env.KICKOFF_CREATE_IF_MISSING === 'YES';

/** @returns {string[]} */
function parseKeepNames() {
  const multi = process.env.KICKOFF_KEEP_TENANTS?.trim();
  if (multi) {
    return [...new Set(multi.split(',').map((s) => s.trim()).filter(Boolean))];
  }
  return [(process.env.KICKOFF_KEEP_TENANT || 'Real State Premium').trim()];
}

async function main() {
  logDatabaseTarget();

  const keepNames = parseKeepNames();
  const tenants = await prisma.tenant.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true }
  });

  const nameSet = new Set(keepNames);
  let keepRows = tenants.filter((t) => nameSet.has(t.name));

  if (keepRows.length < keepNames.length && CREATE_IF_MISSING && keepNames.length === 1 && CONFIRM) {
    const missing = keepNames.filter((n) => !keepRows.some((r) => r.name === n));
    for (const name of missing) {
      const created = await prisma.tenant.create({
        data: { name, status: 'ACTIVE' },
        select: { id: true, name: true, email: true }
      });
      keepRows.push(created);
      console.log(`Creado tenant "${name}" (${created.id}).`);
    }
  }

  if (keepRows.length < keepNames.length) {
    const foundNames = new Set(keepRows.map((r) => r.name));
    const missing = keepNames.filter((n) => !foundNames.has(n));
    console.error('Faltan tenants con nombre exacto:', missing.join(', '));
    console.error('Tenants actuales:');
    tenants.forEach((t) => console.error(`  - "${t.name}" (${t.id})`));
    console.error(
      '\nCrea los tenants en admin o ajusta KICKOFF_KEEP_TENANTS / KICKOFF_KEEP_TENANT.'
    );
    if (keepNames.length === 1) {
      console.error('Modo un tenant: puedes usar KICKOFF_CREATE_IF_MISSING=YES con CONFIRM=YES.');
    }
    await prisma.$disconnect();
    process.exit(1);
  }

  const keepIds = keepRows.map((r) => r.id);
  const caseCount = await prisma.case.count();
  const toDeleteTenants = tenants.length - keepRows.length;

  console.log('Tenants a conservar:');
  keepRows.forEach((r) => console.log(`  - "${r.name}" (${r.id})`));
  console.log(
    `Se eliminarán: ${caseCount} inspecciones (Case), ${toDeleteTenants} tenants, y datos relacionados.`
  );
  console.log(
    'Aviso: el tenant "Ainspecta Starter" se borrará si no está en la lista. Para flujos Starter: npm run ensure:starter-tenant'
  );

  if (!CONFIRM) {
    console.log('\nDry-run: no se ha borrado nada. Para ejecutar, repite con CONFIRM=YES');
    await prisma.$disconnect();
    process.exit(0);
  }

  // Algunas BDs antiguas no tienen esta tabla; fuera de la transacción para no abortar todo el cleanup.
  try {
    const delMagic = await prisma.magicLinkToken.deleteMany({});
    console.log(`MagicLinkToken eliminados: ${delMagic.count}`);
  } catch (e) {
    if (e?.code === 'P2021') {
      console.log('MagicLinkToken: tabla no existe en esta BD, omitido.');
    } else {
      throw e;
    }
  }

  await prisma.$transaction(
    async (tx) => {
      const delCases = await tx.case.deleteMany({});
      console.log(`Cases eliminados: ${delCases.count}`);

      const delPo = await tx.presencialOrder.deleteMany({});
      console.log(`PresencialOrder eliminados: ${delPo.count}`);

      const delProp = await tx.property.deleteMany({});
      console.log(`Property eliminadas: ${delProp.count}`);

      const delOwn = await tx.owner.deleteMany({});
      console.log(`Owner eliminados: ${delOwn.count}`);

      const delUsers = await tx.user.deleteMany({
        where: {
          OR: [{ tenantId: { notIn: keepIds } }, { tenantId: null }]
        }
      });
      console.log(`User eliminados: ${delUsers.count}`);

      const delWa = await tx.whatsAppConversation.deleteMany({});
      console.log(`WhatsAppConversation eliminadas: ${delWa.count}`);

      const delWaEv = await tx.whatsAppProcessedEvent.deleteMany({});
      console.log(`WhatsAppProcessedEvent eliminados: ${delWaEv.count}`);

      const delPv = await tx.pageView.deleteMany({});
      console.log(`PageView eliminados: ${delPv.count}`);

      const delPs = await tx.pendingStarterPayment.deleteMany({});
      console.log(`PendingStarterPayment eliminados: ${delPs.count}`);

      const delSess = await tx.session.deleteMany({});
      console.log(`Session eliminadas: ${delSess.count}`);

      const delPeer = await tx.peerReferralAttribution.deleteMany({});
      console.log(`PeerReferralAttribution eliminados: ${delPeer.count}`);

      const delComm = await tx.partnerCommissionAccrual.deleteMany({});
      console.log(`PartnerCommissionAccrual eliminados: ${delComm.count}`);

      const delCt = await tx.creditTransaction.deleteMany({ where: { tenantId: { in: keepIds } } });
      console.log(`CreditTransaction (tenants conservados) eliminados: ${delCt.count}`);

      await tx.tenantCredit.deleteMany({ where: { tenantId: { in: keepIds } } });
      console.log('TenantCredit de tenants conservados eliminado (si existía).');

      const delT = await tx.tenant.deleteMany({ where: { id: { notIn: keepIds } } });
      console.log(`Tenants eliminados: ${delT.count}`);

      await tx.tenant.updateMany({
        where: { id: { in: keepIds } },
        data: {
          mpSubscriptionId: null,
          subscriptionStatus: null,
          subscriptionExpiresAt: null,
          trialSubscriptionId: null,
          trialStatus: null,
          trialStartedAt: null,
          trialEndsAt: null,
          trialConvertedAt: null,
          trialCancelledAt: null,
          trialRealInspectionUsedAt: null,
          trialBlockedReason: null,
          trialEligibilityKey: null,
          trialAutoCharge: false,
          trialSource: null,
          referralPartnerId: null,
          referralCodeSnapshot: null,
          trialPartnerBenefitsAt: null,
          peerReferralCode: null
        }
      });
      console.log('Tenants conservados: campos de suscripción/trial/referidos reseteados.');
    },
    { timeout: 120000 }
  );

  for (const id of keepIds) {
    await prisma.tenantCredit.upsert({
      where: { tenantId: id },
      create: { tenantId: id, balance: 0 },
      update: { balance: 0 }
    });
  }
  console.log(`TenantCredit con balance 0 para ${keepIds.length} tenant(s).`);

  console.log(`\nListo. Quedan ${keepIds.length} tenant(s) y cero inspecciones.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
