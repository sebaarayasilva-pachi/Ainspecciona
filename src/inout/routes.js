/**
 * API + registro de rutas In & Out.
 */
import crypto from 'node:crypto';
import { createStorage } from '../storage/storage.js';
import { validatePhotoQuality } from '../photoQuality/validatePhoto.js';
import {
  createIoSession,
  destroyIoSession,
  getIoSession,
  hashPassword,
  requireIoAuth,
  sessionCookieOpts,
  verifyPassword,
  IO_SESSION_COOKIE,
  normalizeIoRole
} from './auth.js';
import {
  acceptInBaseline,
  completeVisit,
  createLeaseWithInVisit,
  startOutVisit
} from './services/visitLifecycle.js';
import { checkComparability, hintToSpanish } from './analysis/comparability.js';
import { buildDiffSummary, DISCLAIMER } from './services/report.js';
import { queueDiffAnalysis, runDiffAnalysis } from './services/diffAnalysis.js';

let storage;
function getStorage() {
  if (!storage) storage = createStorage();
  return storage;
}

function bufferToDataUrl(buf, mime = 'image/jpeg') {
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
}

async function readPhotoBuffer(filePath) {
  const store = getStorage();
  return store.readBuffer(filePath);
}

async function latestPhotoForSlot(prisma, slotId) {
  return prisma.ioPhoto.findFirst({
    where: { slotId },
    orderBy: { capturedAt: 'desc' }
  });
}

async function inPhotoForOutSlot(prisma, outVisit, outSlot) {
  if (!outVisit.pairedVisitId) return null;
  const inSlot = await prisma.ioVisitSlot.findFirst({
    where: { visitId: outVisit.pairedVisitId, slotCode: outSlot.slotCode }
  });
  if (!inSlot) return null;
  return latestPhotoForSlot(prisma, inSlot.id);
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ prisma: any }} opts
 */
