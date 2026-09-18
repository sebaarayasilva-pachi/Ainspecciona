/**
 * ScanOrg por organización de plataforma (no el dump scan-demo).
 */
import { ensureScanSchema } from './ensureScanSchema.js';

export function scanOrgSlugFromPlatform(organization) {
  const raw = String(organization?.slug || '').trim().toLowerCase();
  if (raw) return raw.slice(0, 64);
  const id = String(organization?.id || '').replace(/-/g, '').slice(0, 8);
  return id ? `org-${id}` : 'scan-org';
}

export function canUseScan(session) {
  if (!session?.user) return false;
  if (session.user.isPlatformAdmin || session.isPlatformAdmin) return true;
  return Array.isArray(session.enabledProducts) && session.enabledProducts.includes('SCAN');
}

export function scanLinkForSession(session) {
  const orgId = session?.organization?.id || null;
  return (session?.links || []).find((l) => {
    if (String(l.product || '').toUpperCase() !== 'SCAN') return false;
    return !l.organizationId || !orgId || l.organizationId === orgId;
  }) || null;
}

export async function ensureScanOrgForPlatform(prisma, organization) {
  await ensureScanSchema(prisma);
  const slug = scanOrgSlugFromPlatform(organization);
  const name = `${String(organization?.name || 'Scan').slice(0, 170)} Scan`.slice(0, 191);
  let tenant = await prisma.scanOrg.findUnique({ where: { slug } });
  if (!tenant) {
    tenant = await prisma.scanOrg.create({
      data: { slug, name, status: 'ACTIVE' }
    });
  } else if (tenant.status !== 'ACTIVE') {
    tenant = await prisma.scanOrg.update({
      where: { id: tenant.id },
      data: { status: 'ACTIVE' }
    });
  }
  return tenant;
}

export async function resolveScanOrgForSession(prisma, session) {
  if (!prisma || !session?.organization) return null;
  const link = scanLinkForSession(session);
  if (link?.legacyTenantId) {
    const linked = await prisma.scanOrg.findUnique({ where: { id: link.legacyTenantId } });
    if (linked) return linked;
  }
  return ensureScanOrgForPlatform(prisma, session.organization);
}
