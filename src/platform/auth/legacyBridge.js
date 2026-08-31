/**
 * Auto-provisiona PlatformUser + Organization + LegacyIdentityLink
 * cuando un email ya existe en un producto legacy.
 */
import { hashPassword, verifyPassword } from './session.js';
import { ALL_PRODUCT_CODES } from '../products.js';

async function upsertOrg(prisma, { slug, name, type }) {
  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) {
    return prisma.organization.update({
      where: { id: existing.id },
      data: { name, status: 'ACTIVE', type: type || existing.type }
    });
  }
  return prisma.organization.create({
    data: {
      slug,
      name,
      type: type || 'OTHER',
      status: 'ACTIVE'
    }
  });
}

async function ensureProduct(prisma, organizationId, product) {
  const existing = await prisma.organizationProduct.findUnique({
    where: { organizationId_product: { organizationId, product } }
  });
  if (existing) {
    if (existing.status !== 'ENABLED') {
      return prisma.organizationProduct.update({
        where: { id: existing.id },
        data: { status: 'ENABLED', startedAt: existing.startedAt || new Date() }
      });
    }
    return existing;
  }
  return prisma.organizationProduct.create({
    data: {
      organizationId,
      product,
      status: 'ENABLED',
      startedAt: new Date()
    }
  });
}

async function ensureMember(prisma, organizationId, userId, role = 'ORGANIZATION_ADMIN') {
  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } }
  });
  if (existing) {
    return prisma.organizationMember.update({
      where: { id: existing.id },
      data: { status: 'ACTIVE', role }
    });
  }
  return prisma.organizationMember.create({
    data: { organizationId, userId, role, status: 'ACTIVE' }
  });
}

async function ensureLink(prisma, {
  platformUserId,
  organizationId,
  product,
  legacyTenantId,
  legacyUserId
}) {
  const byUserProduct = await prisma.legacyIdentityLink.findUnique({
    where: { platformUserId_product: { platformUserId, product } }
  });
  if (byUserProduct) {
    return prisma.legacyIdentityLink.update({
      where: { id: byUserProduct.id },
      data: { organizationId, legacyTenantId, legacyUserId }
    });
  }
  return prisma.legacyIdentityLink.create({
    data: {
      platformUserId,
      organizationId,
      product,
      legacyTenantId,
      legacyUserId
    }
  });
}

async function upsertPlatformUser(prisma, { email, fullName, passwordHash, isPlatformAdmin = false }) {
  const existing = await prisma.platformUser.findUnique({ where: { email } });
  if (existing) {
    return prisma.platformUser.update({
      where: { id: existing.id },
      data: {
        fullName,
        passwordHash,
        status: 'ACTIVE',
        isPlatformAdmin: isPlatformAdmin || existing.isPlatformAdmin
      }
    });
  }
  return prisma.platformUser.create({
    data: {
      email,
      fullName,
      passwordHash,
      status: 'ACTIVE',
      isPlatformAdmin
    }
  });
}

/**
 * Busca credenciales en productos legacy y crea identidad de plataforma.
 * @returns {Promise<null | { user: object, organizationId: string }>}
 */
