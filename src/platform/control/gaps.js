/**
 * Gaps operativos para Control: productos ENABLED sin link, Capture huérfanos.
 */
import { productLabel } from './legacyLookup.js';

export async function collectControlGaps(prisma) {
  const orgs = await prisma.organization.findMany({
    include: {
      products: true,
      links: true
    },
    orderBy: { name: 'asc' }
  });

  const productsWithoutLink = [];
  for (const org of orgs) {
    const linked = new Set(org.links.map((l) => l.product));
    for (const p of org.products) {
      if (p.status !== 'ENABLED') continue;
      if (linked.has(p.product)) continue;
      productsWithoutLink.push({
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
        product: p.product,
        productLabel: productLabel(p.product)
      });
    }
  }

  const captureTenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' }
  });
  const inspectionLinks = await prisma.legacyIdentityLink.findMany({
    where: { product: 'INSPECTION' },
    select: { legacyTenantId: true }
  });
  const linkedCapture = new Set(inspectionLinks.map((l) => l.legacyTenantId));
  const captureOrphans = captureTenants
    .filter((t) => !linkedCapture.has(t.id))
    .map((t) => ({
      tenantId: t.id,
      tenantName: t.name,
      tenantEmail: t.email || null,
      product: 'INSPECTION',
      productLabel: productLabel('INSPECTION')
    }));

  return {
    productsWithoutLink,
    captureOrphans,
    counts: {
      productsWithoutLink: productsWithoutLink.length,
      captureOrphans: captureOrphans.length,
      total: productsWithoutLink.length + captureOrphans.length
    }
  };
}
