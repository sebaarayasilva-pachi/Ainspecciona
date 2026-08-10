import {
  createPvPortalSession,
  destroyPvPortalSession,
  getPvPortalSession,
  requirePvPortalAuth,
  sessionCookieOpts,
  verifyPassword,
  PV_PORTAL_SESSION_COOKIE,
} from '../auth/portalAuth.js';
import {
  getPortalOverview,
  getPortalProject,
  getPortalTicket,
  getMyAssignedTickets,
  updatePortalTicketStatus
} from '../services/portalDashboard.js';
import {
  listPortalAssignableUsers,
  setProjectDefaultInspector
} from '../services/assignTicket.js';
import {
  listPortalUsers,
  createPortalUser,
  updatePortalUser,
  canManageUsers
} from '../services/portalUsers.js';
import { closePortalTicketWithEvidence } from '../services/inspectorClose.js';
import { saveWorkOrderTeam, buildWorkOrderPdf } from '../services/workOrder.js';
import { ensurePostventaAnalysisQueued } from '../services/ensureAnalysis.js';
import { ensurePostventaAssignmentSchema } from '../ensureAssignmentSchema.js';

/**
 * Portal inmobiliaria Postventa — auth + dashboard APIs.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ prisma: import('@prisma/client').PrismaClient | null, storage?: object, queuePostventaTicketAnalysis?: Function }} deps
 */
