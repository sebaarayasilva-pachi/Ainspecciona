/**
 * Resuelve nombres de tenants legacy por producto + id.
 */
import { PLATFORM_PRODUCTS } from '../products.js';

export async function resolveLegacyTenantNames(prisma, links) {
  const byProduct = {
    INSPECTION: new Set(),
    RECEPTION: new Set(),
    POSTSALE: new Set(),
    INOUT: new Set(),
    SCAN: new Set()
  };
  for (const l of links) {
    if (byProduct[l.product]) byProduct[l.product].add(l.legacyTenantId);
  }

  const nameByKey = new Map();

  async function load(product, ids, finder) {
    if (!ids.size) return;
    const rows = await finder([...ids]).catch(() => []);
    for (const row of rows) {
      nameByKey.set(`${product}:${row.id}`, row.name || null);
    }
  }

  await Promise.all([
    load('INSPECTION', byProduct.INSPECTION, (ids) =>
      prisma.tenant.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true }
      })
    ),
    load('RECEPTION', byProduct.RECEPTION, (ids) =>
      prisma.entregaTenant.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true }
      })
    ),
    load('POSTSALE', byProduct.POSTSALE, (ids) =>
      prisma.pvTenant.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true }
      })
    ),
    load('INOUT', byProduct.INOUT, (ids) =>
      prisma.ioTenant.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true }
      })
    ),
    load('SCAN', byProduct.SCAN, (ids) =>
      prisma.scanOrg
        .findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true }
        })
        .catch(() => [])
    )
  ]);

  return nameByKey;
}

export function productLabel(code) {
  return PLATFORM_PRODUCTS[code]?.label || code;
}