export async function tryProvisionFromLegacy(prisma, email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !password || !prisma) return null;

  // Postventa
  const pvUser = await prisma.pvUser.findUnique({
    where: { email: normalized },
    include: { tenant: true }
  });
  if (pvUser?.status === 'ACTIVE' && pvUser.tenant?.status === 'ACTIVE') {
    if (verifyPassword(password, pvUser.passwordHash)) {
      const slug = pvUser.tenant.slug || `pv-${pvUser.tenantId.slice(0, 8)}`;
      const org = await upsertOrg(prisma, {
        slug,
        name: pvUser.tenant.name,
        type: 'DEVELOPER'
      });
      await ensureProduct(prisma, org.id, 'POSTSALE');
      const user = await upsertPlatformUser(prisma, {
        email: normalized,
        fullName: pvUser.fullName,
        passwordHash: pvUser.passwordHash
      });
      await ensureMember(prisma, org.id, user.id, 'ORGANIZATION_ADMIN');
      await ensureLink(prisma, {
        platformUserId: user.id,
        organizationId: org.id,
        product: 'POSTSALE',
        legacyTenantId: pvUser.tenantId,
        legacyUserId: pvUser.id
      });
      return { user, organizationId: org.id };
    }
  }

  // Entrega / Reception
  const entregaUser = await prisma.entregaUser.findUnique({
    where: { email: normalized },
    include: { tenant: true }
  });
  if (entregaUser?.status === 'ACTIVE' && entregaUser.tenant?.status === 'ACTIVE') {
    if (verifyPassword(password, entregaUser.passwordHash)) {
      const slug = entregaUser.tenant.slug || `entrega-${entregaUser.tenantId.slice(0, 8)}`;
      const org = await upsertOrg(prisma, {
        slug,
        name: entregaUser.tenant.name,
        type: 'DEVELOPER'
      });
      await ensureProduct(prisma, org.id, 'RECEPTION');
      const user = await upsertPlatformUser(prisma, {
        email: normalized,
        fullName: entregaUser.fullName,
        passwordHash: entregaUser.passwordHash
      });
      await ensureMember(prisma, org.id, user.id, 'ORGANIZATION_ADMIN');
      await ensureLink(prisma, {
        platformUserId: user.id,
        organizationId: org.id,
        product: 'RECEPTION',
        legacyTenantId: entregaUser.tenantId,
        legacyUserId: entregaUser.id
      });
      return { user, organizationId: org.id };
    }
  }

  // In & Out
  const ioUser = await prisma.ioUser.findUnique({
    where: { email: normalized },
    include: { tenant: true }
  });
  if (ioUser?.status === 'ACTIVE' && ioUser.tenant?.status === 'ACTIVE') {
    if (verifyPassword(password, ioUser.passwordHash)) {
      const slug = ioUser.tenant.slug || `io-${ioUser.tenantId.slice(0, 8)}`;
      const org = await upsertOrg(prisma, {
        slug,
        name: ioUser.tenant.name,
        type: 'PROPERTY_MANAGER'
      });
      await ensureProduct(prisma, org.id, 'INOUT');
      const user = await upsertPlatformUser(prisma, {
        email: normalized,
        fullName: ioUser.fullName,
        passwordHash: ioUser.passwordHash
      });
      await ensureMember(prisma, org.id, user.id, 'ORGANIZATION_ADMIN');
      await ensureLink(prisma, {
        platformUserId: user.id,
        organizationId: org.id,
        product: 'INOUT',
        legacyTenantId: ioUser.tenantId,
        legacyUserId: ioUser.id
      });
      return { user, organizationId: org.id };
    }
  }

  // Scan
  const scanUser = await prisma.scanUser.findUnique({
    where: { email: normalized },
    include: { org: true }
  }).catch(() => null);
  if (scanUser?.status === 'ACTIVE' && scanUser.org?.status === 'ACTIVE') {
    if (verifyPassword(password, scanUser.passwordHash)) {
      const slug = scanUser.org.slug || `scan-${scanUser.orgId.slice(0, 8)}`;
      const org = await upsertOrg(prisma, {
        slug,
        name: scanUser.org.name,
        type: 'BROKER'
      });
      await ensureProduct(prisma, org.id, 'SCAN');
      const user = await upsertPlatformUser(prisma, {
        email: normalized,
        fullName: scanUser.fullName,
        passwordHash: scanUser.passwordHash
      });
      await ensureMember(prisma, org.id, user.id, 'ORGANIZATION_ADMIN');
      await ensureLink(prisma, {
        platformUserId: user.id,
        organizationId: org.id,
        product: 'SCAN',
        legacyTenantId: scanUser.orgId,
        legacyUserId: scanUser.id
      });
      return { user, organizationId: org.id };
    }
  }

  // Capture User (tabla User)
  const captureUser = await prisma.user.findFirst({
    where: { email: normalized, status: 'ACTIVE' },
    include: { tenant: true }
  }).catch(() => null);
  if (captureUser?.passwordHash && captureUser.tenant?.status === 'ACTIVE') {
    if (verifyPassword(password, captureUser.passwordHash)) {
      const slug = `capture-${captureUser.tenantId.slice(0, 8)}`;
      const org = await upsertOrg(prisma, {
        slug,
        name: captureUser.tenant.name || 'Capture',
        type: 'BROKER'
      });
      await ensureProduct(prisma, org.id, 'INSPECTION');
      const user = await upsertPlatformUser(prisma, {
        email: normalized,
        fullName: captureUser.fullName || normalized,
        passwordHash: captureUser.passwordHash
      });
      await ensureMember(prisma, org.id, user.id, 'ORGANIZATION_ADMIN');
      await ensureLink(prisma, {
        platformUserId: user.id,
        organizationId: org.id,
        product: 'INSPECTION',
        legacyTenantId: captureUser.tenantId,
        legacyUserId: captureUser.id
      });
      return { user, organizationId: org.id };
    }
  }

  // Corredora Capture (login Tenant por email — cuenta de negocio)
  const tenantByEmail = await prisma.tenant.findFirst({
    where: { email: normalized, status: 'ACTIVE' },
    select: { id: true, name: true, email: true, passwordHash: true }
  });
  if (tenantByEmail?.passwordHash && verifyPassword(password, tenantByEmail.passwordHash)) {
    return provisionBrokerTenant(prisma, tenantByEmail, password);
  }

  return null;
}

