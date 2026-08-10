/**
 * Sesión de plataforma (login único).
 * Cookie __session para Firebase Hosting → Cloud Run.
 */
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, sessionCookieOpts } from './passwords.js';
import { PLATFORM_PRODUCTS } from '../products.js';

export const PLATFORM_SESSION_COOKIE = 'platform_session';
export const PLATFORM_SESSION_TYPE = 'platform';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export { hashPassword, verifyPassword, sessionCookieOpts };

function collectTokens(req) {
  const out = [];
  const add = (raw) => {
    const t = String(raw || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(req.headers['x-platform-session']);
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) add(auth.slice(7));
  add(req.query?.token);
  add(req.cookies?.[PLATFORM_SESSION_COOKIE]);
  add(req.cookies?.__session);
  return out;
}

export async function createPlatformSession(prisma, { userId, organizationId }) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      token,
      type: PLATFORM_SESSION_TYPE,
      userId,
      tenantId: organizationId || null,
      expiresAt
    }
  });
  return token;
}

export async function destroyPlatformSession(prisma, req) {
  const tokens = collectTokens(req);
  if (!tokens.length) return;
  await prisma.session
    .deleteMany({ where: { token: { in: tokens }, type: PLATFORM_SESSION_TYPE } })
    .catch(() => {});
}

export function setPlatformSessionCookies(req, reply, token) {
  const opts = sessionCookieOpts(req);
  reply.setCookie(PLATFORM_SESSION_COOKIE, token, opts);
  reply.setCookie('__session', token, opts);
}

export function clearPlatformSessionCookies(req, reply) {
  const opts = { ...sessionCookieOpts(req), maxAge: 0 };
  reply.clearCookie(PLATFORM_SESSION_COOKIE, opts);
  reply.clearCookie('__session', opts);
}

/**
 * @returns {Promise<null | {
 *   token: string,
 *   user: object,
 *   organization: object | null,
 *   membership: object | null,
 *   enabledProducts: string[],
 *   links: object[]
 * }>}
 */
export async function getPlatformSession(prisma, req) {
  if (!prisma) return null;

  for (const token of collectTokens(req)) {
    const row = await prisma.session.findFirst({
      where: { token, type: PLATFORM_SESSION_TYPE }
    });
    if (!row) continue;
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
      continue;
    }

    const user = await prisma.platformUser.findFirst({
      where: { id: row.userId, status: 'ACTIVE' },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: {
            organization: {
              include: {
                products: { where: { status: 'ENABLED' } }
              }
            }
          }
        },
        links: true
      }
    });
    if (!user) {
      await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
      continue;
    }

    let membership = null;
    if (row.tenantId) {
      membership = user.memberships.find((m) => m.organizationId === row.tenantId) || null;
    }
    if (!membership) membership = user.memberships[0] || null;

    const organization = membership?.organization || null;
    const enabledProducts = organization
      ? organization.products.map((p) => p.product)
      : [];

    return {
      token,
      user,
      organization,
      membership,
      enabledProducts,
      links: user.links || [],
      isPlatformAdmin: !!user.isPlatformAdmin
    };
  }
  return null;
}

export function serializePlatformContext(session) {
  if (!session) return null;
  const products = (session.enabledProducts || []).map((code) => ({
    code,
    label: PLATFORM_PRODUCTS[code]?.label || code,
    href: PLATFORM_PRODUCTS[code]?.href || '/app'
  }));
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      isPlatformAdmin: !!session.user.isPlatformAdmin
    },
    organization: session.organization
      ? {
          id: session.organization.id,
          slug: session.organization.slug,
          name: session.organization.name,
          type: session.organization.type
        }
      : null,
    membership: session.membership
      ? { id: session.membership.id, role: session.membership.role }
      : null,
    enabledProducts: session.enabledProducts || [],
    products,
    token: session.token
  };
}

export function requirePlatformAuth(prisma) {
  return async function platformAuthGuard(req, reply) {
    if (!prisma) {
      return reply.code(503).send({ ok: false, error: 'DB_UNAVAILABLE' });
    }
    const session = await getPlatformSession(prisma, req);
    if (!session) {
      return reply.code(401).send({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'Debes iniciar sesión en Ainspecciona.'
      });
    }
    req.platformSession = session;
  };
}

export function requirePlatformAdmin(prisma) {
  return async function platformAdminGuard(req, reply) {
    if (!prisma) {
      return reply.code(503).send({ ok: false, error: 'DB_UNAVAILABLE' });
    }
    const session = await getPlatformSession(prisma, req);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
    }
    if (!session.user.isPlatformAdmin) {
      return reply.code(403).send({ ok: false, error: 'FORBIDDEN', message: 'Solo Control Ainspecciona.' });
    }
    req.platformSession = session;
  };
}
