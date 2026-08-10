import { analyzeSanitarySlotQuick } from '../analysis/analyzeSanitarySlot.js';
import { extFromPostventaMime, preparePostventaMedia } from '../capture/prepareMedia.js';
import { buildSanitaryCapturePlan, getSanitarySlotMeta } from '../capture/sanitaryCatalog.js';
import { SLOT_SPOKEN_HINTS } from '../capture/slotTemplates.js';
import { buildSingleCaptureGuide } from '../capture/singleCaptureSlot.js';
import { sendPostventaTicketCopyEmail } from '../../email.js';
import {
  ensurePostventaAnalysisQueued,
  finalizeTicketCapture
} from '../services/ensureAnalysis.js';

function isSessionExpired(session) {
  if (!session?.expiresAt) return true;
  return new Date(session.expiresAt).getTime() <= Date.now();
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} token
 */
async function requirePvCaptureSession(prisma, token) {
  const session = await prisma.pvCaptureSession.findUnique({
    where: { token },
    include: {
      ticket: {
        select: {
          id: true,
          shortId: true,
          tenantId: true,
          summary: true,
          roomHint: true,
          preliminaryCategory: true,
          status: true,
          ownerId: true,
          owner: { select: { fullName: true, email: true } }
        }
      },
      slots: { orderBy: { sortOrder: 'asc' } }
    }
  });
  if (!session || isSessionExpired(session)) return null;
  return session;
}

function isSlotClosed(status) {
  return ['uploaded', 'skipped', 'analyzed'].includes(String(status));
}

/**
 * @param {Array<{ status: string, slotCode?: string }>} slots
 * @param {{ category?: string, earlyFinishAllowed?: boolean }} [opts]
 */
function computeProgress(slots, opts = {}) {
  const category = opts.category || '';
  const total = slots.length;
  const done = slots.filter((s) => isSlotClosed(s.status)).length;
  const rejected = slots.filter((s) => String(s.status) === 'rejected').length;
  const pending = slots.filter((s) => String(s.status) === 'pending').length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  let canFinish = false;
  if (category === 'sanitarios') {
    const required = slots.filter((s) => !getSanitarySlotMeta(s.slotCode).optional);
    const requiredDone = required.length > 0 && required.every((s) => isSlotClosed(s.status));
    const requiredRejected = required.some((s) => String(s.status) === 'rejected');
    const optionalPending = slots.some(
      (s) => getSanitarySlotMeta(s.slotCode).optional && String(s.status) === 'pending'
    );
    canFinish =
      requiredDone &&
      !requiredRejected &&
      (!optionalPending || Boolean(opts.earlyFinishAllowed));
  } else {
    canFinish = total > 0 && pending === 0 && rejected === 0;
  }

  return { total, done, rejected, pending, pct, canFinish };
}

/**
 * @param {Array<{ id: string, status: string, sortOrder: number }>} slots
 */
function pickNextSlot(slots) {
  const pending = slots.find((s) => s.status === 'pending');
  if (pending) return pending;
  return slots.find((s) => s.status === 'rejected') || null;
}

/**
 * @param {object} slot
 * @param {{ publicUrl: (p: string) => string | null }} storage
 * @param {{ category?: string }} [ctx]
 */
function mapSlot(slot, storage, ctx = {}) {
  if (!slot) return null;
  const category = ctx.category || '';
  const meta =
    category === 'sanitarios'
      ? getSanitarySlotMeta(slot.slotCode)
      : { mediaType: 'photo', optional: false, required: true };
  const spokenHint =
    slot.slotCode === 'single_evidence'
      ? slot.instructions
      : SLOT_SPOKEN_HINTS[slot.slotCode] || slot.instructions || null;
  const isVideo = meta.mediaType === 'video';
  return {
    id: slot.id,
    slotCode: slot.slotCode,
    title: slot.title,
    instructions: slot.instructions,
    captureLabel: slot.slotCode === 'single_evidence' ? slot.title : null,
    sortOrder: slot.sortOrder,
    status: slot.status,
    mediaType: meta.mediaType || 'photo',
    optional: Boolean(meta.optional),
    required: meta.optional ? false : true,
    spokenHint: spokenHint ? spokenHint.replace(/\*\*/g, '') : null,
    photoUrl: slot.photoPath ? storage.publicUrl(slot.photoPath) : null,
    isVideo,
    rejectMessage: slot.rejectMessage || null
  };
}

