/**
 * Auth portal In & Out (cookie inout_session + Session type=inout).
 * Acepta también sesión platform con LegacyIdentityLink INOUT.
 */
import crypto from 'node:crypto';
import { getPlatformSession } from '../platform/auth/session.js';
import { resolveLegacyLink } from '../platform/auth/legacyBridge.js';

export const IO_SESSION_COOKIE = 'inout_session';
export const IO_SESSION_TYPE = 'inout';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function sessionCookieOpts(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-ssl'] || '')
    .toString()
    .split(',')[0]
    .trim()
    .toLowerCase();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim().toLowerCase();
  const isLocalhost = !host || host === 'localhost' || host.startsWith('127.0.0.1') || host.includes(':3000');
  const isSecure = !isLocalhost && (proto === 'https' || process.env.NODE_ENV === 'production');
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: 60 * 60 * 24 * 7
  };
}

/** Tokens candidatos (header de producto primero; hub TOC TOC vive en `__session`). */
function collectSessionTokens(req) {
  const out = [];
  const add = (raw) => {
    const t = String(raw || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(req.headers['x-inout-session']);
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) add(auth.slice(7));
  add(req.query?.token);
  add(req.cookies?.[IO_SESSION_COOKIE]);
  // Último: login directo In & Out vía Firebase (sin TOC TOC)
  add(req.cookies?.__session);
  return out;
}

function getSessionToken(req) {
  return collectSessionTokens(req)[0] || null;
}

export async function createIoSession(prisma, { tenantId, userId }) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      token,
      type: IO_SESSION_TYPE,
      tenantId,
      userId,
      expiresAt
    }
  });
  return token;
}

export async function destroyIoSession(prisma, req) {
  const tokens = collectSessionTokens(req);
  if (!tokens.length) return;
  await prisma.session.deleteMany({ where: { token: { in: tokens }, type: IO_SESSION_TYPE } }).catch(() => {});
}

export async function getIoSession(prisma, req) {
  if (!prisma) return null;
  for (const token of collectSessionTokens(req)) {
    const row = await prisma.session.findFirst({
      where: { token, type: IO_SESSION_TYPE }
    });
    if (!row) continue;
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
      continue;
    }

    const user = await prisma.ioUser.findFirst({
      where: { id: row.userId, status: 'ACTIVE' },
      include: { tenant: true }
    });
    if (!user || !user.tenant || user.tenant.status !== 'ACTIVE') {
      await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
      continue;
    }

    return {
      tenantId: user.tenantId,
      userId: user.id,
      user,
      tenant: user.tenant
    };
  }

  const platform = await getPlatformSession(prisma, req);
  if (platform) {
    const link = await resolveLegacyLink(prisma, platform.user.id, 'INOUT');
    if (link) {
      const user = await prisma.ioUser.findFirst({
        where: { id: link.legacyUserId, status: 'ACTIVE' },
        include: { tenant: true }
      });
      if (user && user.tenant && user.tenant.status === 'ACTIVE') {
        return {
          tenantId: user.tenantId,
          userId: user.id,
          user,
          tenant: user.tenant,
          viaPlatform: true
        };
      }
    }
  }

  return null;
}

export function requireIoAuth(prisma) {
  return async function ioAuthGuard(req, reply) {
    if (!prisma) {
      return reply.code(503).send({ ok: false, error: 'DB_UNAVAILABLE' });
    }
    const session = await getIoSession(prisma, req);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED', message: 'Debes iniciar sesión en In & Out.' });
    }
    req.ioSession = session;
  };
}

export const IO_ROLES = ['ADMIN', 'OPERATOR', 'INSPECTOR'];

export function normalizeIoRole(raw) {
  const u = String(raw || '').trim().toUpperCase();
  if (u === 'ADMINISTRADOR' || u === 'ADMIN') return 'ADMIN';
  if (u === 'OPERADOR' || u === 'OPERATOR' || u === 'EXECUTIVE') return 'OPERATOR';
  if (u === 'INSPECTOR') return 'INSPECTOR';
  return null;
}
