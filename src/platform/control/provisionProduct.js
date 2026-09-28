/**
 * Al activar un producto en Control: crea tenant legacy + links para miembros de la org.
 */
import { ensureLink } from '../auth/legacyBridge.js';
import { ensureScanOrgForPlatform } from '../../scan/orgContext.js';
import { productLabel } from './legacyLookup.js';

function productSuffix(product) {
  return (
    {
      RECEPTION: 'Recepción',
      POSTSALE: 'Postventa',
      INOUT: 'InOut',
      SCAN: 'Scan',
      INSPECTION: 'Capture'
    }[product] || product
  );
}

async function ensureReceptionTenant(prisma, org) {
  const slug = org.slug;
  let tenant = await prisma.entregaTenant.findUnique({ where: { slug } });
  if (!tenant) {
    tenant = await prisma.entregaTenant.create({
      data: {
        slug,
        name: `${org.name} ${productSuffix('RECEPTION')}`,
        status: 'ACTIVE'
      }
    });
  } else if (tenant.status !== 'ACTIVE') {
    tenant = await prisma.entregaTenant.update({
      where: { id: tenant.id },
      data: { status: 'ACTIVE', name: tenant.name || `${org.name} Recepción` }
    });
  }
  return tenant;
}

async function ensurePostsaleTenant(prisma, org) {
  const slug = org.slug;
  let tenant = await prisma.pvTenant.findUnique({ where: { slug } });
  if (!tenant) {
    tenant = await prisma.pvTenant.create({
      data: {
        slug,
        name: `${org.name} ${productSuffix('POSTSALE')}`,
        status: 'ACTIVE'
      }
    });
  } else if (tenant.status !== 'ACTIVE') {
    tenant = await prisma.pvTenant.update({
      where: { id: tenant.id },
      data: { status: 'ACTIVE' }
    });
  }
  return tenant;
}

async function ensureInOutTenant(prisma, org) {
  const slug = org.slug;
  let tenant = await prisma.ioTenant.findUnique({ where: { slug } });
  if (!tenant) {
    tenant = await prisma.ioTenant.create({
      data: {
        slug,
        name: `${org.name} ${productSuffix('INOUT')}`,
        status: 'ACTIVE'
      }
    });
  } else if (tenant.status !== 'ACTIVE') {
    tenant = await prisma.ioTenant.update({
      where: { id: tenant.id },
      data: { status: 'ACTIVE' }
    });
  }
  return tenant;
}

async function ensureScanTenant(prisma, org) {
  return ensureScanOrgForPlatform(prisma, org);
}

/** Capture: reutilizar Tenant ya vinculado por INSPECTION o por nombre/slug. */
async function ensureInspectionTenant(prisma, org) {
  const existingLink = await prisma.legacyIdentityLink.findFirst({
    where: { organizationId: org.id, product: 'INSPECTION' }
  });
  if (existingLink) {
    const t = await prisma.tenant.findUnique({ where: { id: existingLink.legacyTenantId } });
    if (t) return t;
  }
  if (org.slug.startsWith('capture-') && org.slug.length >= 16) {
    const prefix = org.slug.slice('capture-'.length);
    const byId = await prisma.tenant.findFirst({
      where: { id: { startsWith: prefix } }
    });
    if (byId) return byId;
  }
  const byName = await prisma.tenant.findFirst({
    where: { name: org.name, status: 'ACTIVE' }
  });
  if (byName) return byName;
  return null;
}

async function upsertEntregaUser(prisma, { tenantId, email, fullName, passwordHash }) {
  const existing = await prisma.entregaUser.findUnique({ where: { email } });
  if (existing) {
    return prisma.entregaUser.update({
      where: { id: existing.id },
      data: {
        tenantId,
        fullName: fullName || existing.fullName,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: passwordHash || existing.passwordHash
      }
    });
  }
  return prisma.entregaUser.create({
    data: {
      tenantId,
      email,
      fullName: fullName || email,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    }
  });
}

async function upsertPvUser(prisma, { tenantId, email, fullName, passwordHash }) {
  const existing = await prisma.pvUser.findUnique({ where: { email } });
  if (existing) {
    return prisma.pvUser.update({
      where: { id: existing.id },
      data: {
        tenantId,
        fullName: fullName || existing.fullName,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: passwordHash || existing.passwordHash
      }
    });
  }
  return prisma.pvUser.create({
    data: {
      tenantId,
      email,
      fullName: fullName || email,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    }
  });
}

async function upsertIoUser(prisma, { tenantId, email, fullName, passwordHash }) {
  const existing = await prisma.ioUser.findUnique({ where: { email } });
  if (existing) {
    return prisma.ioUser.update({
      where: { id: existing.id },
      data: {
        tenantId,
        fullName: fullName || existing.fullName,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: passwordHash || existing.passwordHash
      }
    });
  }
  return prisma.ioUser.create({
    data: {
      tenantId,
      email,
      fullName: fullName || email,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    }
  });
}

