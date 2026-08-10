/**
 * Organización demo + usuarios platform + links a tenants TOC TOC / Scan.
 * Idempotente. Requiere que ensureToctocTenants (y Scan demo) ya hayan corrido.
 */
import {
  TOCTOC_TENANT_SLUG,
  TOCTOC_CAPTURE_EMAIL,
  TOCTOC_ENTREGA_EMAIL,
  TOCTOC_POSTVENTA_EMAIL,
  TOCTOC_INOUT_EMAIL,
  TOCTOC_DEMO_PASSWORD
} from '../../demo/ensureToctocTenants.js';
import {
  upsertOrg,
  ensureProduct,
  ensureMember,
  ensureLink,
  upsertPlatformUser,
  hashPassword
} from '../auth/legacyBridge.js';

export const PLATFORM_DEMO_EMAIL = 'plataforma@toctoc.ainspecciona.com';
export const PLATFORM_CONTROL_EMAIL = 'control@ainspecciona.com';

const PRODUCTS = ['INSPECTION', 'RECEPTION', 'POSTSALE', 'INOUT', 'SCAN'];

async function linkIfUser(prisma, {
  platformUserId,
  organizationId,
  product,
  legacyTenantId,
  legacyUserId
}) {
  if (!legacyTenantId || !legacyUserId) return null;
  return ensureLink(prisma, {
    platformUserId,
    organizationId,
    product,
    legacyTenantId,
    legacyUserId
  });
}