/** Provisiona org+user platform desde un Tenant Capture (email o RUT). */
export async function provisionBrokerTenant(prisma, tenant, password) {
  const email = String(tenant.email || '').trim().toLowerCase()
    || `tenant-${tenant.id.slice(0, 8)}@broker.ainspecciona.local`;
  const passwordHash = tenant.passwordHash || hashPassword(password);
  const result = await backfillBrokerTenant(prisma, {
    ...tenant,
    email,
    passwordHash
  }, { linkTenantAccount: true, linkTenantAdmins: false });
  return {
    user: result.users[0] || null,
    organizationId: result.organizationId
  };
}

/**
 * Backfill idempotente: Organization BROKER + INSPECTION + links Capture.
 * No sobrescribe LegacyIdentityLink INSPECTION de otro tenant (conflicto).
 * No pisa passwordHash de PlatformUser existente.
 *
 * @returns {Promise<{
 *   organizationId: string,
 *   organizationSlug: string,
 *   created: boolean,
 *   users: object[],
 *   linked: Array<{ email: string, legacyUserId: string }>,
 *   skippedConflicts: Array<{ email: string, reason: string, existingTenantId?: string }>,
 *   skipped: Array<{ email: string, reason: string }>
 * }>}
 */
export async function backfillBrokerTenant(prisma, tenant, opts = {}) {
  const linkTenantAccount = opts.linkTenantAccount !== false;
  const linkTenantAdmins = opts.linkTenantAdmins !== false;

  const slug = `capture-${tenant.id.slice(0, 8)}`;
  const existingOrg = await prisma.organization.findUnique({ where: { slug } });
  const org = await upsertOrg(prisma, {
    slug,
    name: tenant.name || 'Capture',
    type: 'BROKER'
  });
  await ensureProduct(prisma, org.id, 'INSPECTION');

  const linked = [];
  const skippedConflicts = [];
  const skipped = [];
  const users = [];

  async function linkIdentity({ email, fullName, passwordHash, legacyUserId }) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) {
      skipped.push({ email: String(email || ''), reason: 'NO_EMAIL' });
      return;
    }
    if (!passwordHash) {
      skipped.push({ email: normalized, reason: 'NO_PASSWORD_HASH' });
      return;
    }

    let platformUser = await prisma.platformUser.findUnique({ where: { email: normalized } });
    if (platformUser) {
      const existingLink = await prisma.legacyIdentityLink.findUnique({
        where: {
          platformUserId_product: { platformUserId: platformUser.id, product: 'INSPECTION' }
        }
      });
      if (existingLink && existingLink.legacyTenantId !== tenant.id) {
        skippedConflicts.push({
          email: normalized,
          reason: 'INSPECTION_LINK_OTHER_TENANT',
          existingTenantId: existingLink.legacyTenantId
        });
        return;
      }
      platformUser = await prisma.platformUser.update({
        where: { id: platformUser.id },
        data: {
          fullName: platformUser.fullName || fullName || normalized,
          status: 'ACTIVE'
        }
      });
    } else {
      platformUser = await prisma.platformUser.create({
        data: {
          email: normalized,
          fullName: fullName || normalized,
          passwordHash,
          status: 'ACTIVE',
          isPlatformAdmin: false
        }
      });
    }

    await ensureMember(prisma, org.id, platformUser.id, 'ORGANIZATION_ADMIN');
    await ensureLink(prisma, {
      platformUserId: platformUser.id,
      organizationId: org.id,
      product: 'INSPECTION',
      legacyTenantId: tenant.id,
      legacyUserId
    });
    users.push(platformUser);
    linked.push({ email: normalized, legacyUserId });
  }

  if (linkTenantAccount) {
    const tenantEmail = String(tenant.email || '').trim().toLowerCase()
      || (tenant.passwordHash
        ? `tenant-${tenant.id.slice(0, 8)}@broker.ainspecciona.local`
        : '');
    if (tenantEmail && tenant.passwordHash) {
      await linkIdentity({
        email: tenantEmail,
        fullName: tenant.name || tenantEmail,
        passwordHash: tenant.passwordHash,
        legacyUserId: tenant.id
      });
    } else if (tenantEmail && !tenant.passwordHash) {
      skipped.push({ email: tenantEmail, reason: 'TENANT_NO_PASSWORD_HASH' });
    } else {
      skipped.push({ email: '', reason: 'TENANT_NO_EMAIL_OR_PASSWORD' });
    }
  }

  if (linkTenantAdmins) {
    const admins = await prisma.user.findMany({
      where: {
        tenantId: tenant.id,
        status: 'ACTIVE',
        role: 'TENANT_ADMIN'
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        passwordHash: true
      }
    });
    const tenantEmail = String(tenant.email || '').trim().toLowerCase();
    for (const admin of admins) {
      const adminEmail = String(admin.email || '').trim().toLowerCase();
      if (tenantEmail && adminEmail === tenantEmail) continue;
      await linkIdentity({
        email: adminEmail,
        fullName: admin.fullName || adminEmail,
        passwordHash: admin.passwordHash,
        legacyUserId: admin.id
      });
    }
  }

  return {
    organizationId: org.id,
    organizationSlug: slug,
    created: !existingOrg,
    users,
    linked,
    skippedConflicts,
    skipped
  };
}

/**
 * Login platform por RUT de corredora (Tenant).
 */
export async function tryProvisionTenantByRut(prisma, rutRaw, password) {
  if (!prisma || !rutRaw || !password) return null;
  const compact = String(rutRaw).replace(/[.\-\s]/g, '').toUpperCase();
  if (compact.length < 7) return null;
  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, email: true, rut: true, passwordHash: true },
    take: 500
  });
  const tenant = tenants.find((t) => {
    const r = String(t.rut || '').replace(/[.\-\s]/g, '').toUpperCase();
    return r && (r === compact || r === String(rutRaw).trim().toUpperCase());
  });
  if (!tenant?.passwordHash) return null;
  if (!verifyPassword(password, tenant.passwordHash)) return null;
  return provisionBrokerTenant(prisma, tenant, password);
}

export async function resolveLegacyLink(prisma, platformUserId, product) {
  if (!prisma || !platformUserId || !product) return null;
  return prisma.legacyIdentityLink.findUnique({
    where: {
      platformUserId_product: { platformUserId, product }
    }
  });
}

export { upsertOrg, ensureProduct, ensureMember, ensureLink, upsertPlatformUser, ALL_PRODUCT_CODES, hashPassword };