export async function registerPostventaPortalRoutes(app, deps = {}) {
  const prisma = deps.prisma || null;
  const storage = deps.storage || null;
  const queuePostventaTicketAnalysis = deps.queuePostventaTicketAnalysis || null;
  const auth = requirePvPortalAuth(prisma);

  if (prisma) {
    ensurePostventaAssignmentSchema(prisma, app.log || console).catch((err) => {
      app.log?.warn?.({ err }, 'ensure-postventa-assignment-schema');
    });
  }

  app.post('/api/postventa/portal/login', async (req, reply) => {
    if (!prisma) return reply.code(503).send({ ok: false, error: 'DB_UNAVAILABLE' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return reply.code(400).send({
        ok: false,
        error: 'MISSING_FIELDS',
        message: 'Email y clave son obligatorios.'
      });
    }
    const user = await prisma.pvUser.findFirst({
      where: { email },
      include: { tenant: true }
    });
    if (!user || user.status !== 'ACTIVE' || !user.tenant || user.tenant.status !== 'ACTIVE') {
      return reply.code(401).send({
        ok: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email o clave incorrectos.'
      });
    }
    if (!verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({
        ok: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email o clave incorrectos.'
      });
    }
    const token = await createPvPortalSession(prisma, {
      tenantId: user.tenantId,
      userId: user.id
    });
    const cookieOpts = sessionCookieOpts(req);
    reply.setCookie(PV_PORTAL_SESSION_COOKIE, token, cookieOpts);
    reply.setCookie('__session', token, cookieOpts);
    return reply.send({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      tenant: {
        id: user.tenant.id,
        slug: user.tenant.slug,
        name: user.tenant.name
      }
    });
  });

  app.post('/api/postventa/portal/logout', async (req, reply) => {
    const productToken =
      String(req.headers['x-postventa-session'] || '').trim() ||
      req.cookies?.[PV_PORTAL_SESSION_COOKIE] ||
      '';
    if (prisma) await destroyPvPortalSession(prisma, req);
    reply.clearCookie(PV_PORTAL_SESSION_COOKIE, { path: '/' });
    if (productToken && req.cookies?.__session === productToken) {
      reply.clearCookie('__session', { path: '/' });
    }
    return reply.send({ ok: true });
  });

  app.get('/api/postventa/portal/me', async (req, reply) => {
    if (!prisma) return reply.code(503).send({ ok: false, error: 'DB_UNAVAILABLE' });
    const session = await getPvPortalSession(prisma, req);
    if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
    return reply.send({
      ok: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        fullName: session.user.fullName,
        role: session.user.role
      },
      tenant: {
        id: session.tenant.id,
        slug: session.tenant.slug,
        name: session.tenant.name
      }
    });
  });

  function noStore(reply) {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    reply.header('Pragma', 'no-cache');
  }

  app.get('/api/postventa/portal/overview', { preHandler: auth }, async (req, reply) => {
    try {
      noStore(reply);
      return reply.send(await getPortalOverview(prisma, req.pvPortalSession.tenantId));
    } catch (err) {
      req.log.error({ err }, 'postventa portal overview');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/postventa/portal/projects/:slug', { preHandler: auth }, async (req, reply) => {
    try {
      const result = await getPortalProject(
        prisma,
        req.pvPortalSession.tenantId,
        req.params.slug
      );
      noStore(reply);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa portal project');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/postventa/portal/users', { preHandler: auth }, async (req, reply) => {
    try {
      noStore(reply);
      // Selector de inspector (solo ACTIVE) vs mantenedor completo
      if (String(req.query?.all || '') === '1') {
        const role = req.pvPortalSession?.user?.role;
        if (!canManageUsers(role)) {
          return reply.code(403).send({
            ok: false,
            error: 'FORBIDDEN',
            message: 'Sin permiso para listar todos los usuarios.'
          });
        }
        return reply.send(await listPortalUsers(prisma, req.pvPortalSession.tenantId));
      }
      return reply.send(await listPortalAssignableUsers(prisma, req.pvPortalSession.tenantId));
    } catch (err) {
      req.log.error({ err }, 'postventa portal users');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/postventa/portal/users', { preHandler: auth }, async (req, reply) => {
    try {
      const result = await createPortalUser(
        prisma,
        req.pvPortalSession.tenantId,
        req.body || {},
        { actorRole: req.pvPortalSession?.user?.role }
      );
      noStore(reply);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.code(201).send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa portal create user');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: err?.message || 'Error' });
    }
  });

  app.patch('/api/postventa/portal/users/:userId', { preHandler: auth }, async (req, reply) => {
    try {
      const result = await updatePortalUser(
        prisma,
        req.pvPortalSession.tenantId,
        req.params.userId,
        req.body || {},
        {
          actorRole: req.pvPortalSession?.user?.role,
          actorUserId: req.pvPortalSession.userId || req.pvPortalSession.user?.id
        }
      );
      noStore(reply);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa portal update user');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: err?.message || 'Error' });
    }
  });

  app.get('/api/postventa/portal/my-tickets', { preHandler: auth }, async (req, reply) => {
    try {
      noStore(reply);
      const result = await getMyAssignedTickets(
        prisma,
        req.pvPortalSession.tenantId,
        req.pvPortalSession.userId || req.pvPortalSession.user?.id,
        { role: req.pvPortalSession?.user?.role }
      );
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa portal my-tickets');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: err?.message || 'Error' });
    }
  });

  app.patch('/api/postventa/portal/projects/:slug/inspector', { preHandler: auth }, async (req, reply) => {
    try {
      const role = req.pvPortalSession?.user?.role;
      if (role && !['ADMIN', 'EXECUTIVE'].includes(role)) {
        // OPERATOR / INSPECTOR pueden ver pero no cambiar mantenedor
        // Permitimos OPERATOR también para demos de inmobiliaria pequeña
      }
      const result = await setProjectDefaultInspector(
        prisma,
        req.pvPortalSession.tenantId,
        req.params.slug,
        req.body?.inspectorUserId ?? req.body?.defaultInspectorId ?? null
      );
      noStore(reply);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa portal project inspector');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: err?.message || 'Error' });
    }
  });

  app.get('/api/postventa/portal/tickets/:shortId', { preHandler: auth }, async (req, reply) => {
    try {
      // Recupera tickets con fotos subidas que quedaron en "pendiente de fotos"
      const pre = await prisma.pvTicket.findFirst({
        where: {
          tenantId: req.pvPortalSession.tenantId,
          OR: [
            { shortId: String(req.params.shortId || '').trim() },
            { id: String(req.params.shortId || '').trim() }
          ]
        },
        select: { id: true, status: true }
      });
      if (
        pre &&
        (pre.status === 'pending_evidence' || pre.status === 'evidence_received')
      ) {
        await ensurePostventaAnalysisQueued(
          prisma,
          pre.id,
          queuePostventaTicketAnalysis
        ).catch((err) => req.log.warn({ err }, 'portal ticket ensure analysis'));
      }

      const result = await getPortalTicket(
        prisma,
        req.pvPortalSession.tenantId,
        req.params.shortId
      );
      noStore(reply);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa portal ticket');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.get(
    '/api/postventa/portal/tickets/:shortId/slots/:slotCode/photo',
    { preHandler: auth },
    async (req, reply) => {
      try {
        if (!storage?.readBuffer) {
          return reply.code(503).send({ ok: false, error: 'STORAGE_UNAVAILABLE' });
        }
        const ref = String(req.params.shortId || '').trim();
        const slotCode = String(req.params.slotCode || '').trim();
        if (!ref || !slotCode) {
          return reply.code(400).send({ ok: false, error: 'MISSING_PARAMS' });
        }
        const ticket = await prisma.pvTicket.findFirst({
          where: {
            tenantId: req.pvPortalSession.tenantId,
            OR: [{ shortId: ref }, { id: ref }]
          },
          select: {
            id: true,
            captureSessions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                slots: {
                  where: { slotCode },
                  take: 1,
                  select: { photoPath: true, mimeType: true }
                }
              }
            }
          }
        });
        const slot = ticket?.captureSessions?.[0]?.slots?.[0];
        if (!slot?.photoPath) {
          return reply.code(404).send({ ok: false, error: 'PHOTO_NOT_FOUND' });
        }
        const buf = await storage.readBuffer(slot.photoPath);
        const ctype = slot.mimeType || 'image/jpeg';
        reply.header('Content-Type', ctype);
        reply.header('Cache-Control', 'private, max-age=300');
        return reply.send(buf);
      } catch (err) {
        req.log.error({ err }, 'postventa portal ticket photo');
        return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
      }
    }
  );

  app.patch('/api/postventa/portal/tickets/:shortId', { preHandler: auth }, async (req, reply) => {
    try {
      const result = await updatePortalTicketStatus(
        prisma,
        req.pvPortalSession.tenantId,
        req.params.shortId,
        req.body || {}
      );
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa portal ticket patch');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/postventa/portal/tickets/:shortId/close', { preHandler: auth, bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    try {
      if (!storage?.saveImageBuffer) {
        return reply.code(503).send({ ok: false, error: 'STORAGE_UNAVAILABLE' });
      }

      let buffer = null;
      let mimeType = 'image/jpeg';
      let note = '';

      // Prefer multipart (campo photo + note)
      try {
        const parts = req.parts ? req.parts() : null;
        if (parts) {
          for await (const part of parts) {
            if (part.type === 'file' && (part.fieldname === 'photo' || part.fieldname === 'file')) {
              buffer = await part.toBuffer();
              mimeType = part.mimetype || mimeType;
            } else if (part.type === 'field' && part.fieldname === 'note') {
              note = String(part.value || '');
            }
          }
        }
      } catch (_) {
        /* fallback abajo */
      }

      if (!buffer && req.file) {
        try {
          const file = await req.file();
          if (file) {
            buffer = await file.toBuffer();
            mimeType = file.mimetype || mimeType;
            note = String(req.body?.note || note || '');
          }
        } catch (_) {
          /* ignore */
        }
      }

      // JSON base64: { note, photoBase64, mimeType }
      if (!buffer && req.body?.photoBase64) {
        const raw = String(req.body.photoBase64).replace(/^data:[^;]+;base64,/, '');
        buffer = Buffer.from(raw, 'base64');
        mimeType = String(req.body.mimeType || mimeType);
        note = String(req.body.note || note || '');
      } else if (req.body?.note && !note) {
        note = String(req.body.note);
      }

      const result = await closePortalTicketWithEvidence(
        prisma,
        storage,
        req.pvPortalSession.tenantId,
        req.params.shortId,
        {
          userId: req.pvPortalSession.userId || req.pvPortalSession.user?.id,
          userRole: req.pvPortalSession.user?.role,
          note,
          buffer,
          mimeType
        }
      );
      noStore(reply);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa portal ticket close');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: err?.message || 'Error' });
    }
  });

  app.post('/api/postventa/portal/tickets/:shortId/ot', { preHandler: auth }, async (req, reply) => {
    try {
      const result = await saveWorkOrderTeam(
        prisma,
        req.pvPortalSession.tenantId,
        req.params.shortId,
        req.body || {},
        { userId: req.pvPortalSession.userId || req.pvPortalSession.user?.id }
      );
      noStore(reply);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa portal ticket ot save');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: err?.message || 'Error' });
    }
  });

  app.get('/api/postventa/portal/tickets/:shortId/ot.pdf', { preHandler: auth }, async (req, reply) => {
    try {
      const result = await buildWorkOrderPdf(
        prisma,
        storage,
        req.pvPortalSession.tenantId,
        req.params.shortId,
        {
          repairTeamName: req.query?.team || req.query?.repairTeamName,
          repairTeamContact: req.query?.contact || req.query?.repairTeamContact
        }
      );
      noStore(reply);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      reply.header('Content-Type', 'application/pdf');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${String(result.filename || 'OT.pdf').replace(/"/g, '')}"`
      );
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(result.pdf);
    } catch (err) {
      req.log.error({ err }, 'postventa portal ticket ot pdf');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: err?.message || 'Error' });
    }
  });

  app.get(
    '/api/postventa/portal/tickets/:shortId/close-photo',
    { preHandler: auth },
    async (req, reply) => {
      try {
        if (!storage?.readBuffer) {
          return reply.code(503).send({ ok: false, error: 'STORAGE_UNAVAILABLE' });
        }
        const ref = String(req.params.shortId || '').trim();
        const ticket = await prisma.pvTicket.findFirst({
          where: {
            tenantId: req.pvPortalSession.tenantId,
            OR: [{ shortId: ref }, { id: ref }]
          },
          select: { closePhotoPath: true }
        });
        if (!ticket?.closePhotoPath) {
          return reply.code(404).send({ ok: false, error: 'NO_CLOSE_PHOTO' });
        }
        const buf = await storage.readBuffer(ticket.closePhotoPath);
        if (!buf) {
          return reply.code(404).send({ ok: false, error: 'PHOTO_MISSING' });
        }
        const lower = String(ticket.closePhotoPath).toLowerCase();
        const ct = lower.endsWith('.png')
          ? 'image/png'
          : lower.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';
        noStore(reply);
        reply.header('Content-Type', ct);
        reply.header('Cache-Control', 'private, max-age=60');
        return reply.send(buf);
      } catch (err) {
        req.log.error({ err }, 'postventa portal close-photo');
        return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
      }
    }
  );
}
