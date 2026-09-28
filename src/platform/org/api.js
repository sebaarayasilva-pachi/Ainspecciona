/**
 * APIs de organización para el hub /app.
 * El tenant no puede prender productos: solo solicitar.
 */
import { requirePlatformAuth } from '../auth/session.js';
import { PLATFORM_PRODUCTS, productBySlug } from '../products.js';
import { sendProductRequestEmail } from '../../email.js';
import { inviteOrgMember } from './inviteMember.js';
import { buildOrgModules } from './buildModules.js';

function canManageOrg(session) {
  if (!session) return false;
  if (session.user?.isPlatformAdmin) return true;
  return session.membership?.role === 'ORGANIZATION_ADMIN';
}

function requireOrg(req, reply) {
  const session = req.platformSession;
  if (!session?.organization) {
    reply.code(400).send({
      ok: false,
      error: 'NO_ORGANIZATION',
      message: 'Tu usuario no está en una organización.'
    });
    return null;
  }
  if (session.organization.status !== 'ACTIVE') {
    reply.code(403).send({
      ok: false,
      error: 'ORG_INACTIVE',
      message: 'La organización está inactiva.'
    });
    return null;
  }
  return session;
}

export async function registerOrgRoutes(fastify, { prisma }) {
  fastify.get('/api/org/me', {
    preHandler: requirePlatformAuth(prisma)
  }, async (req, reply) => {
    const session = requireOrg(req, reply);
    if (!session) return;
    const org = session.organization;
    return reply.send({
      ok: true,
      organization: {
        id: org.id,
        slug: org.slug,
        name: org.name,
        type: org.type,
        status: org.status
      },
      role: session.membership?.role || null,
      canManageUsers: canManageOrg(session),
      modules: buildOrgModules(session)
    });
  });

  fastify.get('/api/org/members', {
    preHandler: requirePlatformAuth(prisma)
  }, async (req, reply) => {
    const session = requireOrg(req, reply);
    if (!session) return;
    if (!canManageOrg(session)) {
      return reply.code(403).send({
        ok: false,
        error: 'FORBIDDEN',
        message: 'Solo un administrador de la organización puede ver el equipo.'
      });
    }

    const members = await prisma.organizationMember.findMany({
      where: { organizationId: session.organization.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
            links: {
              where: { organizationId: session.organization.id },
              select: { product: true }
            }
          }
        }
      }
    });

    return reply.send({
      ok: true,
      members: members.map((m) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        user: {
          id: m.user.id,
          email: m.user.email,
          fullName: m.user.fullName,
          status: m.user.status,
          products: (m.user.links || []).map((l) => l.product)
        }
      }))
    });
  });

  fastify.post('/api/org/members', {
    preHandler: requirePlatformAuth(prisma)
  }, async (req, reply) => {
    const session = requireOrg(req, reply);
    if (!session) return;
    if (!canManageOrg(session)) {
      return reply.code(403).send({
        ok: false,
        error: 'FORBIDDEN',
        message: 'Solo un administrador puede invitar usuarios.'
      });
    }

    const result = await inviteOrgMember(prisma, session.organization.id, {
      email: req.body?.email,
      password: req.body?.password,
      fullName: req.body?.fullName,
      role: req.body?.role || 'MEMBER'
    });
    if (!result.ok) {
      const code = result.error === 'NOT_FOUND' ? 404 : 400;
      return reply.code(code).send(result);
    }
    return reply.code(201).send(result);
  });

  fastify.patch('/api/org/profile', {
    preHandler: requirePlatformAuth(prisma)
  }, async (req, reply) => {
    const session = requireOrg(req, reply);
    if (!session) return;
    if (!canManageOrg(session)) {
      return reply.code(403).send({
        ok: false,
        error: 'FORBIDDEN',
        message: 'Solo un administrador puede editar la organización.'
      });
    }
    const name = String(req.body?.name || '').trim();
    if (!name || name.length < 2) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_NAME',
        message: 'El nombre debe tener al menos 2 caracteres.'
      });
    }
    const updated = await prisma.organization.update({
      where: { id: session.organization.id },
      data: { name }
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

  fastify.post('/api/org/request-product', {
    preHandler: requirePlatformAuth(prisma)
  }, async (req, reply) => {
    const session = requireOrg(req, reply);
    if (!session) return;

    const raw = String(req.body?.product || req.body?.code || '').trim();
    const bySlug = productBySlug(raw);
    const product = String(bySlug?.code || raw).toUpperCase();
    const meta = PLATFORM_PRODUCTS[product];
    if (!meta) {
      return reply.code(400).send({
        ok: false,
        error: 'UNKNOWN_PRODUCT',
        message: 'Módulo no reconocido.'
      });
    }
    if ((session.enabledProducts || []).includes(product)) {
      return reply.code(400).send({
        ok: false,
        error: 'ALREADY_ENABLED',
        message: 'Ese módulo ya está contratado.'
      });
    }

    const mailed = await sendProductRequestEmail({
      orgName: session.organization.name,
      orgId: session.organization.id,
      productLabel: meta.label,
      productCode: product,
      requesterName: session.user.fullName,
      requesterEmail: session.user.email,
      note: req.body?.note
    });

    return reply.send({
      ok: true,
      mailed: !!mailed.ok,
      skipped: !!mailed.skipped,
      message: mailed.ok
        ? `Solicitud de ${meta.label} enviada a Ainspecciona.`
        : mailed.skipped
          ? `Solicitud registrada (correo no configurado en este ambiente). Te contactaremos.`
          : `No se pudo enviar el correo. Escríbenos a contacto@ainspecciona.com pidiendo ${meta.label}.`
    });
  });
}