export async function ensurePlatformDemo(prisma, toctocResult = null) {
  if (!prisma?.organization) return { ok: false, skipped: true, reason: 'NO_PLATFORM_MODELS' };

  const password = String(process.env.TOCTOC_DEMO_PASSWORD || TOCTOC_DEMO_PASSWORD);
  const passwordHash = hashPassword(password);
  const controlPassword = String(process.env.PLATFORM_CONTROL_PASSWORD || password);
  const controlHash = hashPassword(controlPassword);

  const org = await upsertOrg(prisma, {
    slug: TOCTOC_TENANT_SLUG,
    name: 'TOC TOC Pruebas',
    type: 'DEVELOPER'
  });

  for (const product of PRODUCTS) {
    await ensureProduct(prisma, org.id, product);
  }

  // Control Ainspecciona
  const controlUser = await upsertPlatformUser(prisma, {
    email: String(process.env.PLATFORM_CONTROL_EMAIL || PLATFORM_CONTROL_EMAIL).toLowerCase(),
    fullName: 'Control Ainspecciona',
    passwordHash: controlHash,
    isPlatformAdmin: true
  });

  // Usuario unificado multi-producto
  const hubUser = await upsertPlatformUser(prisma, {
    email: PLATFORM_DEMO_EMAIL,
    fullName: 'Plataforma TOC TOC',
    passwordHash,
    isPlatformAdmin: false
  });
  await ensureMember(prisma, org.id, hubUser.id, 'ORGANIZATION_ADMIN');

  const captureEmail = String(process.env.TOCTOC_CAPTURE_EMAIL || TOCTOC_CAPTURE_EMAIL).toLowerCase();
  const entregaEmail = String(process.env.TOCTOC_ENTREGA_EMAIL || TOCTOC_ENTREGA_EMAIL).toLowerCase();
  const postventaEmail = String(process.env.TOCTOC_POSTVENTA_EMAIL || TOCTOC_POSTVENTA_EMAIL).toLowerCase();
  const inoutEmail = String(process.env.TOCTOC_INOUT_EMAIL || TOCTOC_INOUT_EMAIL).toLowerCase();

  const pv = toctocResult?.postventa;
  const entrega = toctocResult?.recepcion;
  const inout = toctocResult?.inout;
  const capture = toctocResult?.capture;

  // Resolver IDs si no vinieron en toctocResult
  let pvTenantId = pv?.tenantId;
  let pvUserId = pv?.userId;
  if (!pvUserId) {
    const u = await prisma.pvUser.findUnique({ where: { email: postventaEmail } });
    if (u) {
      pvUserId = u.id;
      pvTenantId = u.tenantId;
    }
  }

  let entregaTenantId = entrega?.tenantId;
  let entregaUserId = entrega?.userId;
  if (!entregaUserId) {
    const u = await prisma.entregaUser.findUnique({ where: { email: entregaEmail } });
    if (u) {
      entregaUserId = u.id;
      entregaTenantId = u.tenantId;
    }
  }

  let ioTenantId = inout?.tenantId;
  let ioUserId = inout?.userId;
  if (!ioUserId) {
    const u = await prisma.ioUser.findUnique({ where: { email: inoutEmail } });
    if (u) {
      ioUserId = u.id;
      ioTenantId = u.tenantId;
    }
  }

  let captureTenantId = capture?.tenantId || toctocResult?.businessTenantId;
  let captureUserId = capture?.userId;
  if (!captureUserId) {
    const u = await prisma.user.findUnique({ where: { email: captureEmail } });
    if (u) {
      captureUserId = u.id;
      captureTenantId = u.tenantId;
    }
  }

  let scanOrgId = null;
  let scanUserId = null;
  const scanUser = await prisma.scanUser.findUnique({ where: { email: 'corredor@scan.ainspecciona.com' } }).catch(() => null);
  if (scanUser) {
    scanUserId = scanUser.id;
    scanOrgId = scanUser.orgId;
  }

  // Links del hub unificado
  await linkIfUser(prisma, {
    platformUserId: hubUser.id,
    organizationId: org.id,
    product: 'POSTSALE',
    legacyTenantId: pvTenantId,
    legacyUserId: pvUserId
  });
  await linkIfUser(prisma, {
    platformUserId: hubUser.id,
    organizationId: org.id,
    product: 'RECEPTION',
    legacyTenantId: entregaTenantId,
    legacyUserId: entregaUserId
  });
  await linkIfUser(prisma, {
    platformUserId: hubUser.id,
    organizationId: org.id,
    product: 'INOUT',
    legacyTenantId: ioTenantId,
    legacyUserId: ioUserId
  });
  await linkIfUser(prisma, {
    platformUserId: hubUser.id,
    organizationId: org.id,
    product: 'INSPECTION',
    legacyTenantId: captureTenantId,
    legacyUserId: captureUserId
  });
  await linkIfUser(prisma, {
    platformUserId: hubUser.id,
    organizationId: org.id,
    product: 'SCAN',
    legacyTenantId: scanOrgId,
    legacyUserId: scanUserId
  });

  // Usuarios 1:1 por email de producto (mismo password) para login único con sus credenciales TOC TOC
  async function mirrorProductUser({ email, fullName, product, legacyTenantId, legacyUserId }) {
    if (!legacyUserId) return null;
    const u = await upsertPlatformUser(prisma, {
      email,
      fullName,
      passwordHash,
      isPlatformAdmin: false
    });
    await ensureMember(prisma, org.id, u.id, 'ORGANIZATION_ADMIN');
    await linkIfUser(prisma, {
      platformUserId: u.id,
      organizationId: org.id,
      product,
      legacyTenantId,
      legacyUserId
    });
    return u;
  }

  await mirrorProductUser({
    email: postventaEmail,
    fullName: 'Postventa TOC TOC Pruebas',
    product: 'POSTSALE',
    legacyTenantId: pvTenantId,
    legacyUserId: pvUserId
  });
  await mirrorProductUser({
    email: entregaEmail,
    fullName: 'Recepción TOC TOC Pruebas',
    product: 'RECEPTION',
    legacyTenantId: entregaTenantId,
    legacyUserId: entregaUserId
  });
  await mirrorProductUser({
    email: inoutEmail,
    fullName: 'InOut TOC TOC Pruebas',
    product: 'INOUT',
    legacyTenantId: ioTenantId,
    legacyUserId: ioUserId
  });
  await mirrorProductUser({
    email: captureEmail,
    fullName: 'Capture TOC TOC Pruebas',
    product: 'INSPECTION',
    legacyTenantId: captureTenantId,
    legacyUserId: captureUserId
  });

  if (scanUserId) {
    await mirrorProductUser({
      email: 'corredor@scan.ainspecciona.com',
      fullName: 'Corredor Scan Demo',
      product: 'SCAN',
      legacyTenantId: scanOrgId,
      legacyUserId: scanUserId
    });
  }

  return {
    ok: true,
    organizationId: org.id,
    hub: { email: PLATFORM_DEMO_EMAIL, password },
    control: {
      email: controlUser.email,
      password: controlPassword
    }
  };
}
