/**
 * Emite sesión legacy de producto a partir de sesión platform + LegacyIdentityLink.
 */
import crypto from 'node:crypto';
import { createPvPortalSession, PV_PORTAL_SESSION_COOKIE } from '../../postventa/auth/portalAuth.js';
import { createEntregaSession, ENTREGA_SESSION_COOKIE } from '../../entrega/auth.js';
import { createIoSession, IO_SESSION_COOKIE } from '../../inout/auth.js';
import { resolveLegacyLink } from './legacyBridge.js';
import { sessionCookieOpts } from './passwords.js';
import { PLATFORM_PRODUCTS } from '../products.js';

const TENANT_SESSION_COOKIE = 'tenant_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const STORAGE_KEYS = {
  POSTSALE: 'postventa_session',
  RECEPTION: 'entrega_session',
  INOUT: 'inout_session',
  INSPECTION: 'tenant_session'
};

const COOKIE_NAMES = {
  POSTSALE: PV_PORTAL_SESSION_COOKIE,
  RECEPTION: ENTREGA_SESSION_COOKIE,
  INOUT: IO_SESSION_COOKIE,
  INSPECTION: TENANT_SESSION_COOKIE
};

async function createTenantSession(prisma, tenantId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { token, type: 'tenant', tenantId, expiresAt }
  });
  return token;
}

/**
 * @returns {Promise<{ ok: true, product: string, token: string, href: string, storageKey: string|null, storage?: string } | { ok: false, error: string, message: string }>}
 */
export async function enterProduct(prisma, platformSession, productCode, req, reply) {
  const product = String(productCode || '').toUpperCase();
  const meta = PLATFORM_PRODUCTS[product];
  if (!meta) {
    return { ok: false, error: 'UNKNOWN_PRODUCT', message: 'Producto no reconocido.' };
  }

  const org = platformSession.organization;
  if (!org || org.status !== 'ACTIVE') {
    return { ok: false, error: 'ORG_INACTIVE', message: 'Organización inactiva o no asignada.' };
  }
  const enabled = platformSession.enabledProducts || [];
  if (!enabled.includes(product)) {
    return { ok: false, error: 'PRODUCT_DISABLED', message: 'Producto no habilitado para esta organización.' };
  }

  if (product === 'SCAN') {
    return {
      ok: true,
      product,
      token: platformSession.token,
      href: meta.href,
      storageKey: null,
      note: 'redirect_only'
    };
  }

  const link = await resolveLegacyLink(prisma, platformSession.user.id, product);
  if (!link) {
    return {
      ok: false,
      error: 'NO_LEGACY_LINK',
      message: 'No hay cuenta de producto vinculada. Contacta a soporte Ainspecciona.'
    };
  }

  let token;
  let storage = 'session';
  if (product === 'POSTSALE') {
    token = await createPvPortalSession(prisma, {
      tenantId: link.legacyTenantId,
      userId: link.legacyUserId
    });
  } else if (product === 'RECEPTION') {
    token = await createEntregaSession(prisma, {
      tenantId: link.legacyTenantId,
      userId: link.legacyUserId
    });
  } else if (product === 'INOUT') {
    token = await createIoSession(prisma, {
      tenantId: link.legacyTenantId,
      userId: link.legacyUserId
    });
  } else if (product === 'INSPECTION') {
    token = await createTenantSession(prisma, link.legacyTenantId);
    storage = 'local';
  } else {
    return { ok: false, error: 'UNSUPPORTED', message: 'Producto sin bridge aún.' };
  }

  const opts = sessionCookieOpts(req);
  const cookieName = COOKIE_NAMES[product];
  if (cookieName) reply.setCookie(cookieName, token, opts);
  // Mantener __session como sesión de plataforma.

  return {
    ok: true,
    product,
    token,
    href: meta.href,
    storageKey: STORAGE_KEYS[product] || null,
    storage
  };
}