function progressForSession(session, earlyFinishAllowed = false) {
  return computeProgress(session.slots, {
    category: session.category,
    earlyFinishAllowed
  });
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ prisma: import('@prisma/client').PrismaClient, storage: object, safeExtFromMime: (m: string) => string | null }} deps
 */
export async function registerPostventaCaptureRoutes(app, { prisma, storage, safeExtFromMime, queuePostventaTicketAnalysis }) {
  app.get('/postventa/capture/:token', async (req, reply) => {
    if (!prisma) return reply.code(500).send('DATABASE_NOT_CONFIGURED');
    const token = String(req.params.token || '');
    const session = await requirePvCaptureSession(prisma, token);
    if (!session) return reply.code(404).send('CAPTURE_TOKEN_NOT_FOUND');
    return reply.sendFile('postventa/capture.html');
  });

  app.get('/api/postventa/capture/:token/next', async (req, reply) => {
    if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    const token = String(req.params.token || '');
    const session = await requirePvCaptureSession(prisma, token);
    if (!session) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const next = pickNextSlot(session.slots);
    const progress = progressForSession(session);

    return reply.send({
      ok: true,
      token: session.token,
      ticketShortId: session.ticket.shortId,
      category: session.category,
      expiresAt: session.expiresAt,
      progress,
      canFinish: progress.canFinish,
      slot: mapSlot(next, storage, { category: session.category })
    });
  });

  app.get('/api/postventa/capture/:token/guide', async (req, reply) => {
    if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    const token = String(req.params.token || '');
    const session = await requirePvCaptureSession(prisma, token);
    if (!session) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const guide = buildSingleCaptureGuide({
      summary: session.ticket.summary || '',
      roomHint: session.ticket.roomHint || '',
      category: session.category
    }).map((g) => ({
      ...g,
      spoken: g.spoken.replace(/\*\*/g, '')
    }));

    return reply.send({
      ok: true,
      ticketShortId: session.ticket.shortId,
      category: session.category,
      guide
    });
  });

  app.get('/api/postventa/capture/:token/slots', async (req, reply) => {
    if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    const token = String(req.params.token || '');
    const session = await requirePvCaptureSession(prisma, token);
    if (!session) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const progress = progressForSession(session);
    return reply.send({
      ok: true,
      ticketShortId: session.ticket.shortId,
      category: session.category,
      progress,
      canFinish: progress.canFinish,
      slots: session.slots.map((s) => mapSlot(s, storage, { category: session.category }))
    });
  });

  app.post('/api/postventa/capture/:token/slots/:slotId/omit', async (req, reply) => {
    if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    const token = String(req.params.token || '');
    const slotId = String(req.params.slotId || '');
    const session = await requirePvCaptureSession(prisma, token);
    if (!session) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const slot = session.slots.find((s) => s.id === slotId);
    if (!slot) return reply.code(404).send({ ok: false, error: 'SLOT_NOT_FOUND' });

    const slotMeta = getSanitarySlotMeta(slot.slotCode);
    if (session.category === 'sanitarios' && !slotMeta.optional) {
      return reply.code(400).send({
        ok: false,
        error: 'SLOT_REQUIRED',
        message:
          slotMeta.mediaType === 'video'
            ? 'Este video es obligatorio para documentar el problema.'
            : 'Esta evidencia es obligatoria; no se puede omitir.'
      });
    }

    if (!['pending', 'rejected'].includes(slot.status)) {
      const refreshed = await requirePvCaptureSession(prisma, token);
      const next = pickNextSlot(refreshed.slots);
      const progress = progressForSession(refreshed);
      return reply.send({
        ok: true,
        skipped: true,
        alreadyClosed: true,
        progress,
        canFinish: progress.canFinish,
        slot: mapSlot(next, storage, { category: refreshed.category })
      });
    }

    await prisma.pvCaptureSlot.update({
      where: { id: slot.id },
      data: { status: 'skipped', rejectMessage: null }
    });

    const refreshed = await requirePvCaptureSession(prisma, token);
    const next = pickNextSlot(refreshed.slots);
    const progress = progressForSession(refreshed);
    return reply.send({
      ok: true,
      skipped: true,
      progress,
      canFinish: progress.canFinish,
      slot: mapSlot(next, storage, { category: refreshed.category })
    });
  });

  app.post('/api/postventa/capture/:token/slots/:slotId/capture', async (req, reply) => {
    if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    const token = String(req.params.token || '');
    const slotId = String(req.params.slotId || '');
    const session = await requirePvCaptureSession(prisma, token);
    if (!session) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const slot = session.slots.find((s) => s.id === slotId);
    if (!slot) return reply.code(404).send({ ok: false, error: 'SLOT_NOT_FOUND' });

    const slotMeta =
      session.category === 'sanitarios'
        ? getSanitarySlotMeta(slot.slotCode)
        : { mediaType: 'photo', optional: false };

    try {
      const maxBytes = slotMeta.mediaType === 'video' ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
      const part = await req.file({ limits: { fileSize: maxBytes } });
      if (!part) return reply.code(400).send({ ok: false, error: 'NO_FILE' });

      const rawMime = part.mimetype;
      const rawBuffer = await part.toBuffer();

      const mediaResult = await preparePostventaMedia(rawBuffer, rawMime, {
        slotCode: slot.slotCode,
        mediaType: slotMeta.mediaType
      });

      if (!mediaResult.ok) {
        const message = mediaResult.problem?.message || 'El archivo no cumple los requisitos.';
        await prisma.pvCaptureSlot.update({
          where: { id: slot.id },
          data: { status: 'rejected', rejectMessage: message }
        });
        const refreshed = await requirePvCaptureSession(prisma, token);
        const next = pickNextSlot(refreshed.slots);
        return reply.send({
          ok: false,
          repeat: true,
          error: mediaResult.problem?.code || 'MEDIA_FAILED',
          message,
          slot: mapSlot(next || slot, storage, { category: refreshed.category }),
          progress: progressForSession(refreshed)
        });
      }

      const { buffer, mimeType, isVideo } = mediaResult;
      const ext = extFromPostventaMime(mimeType) || safeExtFromMime(mimeType) || (isVideo ? 'mp4' : 'jpg');

      const tenantId = session.ticket.tenantId;
      const storageKey =
        storage.driver === 'gcs'
          ? `postventa/${tenantId}/${session.ticket.id}/${slot.id}.${String(ext).replace('.', '')}`
          : `postventa-${session.ticket.id}-${slot.id}.${String(ext).replace('.', '')}`;

      const saved = await storage.saveImageBuffer({
        buffer,
        contentType: mimeType,
        ext,
        tenantId,
        storageKey
      });

      await prisma.pvCaptureSlot.update({
        where: { id: slot.id },
        data: {
          status: 'uploaded',
          photoPath: saved.filePath,
          mimeType,
          rejectMessage: null,
          uploadedAt: new Date()
        }
      });

      await prisma.pvTicketEvent.create({
        data: {
          ticketId: session.ticket.id,
          eventType: 'capture_slot_uploaded',
          payload: {
            slotId: slot.id,
            slotCode: slot.slotCode,
            photoPath: saved.filePath,
            isVideo: !!isVideo
          }
        }
      });

      let slotAnalysis = null;
      if (session.category === 'sanitarios' && !isVideo) {
        const plan = buildSanitaryCapturePlan(session.ticket.summary, session.ticket.roomHint);
        slotAnalysis = await analyzeSanitarySlotQuick({
          buffer,
          mimeType,
          isVideo: false,
          ticketSummary: session.ticket.summary || '',
          findingCode: plan.findingCode,
          slotCode: slot.slotCode,
          slotTitle: slot.title,
          slotInstructions: slot.instructions || '',
          log: req.log
        });
        if (slotAnalysis) {
          await prisma.pvTicketEvent.create({
            data: {
              ticketId: session.ticket.id,
              eventType: 'sanitary_slot_analysis',
              payload: { slotId: slot.id, slotCode: slot.slotCode, ...slotAnalysis }
            }
          }).catch(() => {});
        }
      }

      const refreshed = await requirePvCaptureSession(prisma, token);
      const next = pickNextSlot(refreshed.slots);
      const progress = progressForSession(refreshed, Boolean(slotAnalysis?.canFinishEarly));

      // Si ya no quedan slots, cerrar captura sola (evita "pendiente de fotos" con evidencia)
      let autoFinished = false;
      if (progress.canFinish && !next && refreshed.ticket.status === 'pending_evidence') {
        await finalizeTicketCapture(
          prisma,
          refreshed.ticket,
          {
            captureSessionId: refreshed.id,
            token,
            slotsDone: progress.done,
            source: 'upload_auto_finish'
          },
          queuePostventaTicketAnalysis
        );
        autoFinished = true;
      }

      return reply.send({
        ok: true,
        photoUrl: storage.publicUrl(saved.filePath),
        isVideo: !!isVideo,
        slotAnalysis,
        progress,
        canFinish: progress.canFinish,
        earlyFinishAllowed: Boolean(slotAnalysis?.canFinishEarly),
        autoFinished,
        status: autoFinished ? 'pending_ai_analysis' : refreshed.ticket.status,
        slot: mapSlot(next, storage, { category: refreshed.category })
      });
    } catch (err) {
      req.log.error({ err, token, slotId }, 'postventa capture upload');
      return reply.code(500).send({
        ok: false,
        error: 'UPLOAD_FAILED',
        message: slotMeta.mediaType === 'video'
          ? 'No se pudo subir el video. Intenta de nuevo.'
          : 'No se pudo subir la foto. Intenta de nuevo.'
      });
    }
  });

  app.post('/api/postventa/capture/:token/finish', async (req, reply) => {
    if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    const token = String(req.params.token || '');
    const session = await requirePvCaptureSession(prisma, token);
    if (!session) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const progress = progressForSession(session, true);
    if (!progress.canFinish) {
      return reply.code(400).send({ ok: false, error: 'CAPTURE_INCOMPLETE', progress });
    }

    const postCaptureStatuses = new Set([
      'evidence_received',
      'pending_ai_analysis',
      'classified',
      'routed',
      'in_review',
      'closed'
    ]);
    if (postCaptureStatuses.has(session.ticket.status)) {
      if (
        session.ticket.status === 'evidence_received' &&
        typeof queuePostventaTicketAnalysis === 'function'
      ) {
        await ensurePostventaAnalysisQueued(
          prisma,
          session.ticket.id,
          queuePostventaTicketAnalysis
        );
      }
      const refreshed = await requirePvCaptureSession(prisma, token);
      return reply.send({
        ok: true,
        alreadyFinished: true,
        ticketShortId: refreshed.ticket.shortId,
        status: refreshed.ticket.status,
        reportUrl: `/postventa/report/${encodeURIComponent(refreshed.ticket.shortId)}`,
        progress
      });
    }

    await finalizeTicketCapture(
      prisma,
      session.ticket,
      {
        captureSessionId: session.id,
        token,
        slotsDone: progress.done,
        source: 'capture_finish'
      },
      queuePostventaTicketAnalysis
    );

    return reply.send({
      ok: true,
      finished: true,
      ticketShortId: session.ticket.shortId,
      status: 'pending_ai_analysis',
      reportUrl: `/postventa/report/${encodeURIComponent(session.ticket.shortId)}`,
      message: 'Fotos recibidas. Estamos generando el informe técnico preliminar con IA.',
      ownerEmail: session.ticket.owner?.email || null,
      ownerName: session.ticket.owner?.fullName || null,
      progress
    });
  });

  app.post('/api/postventa/capture/:token/send-copy', async (req, reply) => {
    if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    const token = String(req.params.token || '');
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ ok: false, error: 'INVALID_EMAIL', message: 'Ingresa un correo válido.' });
    }

    const session = await requirePvCaptureSession(prisma, token);
    if (!session) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const finishedStatuses = new Set([
      'evidence_received',
      'pending_ai_analysis',
      'classified',
      'routed',
      'in_review',
      'closed'
    ]);
    if (!finishedStatuses.has(session.ticket.status)) {
      return reply.code(400).send({
        ok: false,
        error: 'TICKET_NOT_FINISHED',
        message: 'Primero completa y envía todas las fotos.'
      });
    }

    const ownerName = session.ticket.owner?.fullName || '';
    const mail = await sendPostventaTicketCopyEmail(email, {
      ticketShortId: session.ticket.shortId,
      summary: session.ticket.summary,
      ownerName
    });

    if (!mail.ok && !mail.skipped) {
      return reply.code(500).send({
        ok: false,
        error: 'EMAIL_FAILED',
        message: mail.error || 'No se pudo enviar el correo. Intenta de nuevo.'
      });
    }

    if (session.ticket.owner?.email !== email && session.ticket.ownerId) {
      await prisma.pvOwner.update({
        where: { id: session.ticket.ownerId },
        data: { email }
      }).catch(() => {});
    }

    await prisma.pvTicketEvent.create({
      data: {
        ticketId: session.ticket.id,
        eventType: 'copy_email_sent',
        payload: { email, messageId: mail.id || null, skipped: !!mail.skipped }
      }
    });

    return reply.send({
      ok: true,
      sent: !mail.skipped,
      skipped: !!mail.skipped,
      ticketShortId: session.ticket.shortId,
      email,
      message: mail.skipped
        ? 'Copia registrada. El correo se enviará cuando el servicio esté disponible.'
        : `Te enviamos una copia de tu solicitud a ${email}.`
    });
  });
}