async function upsertScanUser(prisma, { orgId, email, fullName, passwordHash }) {
  const existing = await prisma.scanUser.findUnique({ where: { email } }).catch(() => null);
  if (existing) {
    return prisma.scanUser.update({
      where: { id: existing.id },
      data: {
        orgId,
        fullName: fullName || existing.fullName,
        status: 'ACTIVE',
        passwordHash: passwordHash || existing.passwordHash
      }
    });
  }
  return prisma.scanUser.create({
    data: {
      orgId,
      email,
      fullName: fullName || email,
      status: 'ACTIVE',
      passwordHash
    }
  });
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   product: string,
 *   legacyTenantId: string|null,
 *   linked: Array<{ email: string, legacyUserId: string }>,
 *   skipped: Array<{ email: string, reason: string }>,
 *   message?: string
 * }>}
 */
export async function provisionProductAccess(prisma, org, product) {
  const code = String(product || '').toUpperCase();
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: org.id, status: 'ACTIVE' },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          passwordHash: true,
          status: true
        }
      }
    }
  });
  const activeUsers = members.map((m) => m.user).filter((u) => u && u.status === 'ACTIVE');

  if (!activeUsers.length) {
    return {
      ok: false,
      product: code,
      legacyTenantId: null,
      linked: [],
      skipped: [],
      message: `Sin miembros ACTIVE — agrega un admin en Miembros para vincular ${productLabel(code)}`
    };
  }

  let legacyTenant = null;
  if (code === 'RECEPTION') legacyTenant = await ensureReceptionTenant(prisma, org);
  else if (code === 'POSTSALE') legacyTenant = await ensurePostsaleTenant(prisma, org);
  else if (code === 'INOUT') legacyTenant = await ensureInOutTenant(prisma, org);
  else if (code === 'SCAN') legacyTenant = await ensureScanTenant(prisma, org);
  else if (code === 'INSPECTION') {
    legacyTenant = await ensureInspectionTenant(prisma, org);
    if (!legacyTenant) {
      return {
        ok: false,
        product: code,
        legacyTenantId: null,
        linked: [],
        skipped: [],
        message:
          'No hay Tenant Capture para esta org. El backfill Capture debe correr antes de vincular Inspección.'
      };
    }
  } else {
    return {
      ok: false,
      product: code,
      legacyTenantId: null,
      linked: [],
      skipped: [],
      message: `Producto no soportado para auto-provisión: ${code}`
    };
  }

  const linked = [];
  const skipped = [];

  for (const user of activeUsers) {
    const email = String(user.email || '').trim().toLowerCase();
    if (!email) {
      skipped.push({ email: '', reason: 'NO_EMAIL' });
      continue;
    }
    if (!user.passwordHash) {
      skipped.push({ email, reason: 'NO_PASSWORD_HASH' });
      continue;
    }

    // Si ya tiene link a otro tenant del mismo producto, reasignar a esta org (Control decide).
    let legacyUser;
    try {
      if (code === 'RECEPTION') {
        legacyUser = await upsertEntregaUser(prisma, {
          tenantId: legacyTenant.id,
          email,
          fullName: user.fullName,
          passwordHash: user.passwordHash
        });
      } else if (code === 'POSTSALE') {
        legacyUser = await upsertPvUser(prisma, {
          tenantId: legacyTenant.id,
          email,
          fullName: user.fullName,
          passwordHash: user.passwordHash
        });
      } else if (code === 'INOUT') {
        legacyUser = await upsertIoUser(prisma, {
          tenantId: legacyTenant.id,
          email,
          fullName: user.fullName,
          passwordHash: user.passwordHash
        });
      } else if (code === 'SCAN') {
        legacyUser = await upsertScanUser(prisma, {
          orgId: legacyTenant.id,
          email,
          fullName: user.fullName,
          passwordHash: user.passwordHash
        });
      } else if (code === 'INSPECTION') {
        // Preferir User Capture; si no, link a tenant id (login corredora).
        const captureUser = await prisma.user.findUnique({ where: { email } });
        if (captureUser) {
          await prisma.user.update({
            where: { id: captureUser.id },
            data: {
              tenantId: legacyTenant.id,
              status: 'ACTIVE',
              passwordHash: user.passwordHash,
              fullName: user.fullName || captureUser.fullName
            }
          });
          legacyUser = { id: captureUser.id };
        } else {
          legacyUser = { id: legacyTenant.id };
        }
      }
    } catch (err) {
      skipped.push({ email, reason: err?.message || 'UPSERT_FAILED' });
      continue;
    }

    await ensureLink(prisma, {
      platformUserId: user.id,
      organizationId: org.id,
      product: code,
      legacyTenantId: legacyTenant.id,
      legacyUserId: legacyUser.id
    });
    linked.push({ email, legacyUserId: legacyUser.id });
  }

  return {
    ok: linked.length > 0,
    product: code,
    legacyTenantId: legacyTenant.id,
    linked,
    skipped,
    message:
      linked.length > 0
        ? `Vinculado ${productLabel(code)} para ${linked.length} usuario(s)`
        : `No se pudo vincular ${productLabel(code)}`
  };
}