export async function registerInOutRoutes(app, { prisma }) {
  const auth = requireIoAuth(prisma);

  // ——— Auth ———
  app.post('/api/inout/auth/login', async (req, reply) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return reply.code(400).send({ ok: false, error: 'MISSING_FIELDS' });
    }
    const user = await prisma.ioUser.findFirst({
      where: { email, status: 'ACTIVE' },
      include: { tenant: true }
    });
    if (!user || user.tenant.status !== 'ACTIVE' || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });
    }
    const token = await createIoSession(prisma, { tenantId: user.tenantId, userId: user.id });
    reply.setCookie(IO_SESSION_COOKIE, token, sessionCookieOpts(req));
    reply.setCookie('__session', token, sessionCookieOpts(req));
    return reply.send({
      ok: true,
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
      tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug }
    });
  });

  app.post('/api/inout/auth/logout', async (req, reply) => {
    const productToken =
      String(req.headers['x-inout-session'] || '').trim() ||
      req.cookies?.[IO_SESSION_COOKIE] ||
      '';
    await destroyIoSession(prisma, req);
    reply.clearCookie(IO_SESSION_COOKIE, { path: '/' });
    if (productToken && req.cookies?.__session === productToken) {
      reply.clearCookie('__session', { path: '/' });
    }
    return reply.send({ ok: true });
  });

  app.get('/api/inout/auth/me', { preHandler: auth }, async (req, reply) => {
    const s = req.ioSession;
    return reply.send({
      ok: true,
      user: { id: s.user.id, email: s.user.email, fullName: s.user.fullName, role: s.user.role },
      tenant: { id: s.tenant.id, name: s.tenant.name, slug: s.tenant.slug }
    });
  });

  // Seed demo (solo si no hay tenants)
  app.post('/api/inout/auth/bootstrap-demo', async (req, reply) => {
    const count = await prisma.ioTenant.count();
    if (count > 0 && !req.body?.force) {
      return reply.code(409).send({ ok: false, error: 'ALREADY_BOOTSTRAPPED' });
    }
    const email = String(process.env.INOUT_DEMO_EMAIL || 'demo@inout.ainspecciona.com').toLowerCase();
    const password = String(process.env.INOUT_DEMO_PASSWORD || 'inout-demo-2026');
    const tenant = await prisma.ioTenant.create({
      data: { slug: 'demo-inout', name: 'Demo In & Out', status: 'ACTIVE' }
    });
    const user = await prisma.ioUser.create({
      data: {
        tenantId: tenant.id,
        email,
        fullName: 'Admin Demo InOut',
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: hashPassword(password)
      }
    });
    return reply.send({
      ok: true,
      tenant: { id: tenant.id, slug: tenant.slug },
      login: { email, password }
    });
  });

  // ——— Portal: leases ———
  app.get('/api/inout/leases', { preHandler: auth }, async (req, reply) => {
    const leases = await prisma.ioLease.findMany({
      where: { tenantId: req.ioSession.tenantId },
      include: {
        property: true,
        visits: { select: { id: true, phase: true, status: true, captureToken: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return reply.send({ ok: true, leases });
  });

  app.post('/api/inout/leases', { preHandler: auth }, async (req, reply) => {
    const body = req.body || {};
    const address = String(body.address || body.property?.address || '').trim();
    if (!address) {
      return reply.code(400).send({ ok: false, error: 'ADDRESS_REQUIRED' });
    }
    try {
      const result = await createLeaseWithInVisit(prisma, {
        tenantId: req.ioSession.tenantId,
        userId: req.ioSession.userId,
        property: {
          address,
          label: body.label || body.property?.label,
          comuna: body.comuna || body.property?.comuna,
          propertyType: body.propertyType || body.property?.propertyType,
          bedroomsCount: body.bedroomsCount ?? body.property?.bedroomsCount,
          bathroomsCount: body.bathroomsCount ?? body.property?.bathroomsCount,
          hasPatio: body.hasPatio ?? body.property?.hasPatio,
          hasLaundry: body.hasLaundry ?? body.property?.hasLaundry,
          hasParking: body.hasParking ?? body.property?.hasParking,
          hasElevator: body.hasElevator ?? body.property?.hasElevator,
          hasEntranceGrille: body.hasEntranceGrille ?? body.property?.hasEntranceGrille
        },
        lease: {
          tenantName: body.tenantName,
          tenantRut: body.tenantRut,
          tenantEmail: body.tenantEmail,
          tenantPhone: body.tenantPhone,
          ownerName: body.ownerName,
          ownerEmail: body.ownerEmail,
          startDate: body.startDate,
          endDate: body.endDate,
          notes: body.notes
        }
      });
      return reply.send({
        ok: true,
        lease: result.lease,
        property: result.property,
        visit: result.visit,
        captureToken: result.visit.captureToken,
        planSlots: result.plan.length
      });
    } catch (err) {
      req.log.error({ err }, 'inout create lease');
      return reply.code(500).send({ ok: false, error: 'CREATE_FAILED', message: err?.message });
    }
  });

  app.get('/api/inout/leases/:leaseId', { preHandler: auth }, async (req, reply) => {
    const lease = await prisma.ioLease.findFirst({
      where: { id: String(req.params.leaseId), tenantId: req.ioSession.tenantId },
      include: {
        property: true,
        visits: {
          include: {
            slots: { orderBy: { sortOrder: 'asc' }, include: { photos: { orderBy: { capturedAt: 'desc' }, take: 1 } } },
            diffResults: true
          },
          orderBy: { createdAt: 'asc' }
        },
        reports: { orderBy: { createdAt: 'desc' }, take: 5 }
      }
    });
    if (!lease) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    return reply.send({ ok: true, lease, disclaimer: DISCLAIMER });
  });

  app.post('/api/inout/leases/:leaseId/accept-in', { preHandler: auth }, async (req, reply) => {
    const result = await acceptInBaseline(prisma, {
      leaseId: String(req.params.leaseId),
      tenantId: req.ioSession.tenantId,
      acceptedBy: req.body?.acceptedBy || req.ioSession.user.fullName
    });
    if (!result.ok) return reply.code(400).send(result);
    return reply.send(result);
  });

  app.post('/api/inout/leases/:leaseId/start-out', { preHandler: auth }, async (req, reply) => {
    const result = await startOutVisit(prisma, {
      leaseId: String(req.params.leaseId),
      tenantId: req.ioSession.tenantId,
      userId: req.ioSession.userId
    });
    if (!result.ok) return reply.code(400).send(result);
    return reply.send({
      ok: true,
      visit: result.visit,
      captureToken: result.visit.captureToken,
      reused: result.reused
    });
  });

  app.post('/api/inout/visits/:visitId/complete', { preHandler: auth }, async (req, reply) => {
    const visit = await prisma.ioVisit.findFirst({
      where: { id: String(req.params.visitId) },
      include: { lease: true }
    });
    if (!visit || visit.lease.tenantId !== req.ioSession.tenantId) {
      return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    }
    const result = await completeVisit(prisma, visit.id);
    if (!result.ok) return reply.code(400).send(result);
    if (result.phase === 'OUT' && result.leaseId) {
      queueDiffAnalysis(prisma, result.leaseId, { log: req.log });
    }
    return reply.send(result);
  });

  // ——— Captura por token (móvil / web) ———
  async function loadVisitForCapture(token) {
    return prisma.ioVisit.findFirst({
      where: { captureToken: String(token) },
      include: {
        lease: { include: { property: true } },
        slots: {
          orderBy: { sortOrder: 'asc' },
          include: { photos: { orderBy: { capturedAt: 'desc' }, take: 1 } }
        }
      }
    });
  }

  async function ghostUrlForSlot(visit, slotCode) {
    if (visit.phase !== 'OUT' || !visit.pairedVisitId) return null;
    const inSlot = await prisma.ioVisitSlot.findFirst({
      where: { visitId: visit.pairedVisitId, slotCode },
      include: { photos: { orderBy: { capturedAt: 'desc' }, take: 1 } }
    });
    const p = inSlot?.photos?.[0];
    if (!p) return null;
    return `/api/inout/photos/${p.id}/image?token=${encodeURIComponent(visit.captureToken)}`;
  }

  function captureProgress(slots) {
    const total = slots.length;
    const done = slots.filter((s) => s.status === 'UPLOADED' || s.status === 'SKIPPED').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, remaining: Math.max(0, total - done), pct };
  }

  /** Siguiente slot pendiente (visita guiada tipo Capture). */
  app.get('/api/inout/capture/:token/next', async (req, reply) => {
    const visit = await loadVisitForCapture(req.params.token);
    if (!visit) return reply.code(404).send({ ok: false, error: 'INVALID_TOKEN' });
    if (visit.status === 'COMPLETED') {
      return reply.send({
        ok: true,
        done: true,
        visit: {
          id: visit.id,
          phase: visit.phase,
          status: visit.status,
          leaseId: visit.leaseId,
          property: visit.lease.property
        },
        progress: captureProgress(visit.slots),
        slot: null
      });
    }
    const next =
      visit.slots.find((s) => s.status === 'NEEDS_RECAPTURE') ||
      visit.slots.find((s) => s.status === 'PENDING');
    const progress = captureProgress(visit.slots);
    if (!next) {
      return reply.send({
        ok: true,
        done: true,
        visit: {
          id: visit.id,
          phase: visit.phase,
          status: visit.status,
          leaseId: visit.leaseId,
          property: visit.lease.property
        },
        progress,
        slot: null
      });
    }
    const index = visit.slots.findIndex((s) => s.id === next.id);
    const ghostUrl = await ghostUrlForSlot(visit, next.slotCode);
    return reply.send({
      ok: true,
      done: false,
      visit: {
        id: visit.id,
        phase: visit.phase,
        status: visit.status,
        leaseId: visit.leaseId,
        property: visit.lease.property
      },
      progress,
      slot: {
        id: next.id,
        slotCode: next.slotCode,
        title: next.title,
        instructions: next.instructions,
        sortOrder: next.sortOrder,
        required: next.required,
        status: next.status,
        index: index + 1,
        total: visit.slots.length,
        ghostUrl
      }
    });
  });

  app.post('/api/inout/capture/:token/slots/:slotId/omit', async (req, reply) => {
    const visit = await prisma.ioVisit.findFirst({
      where: { captureToken: String(req.params.token) }
    });
    if (!visit) return reply.code(404).send({ ok: false, error: 'INVALID_TOKEN' });
    if (visit.status === 'COMPLETED') {
      return reply.code(400).send({ ok: false, error: 'VISIT_COMPLETED' });
    }
    const slot = await prisma.ioVisitSlot.findFirst({
      where: { id: String(req.params.slotId), visitId: visit.id }
    });
    if (!slot) return reply.code(404).send({ ok: false, error: 'SLOT_NOT_FOUND' });
    if (slot.required) {
      return reply.code(400).send({
        ok: false,
        error: 'REQUIRED_SLOT',
        message: 'Esta foto es obligatoria; no se puede omitir.'
      });
    }
    await prisma.ioVisitSlot.update({
      where: { id: slot.id },
      data: { status: 'SKIPPED' }
    });
    return reply.send({ ok: true, slotId: slot.id, status: 'SKIPPED' });
  });

  app.get('/api/inout/capture/:token', async (req, reply) => {
    const visit = await prisma.ioVisit.findFirst({
      where: { captureToken: String(req.params.token) },
      include: {
        lease: { include: { property: true } },
        slots: {
          orderBy: { sortOrder: 'asc' },
          include: { photos: { orderBy: { capturedAt: 'desc' }, take: 1 } }
        }
      }
    });
    if (!visit) return reply.code(404).send({ ok: false, error: 'INVALID_TOKEN' });

    let ghostBySlot = {};
    if (visit.phase === 'OUT' && visit.pairedVisitId) {
      const inSlots = await prisma.ioVisitSlot.findMany({
        where: { visitId: visit.pairedVisitId },
        include: { photos: { orderBy: { capturedAt: 'desc' }, take: 1 } }
      });
      for (const s of inSlots) {
        const p = s.photos[0];
        if (p) {
          ghostBySlot[s.slotCode] = {
            photoId: p.id,
            url: `/api/inout/photos/${p.id}/image?token=${encodeURIComponent(visit.captureToken)}`
          };
        }
      }
    }

    return reply.send({
      ok: true,
      visit: {
        id: visit.id,
        phase: visit.phase,
        status: visit.status,
        leaseId: visit.leaseId,
        property: visit.lease.property
      },
      slots: visit.slots.map((s) => ({
        id: s.id,
        slotCode: s.slotCode,
        title: s.title,
        instructions: s.instructions,
        sortOrder: s.sortOrder,
        required: s.required,
        status: s.status,
        recaptureCount: s.recaptureCount,
        hasPhoto: Boolean(s.photos[0]),
        ghostUrl: ghostBySlot[s.slotCode]?.url || null
      }))
    });
  });

  app.get('/api/inout/photos/:photoId/image', async (req, reply) => {
    const photo = await prisma.ioPhoto.findUnique({
      where: { id: String(req.params.photoId) },
      include: { visit: true }
    });
    if (!photo) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

    const session = await getIoSession(prisma, req);
    const token = String(req.query?.token || '').trim();
    // Token de la misma visita, o token OUT que lee fotos IN del par (ghost overlay)
    let tokenOk = Boolean(token && photo.visit.captureToken === token);
    if (!tokenOk && token) {
      const requester = await prisma.ioVisit.findFirst({
        where: { captureToken: token },
        select: { id: true, leaseId: true, phase: true, pairedVisitId: true }
      });
      if (
        requester &&
        requester.leaseId === photo.visit.leaseId &&
        (requester.id === photo.visitId ||
          (requester.phase === 'OUT' &&
            (requester.pairedVisitId === photo.visitId || photo.visit.phase === 'IN')))
      ) {
        tokenOk = true;
      }
    }
    if (!session && !tokenOk) {
      return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
    }
    if (session) {
      const lease = await prisma.ioLease.findUnique({ where: { id: photo.visit.leaseId } });
      if (!lease || lease.tenantId !== session.tenantId) {
        return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });
      }
    }

    try {
      const buf = await readPhotoBuffer(photo.filePath);
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.type(photo.mimeType || 'image/jpeg').send(buf);
    } catch (err) {
      req.log.error({ err }, 'inout photo read');
      return reply.code(404).send({ ok: false, error: 'IMAGE_READ_FAILED' });
    }
  });

  app.post('/api/inout/capture/:token/slots/:slotId', async (req, reply) => {
    const visit = await prisma.ioVisit.findFirst({
      where: { captureToken: String(req.params.token) }
    });
    if (!visit) return reply.code(404).send({ ok: false, error: 'INVALID_TOKEN' });
    if (visit.status === 'COMPLETED') {
      return reply.code(400).send({ ok: false, error: 'VISIT_COMPLETED' });
    }

    const slot = await prisma.ioVisitSlot.findFirst({
      where: { id: String(req.params.slotId), visitId: visit.id }
    });
    if (!slot) return reply.code(404).send({ ok: false, error: 'SLOT_NOT_FOUND' });

    const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ ok: false, error: 'PHOTO_REQUIRED' });
    const buffer = await file.toBuffer();
    if (!buffer.length) return reply.code(400).send({ ok: false, error: 'EMPTY_PHOTO' });

    const quality = await validatePhotoQuality(buffer, undefined, {
      slotCode: slot.slotCode,
      slotTitle: slot.title
    });
    if (!quality.ok) {
      return reply.code(422).send({
        ok: false,
        error: 'QUALITY_FAILED',
        passed: false,
        problem: { message: quality.problem?.message || 'Calidad insuficiente' },
        quality
      });
    }

    let comparableJson = null;
    if (visit.phase === 'OUT') {
      const inPhoto = await inPhotoForOutSlot(prisma, visit, slot);
      if (inPhoto) {
        try {
          const inBuf = await readPhotoBuffer(inPhoto.filePath);
          const result = await checkComparability({
            inImageDataUrl: bufferToDataUrl(inBuf, inPhoto.mimeType || 'image/jpeg'),
            outImageDataUrl: bufferToDataUrl(buffer, file.mimetype || 'image/jpeg'),
            slotTitle: slot.title,
            log: req.log
          });
          comparableJson = result;
          if (!result.comparable) {
            await prisma.ioVisitSlot.update({
              where: { id: slot.id },
              data: {
                status: 'NEEDS_RECAPTURE',
                recaptureCount: { increment: 1 }
              }
            });
            return reply.code(422).send({
              ok: false,
              error: 'NOT_COMPARABLE',
              passed: false,
              comparable: result,
              problem: {
                message:
                  result.message ||
                  `La fotografía no es suficientemente comparable. ${hintToSpanish(result.hint)}`
              }
            });
          }
        } catch (err) {
          req.log.warn({ err }, 'inout comparability gate');
        }
      }
    }

    const saved = await getStorage().saveImageBuffer({
      buffer,
      contentType: file.mimetype || 'image/jpeg',
      ext: 'jpg',
      caseId: visit.id,
      storageKey: `inout/${visit.leaseId}/${visit.phase}/${slot.slotCode}/${crypto.randomUUID()}.jpg`
    });

    const photo = await prisma.ioPhoto.create({
      data: {
        visitId: visit.id,
        slotId: slot.id,
        filePath: saved.filePath || saved.publicUrl,
        mimeType: file.mimetype || 'image/jpeg',
        width: quality.debug?.size?.width || null,
        height: quality.debug?.size?.height || null,
        qualityJson: quality,
        comparableJson,
        deviceInfo: String(req.headers['user-agent'] || '').slice(0, 255) || null
      }
    });

    await prisma.ioVisitSlot.update({
      where: { id: slot.id },
      data: { status: 'UPLOADED' }
    });

    if (visit.status === 'PENDING') {
      await prisma.ioVisit.update({
        where: { id: visit.id },
        data: { status: 'IN_PROGRESS', startedAt: visit.startedAt || new Date() }
      });
    }

    return reply.send({
      ok: true,
      passed: true,
      photo: { id: photo.id, slotId: slot.id },
      comparable: comparableJson
    });
  });

  app.post('/api/inout/capture/:token/finish', async (req, reply) => {
    const visit = await prisma.ioVisit.findFirst({
      where: { captureToken: String(req.params.token) }
    });
    if (!visit) return reply.code(404).send({ ok: false, error: 'INVALID_TOKEN' });
    const result = await completeVisit(prisma, visit.id);
    if (!result.ok) return reply.code(400).send(result);
    if (result.phase === 'OUT' && result.leaseId) {
      queueDiffAnalysis(prisma, result.leaseId, { log: req.log });
    }
    return reply.send(result);
  });

  // ——— Análisis diferencial ———
  app.post('/api/inout/leases/:leaseId/analyze-diff', { preHandler: auth }, async (req, reply) => {
    const result = await runDiffAnalysis(prisma, String(req.params.leaseId), {
      log: req.log,
      tenantId: req.ioSession.tenantId
    });
    if (!result.ok) {
      const code = result.error === 'NOT_FOUND' ? 404 : 400;
      return reply.code(code).send(result);
    }
    return reply.send(result);
  });

  app.patch('/api/inout/diffs/:diffId/review', { preHandler: auth }, async (req, reply) => {
    const diff = await prisma.ioDiffResult.findUnique({
      where: { id: String(req.params.diffId) },
      include: { visit: { include: { lease: true } } }
    });
    if (!diff || diff.visit.lease.tenantId !== req.ioSession.tenantId) {
      return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    }
    const reviewStatus = String(req.body?.reviewStatus || '').trim();
    if (!['pending', 'accepted', 'rejected', 'needs_recapture'].includes(reviewStatus)) {
      return reply.code(400).send({ ok: false, error: 'INVALID_STATUS' });
    }
    const updated = await prisma.ioDiffResult.update({
      where: { id: diff.id },
      data: {
        reviewStatus,
        reviewerNote: req.body?.reviewerNote != null ? String(req.body.reviewerNote).slice(0, 2000) : undefined
      }
    });
    return reply.send({ ok: true, diff: updated });
  });

  app.post('/api/inout/leases/:leaseId/close', { preHandler: auth }, async (req, reply) => {
    const lease = await prisma.ioLease.findFirst({
      where: { id: String(req.params.leaseId), tenantId: req.ioSession.tenantId }
    });
    if (!lease) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    await prisma.ioLease.update({
      where: { id: lease.id },
      data: { cycleStatus: 'closed' }
    });
    return reply.send({ ok: true, cycleStatus: 'closed' });
  });

  // Usuarios (admin)
  app.post('/api/inout/users', { preHandler: auth }, async (req, reply) => {
    if (req.ioSession.user.role !== 'ADMIN') {
      return reply.code(403).send({ ok: false, error: 'FORBIDDEN' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const fullName = String(req.body?.fullName || '').trim();
    const password = String(req.body?.password || '');
    const role = normalizeIoRole(req.body?.role) || 'INSPECTOR';
    if (!email || !fullName || password.length < 8) {
      return reply.code(400).send({ ok: false, error: 'INVALID_FIELDS' });
    }
    try {
      const user = await prisma.ioUser.create({
        data: {
          tenantId: req.ioSession.tenantId,
          email,
          fullName,
          role,
          passwordHash: hashPassword(password)
        }
      });
      return reply.send({
        ok: true,
        user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role }
      });
    } catch (err) {
      return reply.code(409).send({ ok: false, error: 'EMAIL_EXISTS', message: err?.message });
    }
  });

  // ——— Informe agregado ———
  app.get('/api/inout/leases/:leaseId/report', { preHandler: auth }, async (req, reply) => {
    const lease = await prisma.ioLease.findFirst({
      where: { id: String(req.params.leaseId), tenantId: req.ioSession.tenantId },
      include: {
        property: true,
        visits: {
          include: {
            slots: {
              orderBy: { sortOrder: 'asc' },
              include: { photos: { orderBy: { capturedAt: 'desc' }, take: 1 } }
            },
            diffResults: true
          }
        },
        reports: { where: { kind: 'DIFF' }, orderBy: { version: 'desc' }, take: 1 }
      }
    });
    if (!lease) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

    const inVisit = lease.visits.find((v) => v.phase === 'IN');
    const outVisit = lease.visits.find((v) => v.phase === 'OUT');
    const diffs = outVisit?.diffResults || [];
    const summary = buildDiffSummary(diffs);

    const items = (outVisit?.slots || []).map((outSlot) => {
      const inSlot = inVisit?.slots?.find((s) => s.slotCode === outSlot.slotCode);
      const diff = diffs.find((d) => d.slotCode === outSlot.slotCode);
      const inPhoto = inSlot?.photos?.[0];
      const outPhoto = outSlot.photos?.[0];
      return {
        slotCode: outSlot.slotCode,
        title: outSlot.title,
        classification: diff?.classification || null,
        severity: diff?.severity || null,
        confidence: diff?.confidence ?? null,
        description: diff?.description || null,
        reviewStatus: diff?.reviewStatus || null,
        diffId: diff?.id || null,
        inPhotoUrl: inPhoto ? `/api/inout/photos/${inPhoto.id}/image` : null,
        outPhotoUrl: outPhoto ? `/api/inout/photos/${outPhoto.id}/image` : null
      };
    });

    return reply.send({
      ok: true,
      lease: {
        id: lease.id,
        cycleStatus: lease.cycleStatus,
        tenantName: lease.tenantName,
        ownerName: lease.ownerName,
        property: lease.property
      },
      summary,
      items,
      report: lease.reports[0] || null,
      disclaimer: DISCLAIMER
    });
  });
}

export { getIoSession };
