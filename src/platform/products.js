/** Catálogo de productos de plataforma (UI + redirects). */

export const PLATFORM_PRODUCTS = {
  INSPECTION: {
    code: 'INSPECTION',
    label: 'Inspección (Capture)',
    href: '/tenant',
    loginHref: '/tenant'
  },
  RECEPTION: {
    code: 'RECEPTION',
    label: 'Recepción Técnica',
    href: '/entrega',
    loginHref: '/entrega/login'
  },
  POSTSALE: {
    code: 'POSTSALE',
    label: 'Postventa',
    href: '/postventa',
    loginHref: '/postventa/login'
  },
  INOUT: {
    code: 'INOUT',
    label: 'In & Out',
    href: '/inout/portal',
    loginHref: '/inout/portal/login'
  },
  SCAN: {
    code: 'SCAN',
    label: 'Scan',
    href: '/scan',
    loginHref: '/scan'
  }
};

export const ALL_PRODUCT_CODES = Object.keys(PLATFORM_PRODUCTS);
