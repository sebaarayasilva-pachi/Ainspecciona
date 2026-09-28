import {
  ALL_PRODUCT_CODES,
  MODULE_NAV,
  PLATFORM_PRODUCTS,
  productSlug
} from '../products.js';

/**
 * Catálogo de módulos para el hub: activo | contratado | disponible.
 * SCAN no exige LegacyIdentityLink.
 */
export function buildOrgModules(session) {
  const org = session?.organization || null;
  const enabled = new Set(session?.enabledProducts || []);
  const orgId = org?.id || null;
  const linked = new Set(
    (session?.links || [])
      .filter((l) => !l.organizationId || l.organizationId === orgId)
      .map((l) => l.product)
  );

  return ALL_PRODUCT_CODES.map((code) => {
    const meta = PLATFORM_PRODUCTS[code] || {};
    const items = MODULE_NAV[code] || [];
    let state = 'disponible';
    if (enabled.has(code)) {
      state = code === 'SCAN' || linked.has(code) ? 'activo' : 'contratado';
    }
    return {
      code,
      slug: productSlug(code),
      label: meta.label || code,
      state,
      items
    };
  });
}
