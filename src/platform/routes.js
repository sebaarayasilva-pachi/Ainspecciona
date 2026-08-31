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
import { APP_TENANT_PRODUCTS, PLATFORM_PRODUCTS } from './products.js';
import { resolveLegacyTenantNames, productLabel } from './control/legacyLookup.js';
import { collectControlGaps } from './control/gaps.js';
import { provisionProductAccess } from './control/provisionProduct.js';
import { createOrganizationFromControl } from './control/createOrganization.js';
import { addOrganizationMember } from './control/addOrganizationMember.js';
import { PLATFORM_NDA_VERSION, ndaStatusForSession } from './nda.js';

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

  // Tenant door: /app/{producto} → login o entra al módulo. URLs legacy no se tocan.
  for (const product of APP_TENANT_PRODUCTS) {
    fastify.get(product.app, async (req, reply) => {
      const session = prisma ? await getPlatformSession(prisma, req) : null;
      if (!session) {
        return reply.redirect(302, `/login?next=${encodeURIComponent(product.app)}`);
      }
      return reply.redirect(302, `/app?enter=${encodeURIComponent(product.code)}`);
    });
  }

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
    // Reafirmar __session como token de plataforma (Firebase Hosting solo reenvía esa cookie).
    // Evita que un login de producto previo deje /app o /control sin sesión.
    setPlatformSessionCookies(req, reply, session.token);
    return reply.send({ ok: true, context: serializePlatformContext(session) });
  });

  fastify.post('/api/auth/accept-nda', {
    preHandler: requirePlatformAuth(prisma)
  }, async (req, reply) => {
    const session = req.platformSession;
    const status = ndaStatusForSession(session);
    if (!status.required) {
      return reply.send({
        ok: true,
        nda: status,
        context: serializePlatformContext(session),
        message: 'NDA no requerido para esta organización.'
      });
    }
    const updated = await prisma.platformUser.update({
      where: { id: session.user.id },
      data: {
        ndaAcceptedAt: new Date(),
        ndaVersion: PLATFORM_NDA_VERSION
      }
    });
    session.user.ndaAcceptedAt = updated.ndaAcceptedAt;
    session.user.ndaVersion = updated.ndaVersion;
    return reply.send({
      ok: true,
      nda: ndaStatusForSession(session),
      context: serializePlatformContext(session)
    });
  });

  fastify.post('/api/auth/enter-product', {
    preHandler: requirePlatformAuth(prisma)
  }, async (req, reply) => {
    const nda = ndaStatusForSession(req.platformSession);
    if (nda.required && !nda.accepted) {
      return reply.code(403).send({
        ok: false,
        error: 'NDA_REQUIRED',
        message: 'Debes aceptar el Acuerdo de Confidencialidad antes de continuar.',
        nda
      });
    }
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

  fastify.post('/api/control/organizations', {
    preHandler: requirePlatformAdmin(prisma)
  }, async (req, reply) => {
    const result = await createOrganizationFromControl(prisma, req.body || {});
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return reply.code(201).send(result);
  });

  fastify.get('/api/control/organizations/:orgId', {
    preHandler: requirePlatformAdmin(prisma)
  }, async (req, reply) => {
    const orgId = String(req.params.orgId || '');
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        products: true,
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                status: true,
                isPlatformAdmin: true
              }
            }
          }
        },
        links: {
          include: {
            platformUser: {
              select: { id: true, email: true, fullName: true, status: true }
            }
          }
        }
      }
    });
    if (!org) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

    const nameByKey = await resolveLegacyTenantNames(prisma, org.links);
    const linkedProducts = new Set(org.links.map((l) => l.product));
    const products = org.products.map((p) => ({
      product: p.product,
      label: productLabel(p.product),
      status: p.status,
      plan: p.plan,
      hasLink: linkedProducts.has(p.product)
    }));
    const productsWithoutLink = products
      .filter((p) => p.status === 'ENABLED' && !p.hasLink)
      .map((p) => p.product);

    return reply.send({
      ok: true,
      catalog: PLATFORM_PRODUCTS,
      organization: {
        id: org.id,
        slug: org.slug,
        name: org.name,
        type: org.type,
        status: org.status,
        products,
        productsWithoutLink,
        members: org.members.map((m) => ({
          id: m.id,
          role: m.role,
          status: m.status,
          user: m.user
        })),
        links: org.links.map((l) => ({
          id: l.id,
          product: l.product,
          productLabel: productLabel(l.product),
          legacyTenantId: l.legacyTenantId,
          legacyUserId: l.legacyUserId,
          legacyTenantName: nameByKey.get(`${l.product}:${l.legacyTenantId}`) || null,
          platformUserEmail: l.platformUser.email,
          platformUserId: l.platformUser.id,
          platformUserStatus: l.platformUser.status
        }))
      }
    });
  });

  fastify.patch('/api/control/organizations/:orgId', {
    preHandler: requirePlatformAdmin(prisma)
  }, async (req, reply) => {
    const orgId = String(req.params.orgId || '');
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

    const data = {};
    if (req.body?.name != null) {
      const name = String(req.body.name).trim();
      if (!name) return reply.code(400).send({ ok: false, error: 'INVALID_NAME' });
      data.name = name;
    }
    if (req.body?.status != null) {
      let status = String(req.body.status).toUpperCase();
      if (status === 'SUSPENDED') status = 'DISABLED';
      if (!['ACTIVE', 'DISABLED'].includes(status)) {
        return reply.code(400).send({ ok: false, error: 'INVALID_STATUS' });
      }
      data.status = status;
    }
    if (!Object.keys(data).length) {
      return reply.code(400).send({ ok: false, error: 'NO_CHANGES' });
    }

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data
    });
    return reply.send({
      ok: true,
      organization: {
        id: updated.id,
        slug: updated.slug,
        name: updated.name,
        type: updated.type,
        status: updated.status
      }
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

    let provision = null;
    if (status === 'ENABLED') {
      const existingLinks = await prisma.legacyIdentityLink.count({
        where: { organizationId: orgId, product }
      });
      if (existingLinks === 0) {
        provision = await provisionProductAccess(prisma, org, product);
      }
    }

    const linkCount = await prisma.legacyIdentityLink.count({
      where: { organizationId: orgId, product }
    });
    const hasLink = linkCount > 0;
    const warning =
      status === 'ENABLED' && !hasLink
        ? provision?.message ||
          'Producto activo sin vínculo legacy — el cliente no lo verá en /app hasta crear link'
        : null;

    return reply.send({
      ok: true,
      product: {
        product: row.product,
        status: row.status,
        plan: row.plan,
        hasLink
      },
      provision,
      warning,
      message: hasLink && provision?.ok ? provision.message : undefined
    });
  });

  fastify.post('/api/control/organizations/:orgId/products/:product/provision', {
    preHandler: requirePlatformAdmin(prisma)
  }, async (req, reply) => {
    const orgId = String(req.params.orgId || '');
    const product = String(req.params.product || '').toUpperCase();
    if (!PLATFORM_PRODUCTS[product]) {
      return reply.code(400).send({ ok: false, error: 'UNKNOWN_PRODUCT' });
    }
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

    const op = await prisma.organizationProduct.findUnique({
      where: { organizationId_product: { organizationId: orgId, product } }
    });
    if (!op || op.status !== 'ENABLED') {
      return reply.code(400).send({
        ok: false,
        error: 'PRODUCT_NOT_ENABLED',
        message: 'Activa el producto antes de vincular.'
      });
    }

    const provision = await provisionProductAccess(prisma, org, product);
    const linkCount = await prisma.legacyIdentityLink.count({
      where: { organizationId: orgId, product }
    });
    return reply.send({
      ok: !!provision.ok && linkCount > 0,
      provision,
      hasLink: linkCount > 0,
      warning: linkCount === 0 ? provision.message : null,
      message: provision.message
    });
  });

  fastify.post('/api/control/organizations/:orgId/members', {
    preHandler: requirePlatformAdmin(prisma)
  }, async (req, reply) => {
    const orgId = String(req.params.orgId || '');
    const result = await addOrganizationMember(prisma, orgId, {
      email: req.body?.email,
      password: req.body?.password,
      fullName: req.body?.fullName,
      role: req.body?.role || 'ORGANIZATION_ADMIN'
    });
    if (!result.ok) {
      const code = result.error === 'NOT_FOUND' ? 404 : 400;
      return reply.code(code).send(result);
    }
    return reply.send(result);
  });

  fastify.get('/api/control/gaps', {
    preHandler: requirePlatformAdmin(prisma)
  }, async (req, reply) => {
    const gaps = await collectControlGaps(prisma);
    return reply.send({ ok: true, ...gaps });
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
