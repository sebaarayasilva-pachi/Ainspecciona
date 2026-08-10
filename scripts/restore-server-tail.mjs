#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'server.js');

const head = execSync('git show HEAD:server.js', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).split(/\r?\n/);
const tail = head.slice(3765);
const listenIdx = tail.findIndex((l) => l.startsWith('fastify.listen'));
if (listenIdx < 0) throw new Error('fastify.listen not found in HEAD server.js');
const beforeListen = tail.slice(0, listenIdx);
const listenBlock = tail.slice(listenIdx).join('\n');

const extra = `

const queuePostventaTicketAnalysis = createPostventaAnalysisQueue({
  prisma,
  storage,
  log: fastify.log
});

await registerWhatsAppRoutes(fastify, { prisma });
await registerPostventaAgentRoutes(fastify, { prisma });
await registerPostventaPublicRoutes(fastify, { prisma });
await registerPostventaCaptureRoutes(fastify, {
  prisma,
  storage,
  safeExtFromMime,
  queuePostventaTicketAnalysis
});
await registerPostventaTicketRoutes(fastify, {
  prisma,
  storage,
  queuePostventaTicketAnalysis
});
await registerPostventaAdminRoutes(fastify, {
  prisma,
  queuePostventaTicketAnalysis,
  storage
});
await registerEntregaRoutes(fastify, { prisma });
await registerAintelligenceAdminRoutes(fastify, {
  prisma,
  storage,
  getRuntimeScoreConfig,
  applyScoreConfigUpdate
});
await registerTaxonomyAdminRoutes(fastify);
await registerReviewCenterRoutes(fastify, {
  prisma,
  storage,
  classifyKpiFromSlot,
  getRuntimeScoreConfig,
  applyScoreConfigUpdate,
  queuePostventaTicketAnalysis,
  reviewerEmailDefault: REVIEWER_EMAIL
});
await registerReviewAssistantRoutes(fastify, {
  prisma,
  classifyKpiFromSlot,
  getRuntimeScoreConfig
});

fastify.delete('/api/admin/cases/:caseId', async (req, reply) => {
  try {
    const result = await deleteAinspeccionaCase(prisma, storage, String(req.params.caseId || ''), { log: req.log });
    if (!result.ok) return reply.code(result.status || 400).send(result);
    return reply.send(result);
  } catch (err) {
    req.log.error({ err }, 'admin delete case');
    return reply.code(500).send({ ok: false, error: 'DELETE_FAILED', message: err?.message || 'Error al borrar' });
  }
});

`;

const current = fs.readFileSync(serverPath, 'utf8').trimEnd();
if (current.includes('fastify.listen(')) {
  console.log('server.js already has listen — nothing to do');
  process.exit(0);
}

fs.writeFileSync(serverPath, `${current}\n\n${beforeListen.join('\n')}${extra}${listenBlock}\n`, 'utf8');
console.log(`Restored ${beforeListen.length} lines from HEAD + route registrations + listen`);
