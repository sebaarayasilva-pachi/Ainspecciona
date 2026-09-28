/**
 * Si el email ya es IoUser en otro tenant, pero pertenece a la misma org
 * (miembro platform o ejecutivo del Tenant Capture), se puede mover aquí.
 */

export async function findOrgIdForIoTenant(prisma, ioTenantId) {
  const link = await prisma.legacyIdentityLink.findFirst({
    where: { product: 'INOUT', legacyTenantId: String(ioTenantId) },
    select: { organizationId: true }
  });
  if (link?.organizationId) return link.organizationId;

  const ioTenant = await prisma.ioTenant.findUnique({
    where: { id: String(ioTenantId) },
    select: { name: true }
  });
  const baseName = String(ioTenant?.name || '').replace(/\s+InOut$/i, '').trim();
  if (!baseName) return null;
  const org = await prisma.organization.findFirst({
    where: { name: baseName },
    select: { id: true }
  });
  return org?.id || null;
}

export async function emailBelongsToOrganization(prisma, email, organizationId) {
  if (!email || !organizationId) return false;
  const member = await prisma.organizationMember.findFirst({
    where: { organizationId, user: { email } },
    select: { id: true }
  });
  if (member) return true;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true }
  });
  if (!org?.name) return false;
  const cap = await prisma.user.findUnique({
    where: { email },
    select: { tenant: { select: { name: true } } }
  });
  return Boolean(cap?.tenant?.name && cap.tenant.name === org.name);
}

export async function upsertInOutLegacyLink(prisma, { email, organizationId, ioTenantId, ioUserId }) {
  const platformUser = await prisma.platformUser.findUnique({
    where: { email },
    select: { id: true }
  });
  if (!platformUser || !organizationId) return null;
  return prisma.legacyIdentityLink.upsert({
    where: {
      platformUserId_product: { platformUserId: platformUser.id, product: 'INOUT' }
    },
    create: {
      platformUserId: platformUser.id,
      organizationId,
      product: 'INOUT',
      legacyTenantId: ioTenantId,
      legacyUserId: ioUserId
    },
    update: {
      organizationId,
      legacyTenantId: ioTenantId,
      legacyUserId: ioUserId
    }
  });
}
