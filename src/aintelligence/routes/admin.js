import {
  approveAintelligenceFeedback,
  getAintelligenceFeedbackDetail,
  getAintelligenceFeedbackStats,
  listAintelligenceFeedback,
  rejectAintelligenceFeedback
} from '../admin/feedbackAdmin.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient | null,
 *   storage: object,
 *   getRuntimeScoreConfig: Function,
 *   applyScoreConfigUpdate: Function
 * }} deps
 */
export async function registerAintelligenceAdminRoutes(app, deps) {
  const { prisma, storage, getRuntimeScoreConfig, applyScoreConfigUpdate } = deps;
  if (!prisma) {
    app.log.warn('aintelligence admin routes: prisma no disponible');
    return;
  }

  app.get('/api/admin/aintelligence/feedback/stats', async (req, reply) => {
    try {
      return reply.send(await getAintelligenceFeedbackStats(prisma));
    } catch (err) {
      req.log.error({ err }, 'admin aintelligence feedback stats');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/admin/aintelligence/feedback', async (req, reply) => {
    try {
      return reply.send(await listAintelligenceFeedback(prisma, storage, req.query || {}));
    } catch (err) {
      req.log.error({ err }, 'admin aintelligence feedback list');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/admin/aintelligence/feedback/:id', async (req, reply) => {
    try {
      const result = await getAintelligenceFeedbackDetail(prisma, storage, req.params.id);
      if (!result.ok) return reply.code(result.status || 404).send(result);
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'admin aintelligence feedback detail');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/admin/aintelligence/feedback/:id/approve', async (req, reply) => {
    try {
      const result = await approveAintelligenceFeedback({
        prisma,
        storage,
        id: req.params.id,
        body: req.body || {},
        getRuntimeScoreConfig,
        applyScoreConfigUpdate
      });
      if (!result.ok) return reply.code(result.status || 400).send(result);
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'admin aintelligence feedback approve');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/admin/aintelligence/feedback/:id/reject', async (req, reply) => {
    try {
      const result = await rejectAintelligenceFeedback({
        prisma,
        storage,
        id: req.params.id,
        body: req.body || {}
      });
      if (!result.ok) return reply.code(result.status || 400).send(result);
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'admin aintelligence feedback reject');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });
}
