import sharp from 'sharp';
import { validatePhotoQuality } from '../photoQuality/validatePhoto.js';
import { getCaseSummary } from './caseSummary.js';

function now() {
  return new Date();
}

function isExpired(tokenRow) {
  if (!tokenRow) return true;
  if (tokenRow.revokedAt) return true;
  if (!tokenRow.expiresAt) return true;
  return new Date(tokenRow.expiresAt).getTime() <= Date.now();
}

async function requireCaptureToken(prisma, token, { allowPendingApproval = false } = {}) {
  const row = await prisma.captureToken.findUnique({
    where: { token },
    select: {
      id: true,
      token: true,
      caseId: true,
      tenantId: true,
      expiresAt: true,
      revokedAt: true,
      case: { select: { status: true, shortId: true } }
    }
  });
  if (isExpired(row)) return null;
  const st = String(row.case?.status || '').toUpperCase();
  if (st === 'CANCELLED') return null;
  if (st === 'PENDING_APPROVAL' && !allowPendingApproval) return null;
  return row;
}

function pendingApprovalCapturePayload(t, slots) {
  const realTotal = Array.isArray(slots) ? slots.length : 0;
  const shortId = t.case?.shortId || '';
  // Apps viejas mapean INVALID_TOKEN → "Enlace vencido". Devolver 200 con slot informativo.
  // total > 0 evita que la app muestre "Cargando..." indefinidamente.
  return {
    ok: true,
    pendingApproval: true,
    approved: false,
    token: t.token,
    caseId: t.caseId,
    shortId,
    expiresAt: t.expiresAt,
    progress: {
      uploaded: 0,
      analyzed: 0,
      omitted: 0,
      rejected: 0,
      pending: Math.max(1, realTotal),
      closed: 0,
      total: Math.max(1, realTotal),
      pct: 0,
      doneCycle: false
    },
    canFinish: false,
    slot: {
      id: '__pending_approval__',
      slotCode: 'PENDING_APPROVAL',
      title: 'Pendiente de aprobación',
      instructions:
        'Esperando al administrador. Cuando apruebe (1 crédito) esta pantalla se actualizará sola y podrás capturar.',
      orderIndex: 0,
      status: 'PENDING',
      photoUrl: null
    },
    message:
      'Pendiente de aprobación del administrador. Cuando aprueben podrás capturar.'
  };
}

function pendingApprovalBlockedReply(reply) {
  return reply.code(403).send({
    ok: false,
    error: 'PENDING_APPROVAL',
    message: 'Esta inspección aún no está aprobada por el administrador. No se pueden capturar fotos hasta entonces.'
  });
}

function pickNextSlot(slots) {
  const pending = slots.find((s) => String(s.status || '').toUpperCase() === 'PENDING');
  if (pending) return pending;
  return slots.find((s) => String(s.status || '').toUpperCase() === 'REJECTED') || null;
}

function computeProgress(slots) {
  const total = slots.length;
  const uploaded = slots.filter((s) => ['UPLOADED', 'ANALYZED', 'REJECTED'].includes(String(s.status || '').toUpperCase())).length;
  const analyzed = slots.filter((s) => String(s.status || '').toUpperCase() === 'ANALYZED').length;
  const omitted = slots.filter((s) => String(s.status || '').toUpperCase() === 'NOT_CAPTURABLE').length;
  const rejected = slots.filter((s) => String(s.status || '').toUpperCase() === 'REJECTED').length;
  const pending = slots.filter((s) => String(s.status || '').toUpperCase() === 'PENDING').length;
  const closed = analyzed + omitted;
  const pct = total ? Math.round((closed / total) * 100) : 0;
  const doneCycle = total > 0 && pending === 0 && rejected === 0;
  return { uploaded, analyzed, omitted, rejected, pending, closed, total, pct, doneCycle };
}

const REPEAT_CODES = new Set([
  'PHOTO_TOO_DARK',
  'PHOTO_TOO_SMALL',
  'PHOTO_TOO_BLURRY',
  'PHOTO_TOO_BRIGHT',
  'NOT_PROPERTY_IMAGE',
  'SLOT_MISMATCH'
]);

