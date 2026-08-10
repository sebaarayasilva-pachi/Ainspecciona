import { checkPostventaAgentSecret } from '../auth/agentSecret.js';
import { analyzePostventaTicket } from '../analysis/analyzeTicket.js';
import { getPostventaTicketReport } from '../services/ticketReport.js';
import { ensurePostventaAnalysisByRef } from '../services/ensureAnalysis.js';

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
 * @param {{ prisma: import('@prisma/client').PrismaClient | null, storage?: object, queuePostventaTicketAnalysis?: Function }} deps
 */
export async function registerPostventaTicketRoutes(app, deps) {
  const { prisma, storage, queuePostventaTicketAnalysis } = deps;
  if (!prisma) {
    app.log.warn('postventa ticket routes: prisma no disponible');
    return;
  }

  app.get('/postventa/report/:shortId', async (req, reply) => {
    return reply.sendFile('postventa/report.html');
  });

  app.get('/api/postventa/tickets/:ticketRef/report', async (req, reply) => {
    try {
      const ref = String(req.params.ticketRef || '').trim();
      const ensure = await ensurePostventaAnalysisByRef(
        prisma,
        ref,
        queuePostventaTicketAnalysis
      );

      const result = await getPostventaTicketReport(prisma, ref);
      if (result.status && result.status >= 400) {
        return reply.code(result.status).send(result);
      }
      return reply.send({ ...result, analysisQueued: !!ensure.queued, ensureReason: ensure.reason || null });
    } catch (err) {
      req.log.error({ err }, 'postventa ticket report');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: 'Error al obtener informe.' });
    }
  });

  app.post('/api/postventa/tickets/:ticketRef/analyze', { preHandler: agentAuthPreHandler }, async (req, reply) => {
    try {
      const ref = String(req.params.ticketRef || '').trim();
      const ticket = await prisma.pvTicket.findFirst({
        where: { OR: [{ id: ref }, { shortId: ref }] },
        select: { id: true, status: true }
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
        return reply.send({ ok: true, queued: true, ticketId: ticket.id });
      }

      if (!storage) {
        return reply.code(500).send({ ok: false, error: 'STORAGE_NOT_CONFIGURED' });
      }

      const result = await analyzePostventaTicket({
        prisma,
        storage,
        log: req.log,
        ticketId: ticket.id
      });
      if (!result.ok) {
        return reply.code(500).send(result);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'postventa analyze ticket');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });
}
