/**
 * Rutas de plataforma: auth único, enter-product, Control MVP.
 */
import {
  createPlatformSession,
  destroyPlatformSession,
  getPlatformSession,
  setPlatformSessionCookies,
  clearPlatformSessionCookies,
  serializePlatformContext,
  requirePlatformAuth,
  requirePlatformAdmin,
  verifyPassword
} from './auth/session.js';
import { tryProvisionFromLegacy, tryProvisionTenantByRut } from './auth/legacyBridge.js';
import { enterProduct } from './auth/enterProduct.js';
import { PLATFORM_PRODUCTS } from './products.js';

function noStore(reply) {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  return reply;
}

export async function registerPlatformRoutes(fastify, { prisma }) {
  // Schema se asegura en el boot de server.js (evita race con otros ensure*)

  // ── Pages ──────────────────────────────────────────────
  // Login único vive en el home (modal). /login redirige ahí.
  fastify.get('/login', async (req, reply) => {
    const session = prisma ? await getPlatformSession(prisma, req) : null;
    if (session) return reply.redirect(302, '/app');
    const next = String(req.query?.next || '').trim();
    const q = new URLSearchParams({ login: '1' });
    if (next.startsWith('/') && !next.startsWith('//')) q.set('next', next);
    return reply.redirect(302, `/?${q.toString()}`);
  });

  fastify.get('/app', async (req, reply) => {
    const session = prisma ? await getPlatformSession(prisma, req) : null;
    if (!session) return reply.redirect(302, '/login?next=/app');
    return noStore(reply).sendFile('app/index.html');
  });

  fastify.get('/control', async (req, reply) => {
    const session = prisma ? await getPlatformSession(prisma, req) : null;
    if (!session) return reply.redirect(302, '/login?next=/control');
    if (!session.user.isPlatformAdmin) {
      return reply.redirect(302, '/app');
    }
    return noStore(reply).sendFile('control/index.html');
  });

  // ── Auth API ───────────────────────────────────────────
  fastify.post('/api/auth/login', async (req, reply) => {
    if (!prisma) return reply.code(503).send({ ok: false, error: 'DB_UNAVAILABLE' });

    const identifier = String(req.body?.email || req.body?.identifier || req.body?.rut || '')
      .trim();
    const password = String(req.body?.password || '');
    if (!identifier || !password) {
      return reply.code(400).send({
        ok: false,
        error: 'MISSING_FIELDS',
        message: 'Email/RUT y contraseña requeridos.'
      });
    }

    const isEmail = identifier.includes('@');
    const email = isEmail ? identifier.toLowerCase() : null;

    let user = email ? await prisma.platformUser.findUnique({ where: { email } }) : null;
    let organizationId = null;
    const platformOk =
      user && user.status === 'ACTIVE' && verifyPassword(password, user.passwordHash);

    if (platformOk) {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' }
      });
      organizationId = membership?.organizationId || null;
    } else {
      const provisioned = isEmail
        ? await tryProvisionFromLegacy(prisma, email, password)
        : await tryProvisionTenantByRut(prisma, identifier, password);
      if (!provisioned) {
        return reply.code(401).send({
          ok: false,
          error: 'INVALID_CREDENTIALS',
          message: 'Credenciales incorrectas.'
        });
      }
      user = provisioned.user;
      organizationId = provisioned.organizationId;
    }

    const token = await createPlatformSession(prisma, {
      userId: user.id,
      organizationId
    });
    setPlatformSessionCookies(req, reply, token);

    const session = await getPlatformSession(prisma, {
      headers: { 'x-platform-session': token },
      cookies: {},
      query: {}
    });

    return reply.send({
      ok: true,
      token,
      context: serializePlatformContext(session)
    });
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    if (prisma) await destroyPlatformSession(prisma, req);
    clearPlatformSessionCookies(req, reply);
    return reply.send({ ok: true });
  });

  fastify.get('/api/auth/me', async (req, reply) => {
    if (!prisma) return reply.code(503).send({ ok: false, error: 'DB_UNAVAILABLE' });
    const session = await getPlatformSession(prisma, req);
    if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
    return reply.send({ ok: true, context: serializePlatformContext(session) });
  });

  fastify.post('/api/auth/enter-product', {
    preHandler: requirePlatformAuth(prisma)
  }, async (req, reply) => {
    const product = req.body?.product || req.query?.product;
    const result = await enterProduct(prisma, req.platformSession, product, req, reply);
    if (!result.ok) return reply.code(400).send(result);
    return reply.send(result);
  });

  // ── Control API ────────────────────────────────────────
  fastify.get('/api/control/organizations', {
    preHandler: requirePlatformAdmin(prisma)
  }, async (req, reply) => {
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        products: true,
        _count: { select: { members: true, links: true } }
      }
    });
    return reply.send({
      ok: true,
      organizations: orgs.map((o) => ({
        id: o.id,
        slug: o.slug,
        name: o.name,
        type: o.type,
        status: o.status,
        memberCount: o._count.members,
        linkCount: o._count.links,
        products: o.products.map((p) => ({
          product: p.product,
          status: p.status,
          plan: p.plan
        }))
      })),
      catalog: PLATFORM_PRODUCTS
    });
  });

  fastify.patch('/api/control/organizations/:orgId/products/:product', {
    preHandler: requirePlatformAdmin(prisma)
  }, async (req, reply) => {
    const orgId = String(req.params.orgId || '');
    const product = String(req.params.product || '').toUpperCase();
    const status = String(req.body?.status || '').toUpperCase();
    if (!PLATFORM_PRODUCTS[product]) {
      return reply.code(400).send({ ok: false, error: 'UNKNOWN_PRODUCT' });
    }
    if (!['ENABLED', 'DISABLED'].includes(status)) {
      return reply.code(400).send({ ok: false, error: 'INVALID_STATUS' });
    }

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

    const row = await prisma.organizationProduct.upsert({
      where: { organizationId_product: { organizationId: orgId, product } },
      create: {
        organizationId: orgId,
        product,
        status,
        startedAt: status === 'ENABLED' ? new Date() : null
      },
      update: {
        status,
        startedAt: status === 'ENABLED' ? new Date() : undefined
      }
    });

    return reply.send({ ok: true, product: row });
  });

  fastify.get('/api/control/users', {
    preHandler: requirePlatformAdmin(prisma)
  }, async (req, reply) => {
    const users = await prisma.platformUser.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        memberships: { include: { organization: true } },
        links: true
      }
    });
    return reply.send({
      ok: true,
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        status: u.status,
        isPlatformAdmin: u.isPlatformAdmin,
        organizations: u.memberships.map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          role: m.role
        })),
        products: u.links.map((l) => l.product)
      }))
    });
  });
}
