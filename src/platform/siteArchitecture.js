/**
 * Mapa del sitio Ainspecciona.
 *
 * Dos capas, no se mezclan:
 * - Marketing: explica y vende. URLs /productos/{slug}.
 * - Tenant: opera el producto. Se entra por /app. Las URLs viejas
 *   (/entrega, /postventa, /tenant, /inout, /scan) siguen vivas
 *   hasta que se reubiquen bajo /app.
 */

export const SITE_LAYERS = {
  marketing: {
    home: '/',
    precios: '/precios',
    contacto: '/contacto.html',
    faq: '/faq.html'
  },
  tenant: {
    hub: '/app'
  }
};

export const SITE_PRODUCTS = [
  {
    id: 'recepcion-inmobiliaria',
    code: 'RECEPTION',
    name: 'Recepción Inmobiliaria',
    marketing: '/productos/recepcion-inmobiliaria',
    app: '/app/recepcion',
    tenant: '/entrega',
    tenantLogin: '/entrega/login'
  },
  {
    id: 'postventa',
    code: 'POSTSALE',
    name: 'Postventa',
    marketing: '/productos/postventa',
    app: '/app/postventa',
    tenant: '/postventa',
    tenantLogin: '/postventa/login'
  },
  {
    id: 'inspeccion-score',
    code: 'INSPECTION',
    name: 'Inspección Score',
    marketing: '/productos/inspeccion-score',
    app: '/app/score',
    tenant: '/tenant',
    tenantLogin: '/tenant'
  },
  {
    id: 'inspeccion-full-check',
    code: null,
    name: 'Inspección Full Check',
    marketing: '/productos/inspeccion-full-check',
    app: null,
    tenant: null,
    tenantLogin: null
  },
  {
    id: 'in-out',
    code: 'INOUT',
    name: 'In & Out',
    marketing: '/productos/in-out',
    app: '/app/inout',
    tenant: '/inout',
    tenantLogin: '/inout/portal/login'
  },
  {
    id: 'property-scan',
    code: 'SCAN',
    name: 'Property Scan',
    marketing: '/productos/property-scan',
    app: '/app/scan',
    tenant: '/scan',
    tenantLogin: '/scan'
  }
];

export const PLATFORM_PRODUCTS = Object.fromEntries(
  SITE_PRODUCTS.filter((p) => p.code).map((p) => [
    p.code,
    {
      code: p.code,
      label: p.name,
      href: p.tenant,
      loginHref: p.tenantLogin,
      marketingHref: p.marketing,
      appHref: p.app
    }
  ])
);

export const ALL_PRODUCT_CODES = Object.keys(PLATFORM_PRODUCTS);

export const APP_TENANT_PRODUCTS = SITE_PRODUCTS.filter((p) => p.app && p.code);

/** Slug de /app/{slug} por código de producto. */
export const APP_PRODUCT_SLUGS = Object.fromEntries(
  APP_TENANT_PRODUCTS.map((p) => [p.code, p.app.replace(/^\/app\//, '')])
);

/**
 * Opciones del acordeón en el hub. Sin Usuarios: el equipo vive en /app/usuarios.
 * href es la URL legacy que se carga en el panel con ?embed=1.
 */
export const MODULE_NAV = {
  INOUT: [
    { key: 'dashboard', label: 'Dashboard', href: '/inout/portal' },
    { key: 'captura', label: 'Captura', href: '/inout/captura' }
  ],
  RECEPTION: [
    { key: 'overview', label: 'Overview', href: '/entrega/proyecto' },
    { key: 'pisos', label: 'Pisos', href: '/entrega/piso' },
    { key: 'unidades', label: 'Unidades', href: '/entrega/unidad' },
    { key: 'ot', label: 'OT', href: '/entrega/ot' },
    { key: 'reportes', label: 'Reportes', href: '/entrega/reportes' }
  ],
  POSTSALE: [
    { key: 'portafolio', label: 'Portafolio', href: '/postventa/portal' },
    { key: 'tickets', label: 'Tickets', href: '/postventa/portal/mis-tickets' },
    { key: 'proyecto', label: 'Proyecto', href: '/postventa/portal' }
  ],
  INSPECTION: [
    { key: 'inspections', label: 'Inspecciones', href: '/tenant', hash: 'inspections' },
    { key: 'cuenta', label: 'Cuenta', href: '/tenant', hash: 'cuenta' },
    { key: 'credits', label: 'Créditos', href: '/tenant', hash: 'credits' }
  ],
  SCAN: [{ key: 'recorridos', label: 'Recorridos', href: '/scan' }]
};

export function productSlug(code) {
  return APP_PRODUCT_SLUGS[code] || String(code || '').toLowerCase();
}

export function productBySlug(slug) {
  const key = String(slug || '').trim().toLowerCase();
  return APP_TENANT_PRODUCTS.find((p) => p.app === `/app/${key}`) || null;
}

/** URL legacy + embed=1 (+ hash / token de Score). */
export function embedUrlForItem(item, { token } = {}) {
  if (!item?.href) return '/app';
  const u = new URL(item.href, 'https://ainspecciona.local');
  u.searchParams.set('embed', '1');
  if (token && item.href.startsWith('/tenant')) {
    u.searchParams.set('t', token);
  }
  const hash = item.hash ? `#${item.hash}` : '';
  return `${u.pathname}${u.search}${hash}`;
}