export async function registerCaptureRoutes(app, {
  prisma,
  storage,
  safeExtFromMime,
  analyzeImageBufferV1,
  validateSlotMatchWithOpenAI,
  slotGroupFromSlotCode,
  queueOpenAiSlotAnalysis,
  sendCaseToReview,
  notifyExecutiveReportIfReady,
  queueExecutiveSummaryForCase,
  recordReportAccuracyOnComplete,
  runtimeScoreConfig,
  slotGroupTitleFromCode
}) {
  const mapSlotForResponse = (next) => next
    ? {
        id: next.id,
        slotCode: next.slotCode,
        title: next.title,
        instructions: next.instructions,
        orderIndex: next.orderIndex,
        status: next.status,
        photoUrl: next.photo?.filePath ? storage.publicUrl(next.photo.filePath) : null
      }
    : null;
  // Página de captura (móvil)
  app.get('/capture/:token', async (req, reply) => {
    if (!prisma) return reply.code(500).send('DATABASE_NOT_CONFIGURED');
    const token = String(req.params.token || '');
    const t = await requireCaptureToken(prisma, token);
    if (!t) return reply.code(404).send('CAPTURE_TOKEN_NOT_FOUND');
    return reply.sendFile('capture.html');
  });

  // Siguiente slot por token
  app.get('/api/capture/:token/next', async (req, reply) => {
    if (!prisma) {
      return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    }

    const token = String(req.params.token || '');
    const t = await requireCaptureToken(prisma, token, { allowPendingApproval: true });
    if (!t) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const slots = await prisma.slot.findMany({
      where: { caseId: t.caseId },
      orderBy: { orderIndex: 'asc' },
      include: { photo: true }
    });

    if (String(t.case?.status || '').toUpperCase() === 'PENDING_APPROVAL') {
      return reply.send(pendingApprovalCapturePayload(t, slots));
    }

    const next = pickNextSlot(slots);
    const progress = computeProgress(slots);

    return reply.send({
      ok: true,
      pendingApproval: false,
      approved: true,
      token: t.token,
      caseId: t.caseId,
      expiresAt: t.expiresAt,
      progress,
      canFinish: !!progress.doneCycle,
      slot: mapSlotForResponse(next)
    });
  });

  // Listado completo de slots para revisión/retoma al final del flujo
  app.get('/api/capture/:token/slots', async (req, reply) => {
    if (!prisma) {
      return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    }

    const token = String(req.params.token || '');
    const t = await requireCaptureToken(prisma, token, { allowPendingApproval: true });
    if (!t) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const slots = await prisma.slot.findMany({
      where: { caseId: t.caseId },
      orderBy: { orderIndex: 'asc' },
      include: { photo: true }
    });

    if (String(t.case?.status || '').toUpperCase() === 'PENDING_APPROVAL') {
      const payload = pendingApprovalCapturePayload(t, slots);
      return reply.send({
        ok: true,
        pendingApproval: true,
        caseId: t.caseId,
        progress: payload.progress,
        canFinish: false,
        slots: [],
        message: payload.message
      });
    }

    const progress = computeProgress(slots);

    return reply.send({
      ok: true,
      caseId: t.caseId,
      progress,
      canFinish: !!progress.doneCycle,
      slots: slots.map((s) => ({
        id: s.id,
        slotCode: s.slotCode,
        title: s.title,
        instructions: s.instructions,
        orderIndex: s.orderIndex,
        status: s.status,
        photoUrl: s.photo?.filePath ? storage.publicUrl(s.photo.filePath) : null
      }))
    });
  });

  app.post('/api/capture/:token/slots/:slotId/omit', async (req, reply) => {
    if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    const token = String(req.params.token || '');
    const slotId = String(req.params.slotId || '');
    const t = await requireCaptureToken(prisma, token, { allowPendingApproval: true });
    if (!t) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });
    if (String(t.case?.status || '').toUpperCase() === 'PENDING_APPROVAL') {
      return pendingApprovalBlockedReply(reply);
    }
    if (slotId === '__pending_approval__') {
      return pendingApprovalBlockedReply(reply);
    }

    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      select: { id: true, caseId: true, status: true }
    });
    if (!slot || slot.caseId !== t.caseId) return reply.code(404).send({ ok: false, error: 'SLOT_NOT_FOUND' });

    const current = String(slot.status || '').toUpperCase();
    if (current === 'ANALYZED' || current === 'NOT_CAPTURABLE') {
      const slots = await prisma.slot.findMany({
        where: { caseId: slot.caseId },
        orderBy: { orderIndex: 'asc' },
        include: { photo: true }
      });
      const next = pickNextSlot(slots);
      const progress = computeProgress(slots);
      return reply.send({ ok: true, skipped: true, alreadyClosed: true, progress, canFinish: !!progress.doneCycle, nextSlotId: next?.id ?? null, slot: mapSlotForResponse(next) });
    }

    await prisma.slot.update({
      where: { id: slot.id },
      data: {
        status: 'NOT_CAPTURABLE',
        analysisCode: 'NOT_CAPTURABLE',
        analysisSeverity: 'low',
        analysisConfidence: 1,
        analysisMessage: 'Foto omitida por el usuario: no fue posible capturar esta toma.',
        analysisDebug: { source: 'USER_SKIP', at: now().toISOString() },
        analyzedAt: now()
      }
    });

    const slots = await prisma.slot.findMany({
      where: { caseId: slot.caseId },
      orderBy: { orderIndex: 'asc' },
      include: { photo: true }
    });
    const next = pickNextSlot(slots);
    const progress = computeProgress(slots);
    return reply.send({ ok: true, skipped: true, progress, canFinish: !!progress.doneCycle, nextSlotId: next?.id ?? null, slot: mapSlotForResponse(next) });
  });

  app.post('/api/capture/:token/finish', async (req, reply) => {
    if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    const token = String(req.params.token || '');
    const t = await requireCaptureToken(prisma, token, { allowPendingApproval: true });
    if (!t) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });
    if (String(t.case?.status || '').toUpperCase() === 'PENDING_APPROVAL') {
      return pendingApprovalBlockedReply(reply);
    }

    const slots = await prisma.slot.findMany({ where: { caseId: t.caseId }, orderBy: { orderIndex: 'asc' } });
    const progress = computeProgress(slots);
    if (!progress.doneCycle) return reply.code(400).send({ ok: false, error: 'CYCLE_NOT_COMPLETED', progress });

    const c = await prisma.case.findUnique({
      where: { id: t.caseId },
      select: { id: true, reviewStatus: true }
    });
    if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

    const rev = String(c.reviewStatus || '').toLowerCase();
    if (rev === 'pending_review' || rev === 'approved') {
      return reply.send({ ok: true, alreadyFinished: true, reviewStatus: c.reviewStatus || 'pending_review', progress });
    }

    // SSOT: Calcular score UNA SOLA VEZ al completar el caso
    let scoringData = null;
    try {
      const summary = await getCaseSummary({
        prisma,
        storage,
        caseId: c.id,
        slotGroupTitleFromCode: slotGroupTitleFromCode || slotGroupFromSlotCode,
        scoreConfig: runtimeScoreConfig?.config,
        scoreConfigUpdatedAt: runtimeScoreConfig?.updatedAt
      });

      if (summary.ok && summary.score != null) {
        // Construir kpiScores desde byGroup
        const kpiScores = {};
        if (summary.byGroup) {
          summary.byGroup.forEach(kpi => {
            if (kpi.groupKey && kpi.scoreIfOnlyGroup != null) {
              kpiScores[kpi.groupKey] = kpi.scoreIfOnlyGroup;
            }
          });
        }

        scoringData = {
          finalScore: summary.score ?? null,
          finalBadge: summary.badge ?? null,
          scoreVersion: 'SCORING_V2_2_KPI',
          kpiScores: Object.keys(kpiScores).length > 0 ? kpiScores : null,
          scoredAt: new Date()
        };
      }
    } catch (err) {
      app.log.warn({ err, caseId: c.id }, 'Failed to calculate score on case completion');
    }

    // Persistir score en DB junto con status DONE
    await prisma.case.update({
      where: { id: c.id },
      data: {
        status: 'DONE',
        ...(scoringData || {})
      }
    });

    if (typeof recordReportAccuracyOnComplete === 'function') {
      recordReportAccuracyOnComplete(prisma, c.id).catch(() => {});
    }

    let notified = false;
    try {
      if (typeof sendCaseToReview === 'function') {
        const sent = await sendCaseToReview(c.id);
        notified = !!sent?.ok;
      }
    } catch (_) {}

    try {
      if (typeof notifyExecutiveReportIfReady === 'function') {
        await notifyExecutiveReportIfReady(c.id);
      }
    } catch (_) {}

    if (typeof queueExecutiveSummaryForCase === 'function') {
      queueExecutiveSummaryForCase(c.id).catch(() => {});
    }

    return reply.send({ ok: true, finished: true, reviewStatus: 'pending_review', notified, progress });
  });

  // Subir + validar captura (OK / REPEAT)
  app.post('/api/capture/:token/slots/:slotId/capture', async (req, reply) => {
    if (!prisma) {
      return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    }

    const token = String(req.params.token || '');
    const slotId = String(req.params.slotId || '');

    const t = await requireCaptureToken(prisma, token, { allowPendingApproval: true });
    if (!t) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });
    if (String(t.case?.status || '').toUpperCase() === 'PENDING_APPROVAL' || slotId === '__pending_approval__') {
      return pendingApprovalBlockedReply(reply);
    }

    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      select: { id: true, caseId: true, slotCode: true, title: true, instructions: true, orderIndex: true, status: true }
    });
    if (!slot || slot.caseId !== t.caseId) return reply.code(404).send({ ok: false, error: 'SLOT_NOT_FOUND' });

    const captureStartedAt = Date.now();
    const part = await req.file({ limits: { fileSize: 8 * 1024 * 1024 } });
    if (!part) return reply.code(400).send({ ok: false, error: 'NO_FILE' });
    if (part.fieldname && part.fieldname !== 'photo') {
      return reply.code(400).send({ ok: false, error: 'INVALID_FIELD', expected: 'photo', got: part.fieldname });
    }

    const mimeType = part.mimetype;
    const ext = safeExtFromMime(mimeType);
    if (!ext) return reply.code(400).send({ ok: false, error: 'UNSUPPORTED_TYPE', mimeType });

    const buffer = await part.toBuffer();
    const receiveMs = Date.now() - captureStartedAt;

    // 1) Calidad local (rápida). 2) Slot-match IA (única IA bloqueante). 3) GCS + DB. Análisis KPI en background.
    const qualityResult = await validatePhotoQuality(buffer, undefined, {
      slotCode: slot.slotCode,
      slotTitle: slot.title,
      instructions: slot.instructions
    });
    let analysis;
    if (!qualityResult.ok) {
      analysis = { meta: {}, problem: qualityResult.problem };
    } else {
      analysis = {
        meta: {},
        problem: {
          code: 'OK',
          severity: null,
          confidence: null,
          message: 'Foto aceptada. El análisis técnico continúa en segundo plano.',
          debug: qualityResult.debug ? { quality: qualityResult.debug, analysisPhase: 'pending_deep' } : { analysisPhase: 'pending_deep' }
        }
      };

      if (typeof validateSlotMatchWithOpenAI === 'function') {
        const slotMatch = await validateSlotMatchWithOpenAI({
          buffer,
          mimeType,
          slotTitle: slot.title,
          slotCode: slot.slotCode,
          instructions: slot.instructions
        });
        const minPositiveConfidence = Math.max(0, Math.min(1, Number(process.env.SLOT_MATCH_MIN_POSITIVE_CONFIDENCE || 0.5)));
        const failOpen = String(process.env.SLOT_MATCH_FAIL_OPEN || 'true').toLowerCase() === 'true';
        const isMismatch = slotMatch.checked && slotMatch.matchesSlot === false;
        const isLowConfidencePositive = slotMatch.checked && slotMatch.matchesSlot === true && slotMatch.confidence < minPositiveConfidence;
        const isUncheckedAndStrict = !slotMatch.checked && !failOpen;
        analysis.problem.debug = {
          ...(analysis.problem.debug || {}),
          slotMatch,
          slotMatchMinPositiveConfidence: minPositiveConfidence,
          slotMatchFailOpen: failOpen
        };
        if (isMismatch || isLowConfidencePositive || isUncheckedAndStrict) {
          const reasonText = isUncheckedAndStrict
            ? 'No fue posible validar con certeza que la foto corresponde al componente solicitado.'
            : isMismatch
            ? (slotMatch.reason || 'El componente detectado no coincide con el slot esperado.')
            : isLowConfidencePositive
            ? `La IA no tuvo suficiente certeza de correspondencia (${Math.round(slotMatch.confidence * 100)}%).`
            : 'Validación de componente no superada.';
          analysis.problem = {
            code: 'SLOT_MISMATCH',
            severity: 'medium',
            confidence: slotMatch.confidence,
            message: `La foto no parece corresponder a "${slot.title || slot.slotCode}". ${reasonText}`,
            debug: { ...analysis.problem.debug, expectedSlot: { code: slot.slotCode, title: slot.title || null } }
          };
        }
      }
    }

    const finalCode = String(analysis.problem.code || '').toUpperCase();
    const passed = !REPEAT_CODES.has(finalCode);
    const nextStatus = passed ? 'UPLOADED' : 'REJECTED';

    let saved = null;
    let width = null;
    let height = null;
    let originalFileName = part.filename || 'capture.jpg';
    let filePath = null;

    if (passed) {
      saved = await storage.saveImageBuffer({
        buffer,
        contentType: mimeType,
        ext,
        caseId: slot.caseId
      });
      try {
        const m = await sharp(buffer).metadata();
        width = m.width ?? null;
        height = m.height ?? null;
      } catch {
        // ignore
      }
      originalFileName = part.filename || saved.storedFileName;
      filePath = saved.filePath;
    }

    const result = await prisma.$transaction(async (tx) => {
      let photo = null;
      if (passed && saved && filePath) {
        photo = await tx.photo.create({
          data: {
            id: saved.id,
            slotId: slot.id,
            tenantId: t.tenantId || null,
            caseId: slot.caseId,
            filePath,
            fileName: originalFileName,
            mimeType,
            fileSize: buffer.length,
            width,
            height
          }
        });
      }

      const updatedSlot = await tx.slot.update({
        where: { id: slot.id },
        data: {
          status: nextStatus,
          photoId: photo?.id ?? null,
          analysisCode: analysis.problem.code,
          analysisSeverity: analysis.problem.severity,
          analysisConfidence: analysis.problem.confidence ?? null,
          analysisMessage: analysis.problem.message,
          analysisDebug: analysis.problem.debug ?? null,
          analyzedAt: passed ? null : now()
        },
        select: { id: true, status: true }
      });

      return { photo, slot: updatedSlot };
    });

    // next slot info
    const slots = await prisma.slot.findMany({
      where: { caseId: slot.caseId },
      orderBy: { orderIndex: 'asc' }
    });
    const next = pickNextSlot(slots);
    const progress = computeProgress(slots);

    // Ejecutar análisis OpenAI en background si corresponde (no bloquea UX)
    if (passed && typeof queueOpenAiSlotAnalysis === 'function') {
      queueOpenAiSlotAnalysis({ slotId: result.slot.id, caseId: slot.caseId });
    }

    const durationMs = Math.max(0, Date.now() - captureStartedAt);
    const processMs = Math.max(0, durationMs - receiveMs);
    req.log.info(
      { caseId: slot.caseId, slotId: result.slot.id, durationMs, receiveMs, processMs, passed, imageBytes: buffer.length },
      'capture-upload-timing'
    );
    void prisma.captureUploadMetric
      .create({
        data: {
          caseId: slot.caseId,
          tenantId: t.tenantId || null,
          slotId: result.slot.id,
          durationMs,
          passed,
          imageBytes: buffer.length
        }
      })
      .catch((err) => req.log.warn(err, 'capture-upload-metric'));

    return reply.send({
      ok: true,
      passed,
      caseId: slot.caseId,
      slotId: result.slot.id,
      slotStatus: result.slot.status,
      problem: analysis.problem,
      photo: result.photo
        ? {
            id: result.photo.id,
            url: storage.publicUrl(filePath),
            mimeType,
            size: buffer.length,
            width,
            height
          }
        : null,
      progress,
      nextSlotId: next?.id ?? null
    });
  });
}

