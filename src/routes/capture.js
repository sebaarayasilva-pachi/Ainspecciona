import sharp from 'sharp';

function now() {
  return new Date();
}

function isExpired(tokenRow) {
  if (!tokenRow) return true;
  if (tokenRow.revokedAt) return true;
  if (!tokenRow.expiresAt) return true;
  return new Date(tokenRow.expiresAt).getTime() <= Date.now();
}

async function requireCaptureToken(prisma, token) {
  const row = await prisma.captureToken.findUnique({
    where: { token },
    select: { id: true, token: true, caseId: true, tenantId: true, expiresAt: true, revokedAt: true }
  });
  if (isExpired(row)) return null;
  return row;
}

async function laplacianVarianceFromBuffer(buffer) {
  // Downsample to make it fast and stable
  const { data, info } = await sharp(buffer)
    .rotate()
    .greyscale()
    .resize({ width: 512, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h || w < 5 || h < 5) return { variance: 0, width: w, height: h };

  // Sample every 2px for speed
  const step = 2;
  let count = 0;
  let mean = 0;
  let m2 = 0;

  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const idx = y * w + x;
      const c = data[idx];
      const up = data[idx - w];
      const dn = data[idx + w];
      const lf = data[idx - 1];
      const rt = data[idx + 1];
      const lap = -4 * c + up + dn + lf + rt;

      count++;
      const delta = lap - mean;
      mean += delta / count;
      const delta2 = lap - mean;
      m2 += delta * delta2;
    }
  }

  const variance = count > 1 ? m2 / (count - 1) : 0;
  return { variance, width: w, height: h };
}

function pickNextSlot(slots) {
  const pending = slots.find((s) => String(s.status || '').toUpperCase() === 'PENDING');
  if (pending) return pending;
  return slots.find((s) => String(s.status || '').toUpperCase() === 'REJECTED') || null;
}

function computeProgress(slots) {
  const total = slots.length;
  const uploaded = slots.filter((s) =>
    ['UPLOADED', 'ANALYZED', 'REJECTED'].includes(String(s.status || '').toUpperCase())
  ).length;
  const analyzed = slots.filter((s) => String(s.status || '').toUpperCase() === 'ANALYZED').length;
  const pct = total ? Math.round((uploaded / total) * 100) : 0;
  return { uploaded, analyzed, total, pct };
}

const REPEAT_CODES = new Set([
  'PHOTO_TOO_DARK',
  'PHOTO_TOO_SMALL',
  'PHOTO_TOO_BLURRY',
  'NOT_PROPERTY_IMAGE'
]);

export async function registerCaptureRoutes(app, { prisma, storage, safeExtFromMime, analyzeImageBufferV1, slotGroupFromSlotCode, queueOpenAiSlotAnalysis }) {
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
    const t = await requireCaptureToken(prisma, token);
    if (!t) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const slots = await prisma.slot.findMany({
      where: { caseId: t.caseId },
      orderBy: { orderIndex: 'asc' },
      include: { photo: true }
    });

    const next = pickNextSlot(slots);
    const progress = computeProgress(slots);

    return reply.send({
      ok: true,
      token: t.token,
      caseId: t.caseId,
      expiresAt: t.expiresAt,
      progress,
      slot: next
        ? {
            id: next.id,
            slotCode: next.slotCode,
            title: next.title,
            instructions: next.instructions,
            orderIndex: next.orderIndex,
            status: next.status,
            photoUrl: next.photo?.filePath ? storage.publicUrl(next.photo.filePath) : null
          }
        : null
    });
  });

  // Subir + validar captura (OK / REPEAT)
  app.post('/api/capture/:token/slots/:slotId/capture', async (req, reply) => {
    if (!prisma) {
      return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
    }

    const token = String(req.params.token || '');
    const slotId = String(req.params.slotId || '');

    const t = await requireCaptureToken(prisma, token);
    if (!t) return reply.code(401).send({ ok: false, error: 'INVALID_TOKEN' });

    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      select: { id: true, caseId: true, slotCode: true, title: true, instructions: true, orderIndex: true, status: true }
    });
    if (!slot || slot.caseId !== t.caseId) return reply.code(404).send({ ok: false, error: 'SLOT_NOT_FOUND' });

    const part = await req.file({ limits: { fileSize: 8 * 1024 * 1024 } });
    if (!part) return reply.code(400).send({ ok: false, error: 'NO_FILE' });
    if (part.fieldname && part.fieldname !== 'photo') {
      return reply.code(400).send({ ok: false, error: 'INVALID_FIELD', expected: 'photo', got: part.fieldname });
    }

    const mimeType = part.mimetype;
    const ext = safeExtFromMime(mimeType);
    if (!ext) return reply.code(400).send({ ok: false, error: 'UNSUPPORTED_TYPE', mimeType });

    const buffer = await part.toBuffer();

    // 1) Blur check (antes de todo)
    const blur = await laplacianVarianceFromBuffer(buffer);
    const blurThreshold = 60; // MVP: ajustar con data real
    let analysis;
    if (blur.variance < blurThreshold) {
      analysis = {
        meta: { width: null, height: null },
        problem: {
          code: 'PHOTO_TOO_BLURRY',
          severity: 'high',
          confidence: 0.85,
          message: 'La foto está borrosa. Acércate, enfoca y vuelve a capturar.',
          debug: {
            laplacianVariance: Number(blur.variance.toFixed(2)),
            threshold: blurThreshold,
            resized: { width: blur.width, height: blur.height }
          }
        }
      };
    } else {
      analysis = await analyzeImageBufferV1({
        buffer,
        filename: part.filename || 'capture.jpg',
        mimetype: mimeType,
        slotGroup: slotGroupFromSlotCode(slot.slotCode)
      });
      // incluir blur en debug para telemetría
      analysis.problem.debug = { ...(analysis.problem.debug || {}), blur: { laplacianVariance: Number(blur.variance.toFixed(2)) } };
    }

    const saved = await storage.saveImageBuffer({
      buffer,
      contentType: mimeType,
      ext,
      caseId: slot.caseId
    });

    // metadata
    let width = null;
    let height = null;
    try {
      const m = await sharp(buffer).metadata();
      width = m.width ?? null;
      height = m.height ?? null;
    } catch {
      // ignore
    }

    const originalFileName = part.filename || saved.storedFileName;
    const filePath = saved.filePath;

    const code = String(analysis.problem.code || '').toUpperCase();
    const passed = !REPEAT_CODES.has(code);
    const nextStatus = passed ? 'ANALYZED' : 'REJECTED';

    const result = await prisma.$transaction(async (tx) => {
      const photo = await tx.photo.create({
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

      const updatedSlot = await tx.slot.update({
        where: { id: slot.id },
        data: {
          status: nextStatus,
          photoId: photo.id,
          analysisCode: analysis.problem.code,
          analysisSeverity: analysis.problem.severity,
          analysisConfidence: analysis.problem.confidence ?? null,
          analysisMessage: analysis.problem.message,
          analysisDebug: analysis.problem.debug ?? null,
          analyzedAt: now()
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

    return reply.send({
      ok: true,
      passed,
      caseId: slot.caseId,
      slotId: result.slot.id,
      slotStatus: result.slot.status,
      problem: analysis.problem,
      photo: {
        id: result.photo.id,
        url: storage.publicUrl(filePath),
        mimeType,
        size: buffer.length,
        width,
        height
      },
      progress,
      nextSlotId: next?.id ?? null
    });
  });
}

