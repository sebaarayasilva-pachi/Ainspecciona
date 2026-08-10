import {
  getPostventaAdminStats,
  getPostventaTicketForAdmin,
  listPostventaTenantsForAdmin,
  listPostventaTicketsForAdmin,
  updatePostventaTicketStatus
} from '../services/adminTickets.js';
import { ensurePostventaAnalysisByRef } from '../services/ensureAnalysis.js';
import { deletePostventaTicket } from '../../admin/deleteWithKbCleanup.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ prisma: import('@prisma/client').PrismaClient | null, queuePostventaTicketAnalysis?: Function, storage?: object }} deps
 */
export async function registerPostventaAdminRoutes(app, deps) {
  const { prisma, queuePostventaTicketAnalysis, storage } = deps;
  if (!prisma) {
    app.log.warn('postventa admin routes: prisma no disponible');
    return;
  }

  app.get('/api/admin/postventa/stats', async (req, reply) => {
    try {
      return reply.send(await getPostventaAdminStats(prisma));
    } catch (err) {
      req.log.error({ err }, 'admin postventa stats');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/admin/postventa/tenants', async (req, reply) => {
    try {
      return reply.send(await listPostventaTenantsForAdmin(prisma));
    } catch (err) {
      req.log.error({ err }, 'admin postventa tenants');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/admin/postventa/tickets', async (req, reply) => {
    try {
      const result = await listPostventaTicketsForAdmin(prisma, req.query || {});
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'admin postventa tickets');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/admin/postventa/tickets/:ticketRef', async (req, reply) => {
    try {
      await ensurePostventaAnalysisByRef(
        prisma,
        req.params.ticketRef,
        queuePostventaTicketAnalysis
      );
      const result = await getPostventaTicketForAdmin(prisma, req.params.ticketRef);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'admin postventa ticket detail');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.patch('/api/admin/postventa/tickets/:ticketRef', async (req, reply) => {
    try {
      const result = await updatePostventaTicketStatus(
        prisma,
        req.params.ticketRef,
        req.body || {}
      );
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'admin postventa ticket patch');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/admin/postventa/tickets/:ticketRef/analyze', async (req, reply) => {
    try {
      const ref = String(req.params.ticketRef || '').trim();
      const ticket = await prisma.pvTicket.findFirst({
        where: { OR: [{ id: ref }, { shortId: ref }] },
        select: { id: true, shortId: true }
      });
      if (!ticket) {
        return reply.code(404).send({ ok: false, error: 'TICKET_NOT_FOUND' });
      }

      await prisma.pvTicket.update({
        where: { id: ticket.id },
        data: { status: 'pending_ai_analysis' }
      });

      if (typeof queuePostventaTicketAnalysis === 'function') {
        queuePostventaTicketAnalysis({ ticketId: ticket.id });
      }

      await prisma.pvTicketEvent.create({
        data: {
          ticketId: ticket.id,
          eventType: 'admin_reanalyze_requested',
          payload: {}
        }
      });

      return reply.send({
        ok: true,
        queued: true,
        ticketId: ticket.id,
        shortId: ticket.shortId
      });
    } catch (err) {
      req.log.error({ err }, 'admin postventa reanalyze');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.delete('/api/admin/postventa/tickets/:ticketRef', async (req, reply) => {
    try {
      if (!storage) {
        return reply.code(500).send({ ok: false, error: 'STORAGE_NOT_CONFIGURED' });
      }
      const result = await deletePostventaTicket(prisma, storage, req.params.ticketRef, {
        log: req.log
      });
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'admin postventa ticket delete');
      return reply.code(500).send({ ok: false, error: 'DELETE_FAILED' });
    }
  });
}
