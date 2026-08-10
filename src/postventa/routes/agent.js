import { checkPostventaAgentSecret } from '../auth/agentSecret.js';
import { lookupOwnerUnit } from '../services/lookupUnit.js';
import { createPostventaTicket } from '../services/createTicket.js';
import { createCaptureSession } from '../services/createCaptureSession.js';
import { getTicketStatus } from '../services/ticketStatus.js';
import { validatePostventaWarranty } from '../services/validateWarranty.js';

function agentAuthPreHandler(req, reply, done) {
  const check = checkPostventaAgentSecret(req);
  if (!check.ok) {
    reply.code(check.status).send({ ok: false, error: check.error, message: check.message });
    return;
  }
  done();
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ prisma: import('@prisma/client').PrismaClient | null }} deps
 */
export async function registerPostventaAgentRoutes(app, { prisma }) {
  if (!prisma) {
    app.log.warn('postventa agent routes: prisma no disponible');
    return;
  }

  app.post('/api/postventa/agent/lookup-unit', { preHandler: agentAuthPreHandler }, async (req, reply) => {
    try {
      const result = await lookupOwnerUnit(prisma, req.body || {});
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa lookup-unit');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: 'Error al validar unidad.' });
    }
  });

  app.post('/api/postventa/agent/create-ticket', { preHandler: agentAuthPreHandler }, async (req, reply) => {
    try {
      const result = await createPostventaTicket(prisma, req.body || {});
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.code(201).send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa create-ticket');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: 'Error al crear ticket.' });
    }
  });

  app.post('/api/postventa/agent/create-capture-session', { preHandler: agentAuthPreHandler }, async (req, reply) => {
    try {
      const result = await createCaptureSession(prisma, req.body || {});
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.code(201).send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa create-capture-session');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: 'Error al crear sesión de captura.' });
    }
  });

  app.post('/api/postventa/agent/validate-warranty', { preHandler: agentAuthPreHandler }, async (req, reply) => {
    try {
      const result = await validatePostventaWarranty(prisma, req.body || {});
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa validate-warranty');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: 'Error al validar garantía.' });
    }
  });

  app.get('/api/postventa/agent/ticket-status/:ticketId', { preHandler: agentAuthPreHandler }, async (req, reply) => {
    try {
      const result = await getTicketStatus(prisma, req.params.ticketId, req.query || {});
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa ticket-status');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: 'Error al consultar ticket.' });
    }
  });
}
