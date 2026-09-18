/**
 * API Ainspecciona Scan — Android: crear job, subir zip, completar.
 */
import { hashPassword } from '../postventa/auth/portalAuth.js';
import { ensureScanSchema } from './ensureScanSchema.js';
import { runMockProcessing, maybeFinalizeScan } from './services/processScan.js';
import { ColmapReconstructionProvider } from './reconstruction/colmapProvider.js';
import { ModalReconstructionProvider } from './reconstruction/modalProvider.js';
import { setReconstructionProvider } from './reconstruction/provider.js';
import { createJobForProperty, createPropertyAndJob, normalizeCaptureMode, packageObjectKey } from './scanJob.js';

const DEMO_ORG_SLUG = 'scan-demo';
const DEMO_EMAIL = 'corredor@scan.ainspecciona.com';
const DEMO_PASSWORD = 'ScanDemo2026!';
const PACKAGE_BODY_LIMIT = 80 * 1024 * 1024;

async function ensureDemoOrg(prisma) {
  let org = await prisma.scanOrg.findUnique({ where: { slug: DEMO_ORG_SLUG } });
  if (!org) {
    org = await prisma.scanOrg.create({
      data: { slug: DEMO_ORG_SLUG, name: 'Scan Demo Corredores', status: 'ACTIVE' }
    });
  }
  let user = await prisma.scanUser.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.scanUser.create({
      data: {
        orgId: org.id,
        email: DEMO_EMAIL,
        fullName: 'Corredor Scan Demo',
        status: 'ACTIVE',
        passwordHash: hashPassword(DEMO_PASSWORD)
      }
    });
  }
  return { org, user };
}

function publicScanUrl(req, publicId) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'ainspecciona.com')
    .split(',')[0]
    .trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${host}/scan/s/${publicId}`;
}

function serializeScan(scan, req) {
  const planJson = scan.planJson || null;
  const tour = planJson?.tour;
  const frames = Array.isArray(tour?.frames) ? tour.frames : [];
  return {
    id: scan.id,
    publicId: scan.publicId,
    status: scan.status,
    captureMode: scan.captureMode,
    processingProgress: scan.processingProgress,
    modelType: scan.modelType,
    // Para Gaussian Splatting, enviamos la URL real de GCS para evitar problemas de CORS/Redirecciones en el visor
    modelUrl: scan.modelUrl && scan.modelType === 'GLB'
      ? `/api/scan/public/${scan.publicId}/model`
      : scan.modelUrl,
    planUrl: scan.planUrl,
    planJson,
    tour: tour
      ? {
          kind: tour.kind,
          captureMode: tour.captureMode || scan.captureMode,
          weldUrl: tour.weldKey ? `/api/scan/public/${scan.publicId}/weld` : null,
          weldStats: tour.weldStats || null,
          diagnostic: tour.diagnostic || null,
          frames: frames.map((f) => ({
            index: f.index,
            pose: f.pose,
            upright: Boolean(f.upright),
            registered: Boolean(f.registered),
            imageUrl: `/api/scan/public/${scan.publicId}/frame/${f.index}`
          }))
        }
      : null,
    durationSeconds: scan.durationSeconds,
    acceptedFrames: scan.acceptedFrames,
    packagePath: scan.packagePath || null,
    publicUrl: publicScanUrl(req, scan.publicId),
    property: scan.property
      ? {
          id: scan.property.id,
          name: scan.property.name,
          address: scan.property.address,
          bedrooms: scan.property.bedrooms,
          bathrooms: scan.property.bathrooms,
          areaM2: scan.property.areaM2
        }
      : null,
    readyAt: scan.readyAt,
    createdAt: scan.createdAt
  };
}

async function readRawBody(req, limit = PACKAGE_BODY_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.raw) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error('PACKAGE_TOO_LARGE');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function registerScanRoutes(app, { prisma, storage = null } = {}) {
  if (!prisma) {
    app.log.warn('Scan routes: prisma unavailable');
    return;
  }

  await ensureScanSchema(prisma).catch((err) => app.log.warn({ err }, 'ensureScanSchema'));
  await ensureDemoOrg(prisma).catch((err) => app.log.warn({ err }, 'ensureScanDemoOrg'));
  
  // Configurar proveedor de reconstrucción (Modal)
  const modalProvider = new ModalReconstructionProvider({
    webhookUrl: 'https://seba-araya-silva--ainspecta-recon-splat-webhook.modal.run',
    storage,
    log: app.log
  });
  setReconstructionProvider(modalProvider);

  // Configurar proveedor de reconstrucción (COLMAP) - Desactivado por ahora
  // setReconstructionProvider(new ColmapReconstructionProvider({ storage, log: app.log }));

  try {
    app.addContentTypeParser('application/zip', { parseAs: 'buffer', bodyLimit: PACKAGE_BODY_LIMIT }, (_req, body, done) => {
      done(null, body);
    });
  } catch (_) {
    /* parser ya registrado */
  }

  app.get('/api/scan/health', async () => ({
    ok: true,
    product: 'ainspecciona-scan',
    phase: 'D-colmap',
    upload: storage?.driver === 'gcs' ? 'gcs-signed' : 'local-put',
    demoEmail: DEMO_EMAIL
  }));

  app.post('/api/scan/demo/publish', async (req, reply) => {
    const body = req.body || {};
    const { org } = await ensureDemoOrg(prisma);
    const scan = await createPropertyAndJob(prisma, org, body);
    await prisma.scanJob.update({
      where: { id: scan.id },
      data: {
        status: 'UPLOADED',
        packagePath: body.packagePath ? String(body.packagePath).slice(0, 1024) : scan.packagePath
      }
    });
    const result = await runMockProcessing(prisma, scan.id, { storage });
    if (!result.ok) return reply.code(500).send(result);
    return reply.send({
      ok: true,
      scan: serializeScan(result.scan, req),
      message: 'Tour mock + planimetría listos. El zip de Android queda para el motor.'
    });
  });

  /** App Android: crea propiedad + job DRAFT. */
  app.post('/api/scan/jobs', async (req, reply) => {
    const { org } = await ensureDemoOrg(prisma);
    const scan = await createPropertyAndJob(prisma, org, req.body || {});
    return reply.send({ ok: true, scan: serializeScan(scan, req) });
  });

  app.get('/api/scan/public/:publicId', async (req, reply) => {
    const publicId = String(req.params.publicId || '').trim();
    if (!publicId) return reply.code(400).send({ ok: false, error: 'PUBLIC_ID_REQUIRED' });
    let scan = await prisma.scanJob.findUnique({
      where: { publicId },
      include: { property: true }
    });
    if (!scan) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    
    const forceSync = req.query.forceSync === 'true';
    scan = await maybeFinalizeScan(prisma, scan, { storage }, forceSync);
    
    if (scan.status === 'FAILED') {
      return reply.code(500).send({
        ok: false,
        error: 'FAILED',
        message: scan.errorMessage || 'La reconstrucción falló.'
      });
    }
    if (scan.status !== 'READY') {
      return reply.send({
        ok: true,
        ready: false,
        status: scan.status,
        processingProgress: scan.processingProgress,
        scan: serializeScan(scan, req)
      });
    }
    return reply.send({
      ok: true,
      ready: true,
      scan: serializeScan(scan, req)
    });
  });

  app.get('/api/scan/public/:publicId/weld', async (req, reply) => {
    const publicId = String(req.params.publicId || '').trim();
    const scan = await prisma.scanJob.findUnique({ where: { publicId } });
    if (!scan || scan.status !== 'READY') {
      return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    }
    const key = scan.planJson?.tour?.weldKey;
    if (!key || !storage?.readBuffer) {
      return reply.code(404).send({ ok: false, error: 'WELD_NOT_FOUND' });
    }
    try {
      const buf = await storage.readBuffer(key);
      return reply
        .header('Cache-Control', 'no-store, no-cache, must-revalidate')
        .type('application/json')
        .send(buf);
    } catch {
      return reply.code(404).send({ ok: false, error: 'WELD_NOT_FOUND' });
    }
  });

  app.get('/api/debug/env', async (req, reply) => {
    return reply.send({
      STORAGE_DRIVER: process.env.STORAGE_DRIVER,
      GCS_BUCKET: process.env.GCS_BUCKET,
      driverType: storage.driver,
      testPublicUrl: storage.publicUrl('scans/test/model.ply')
    });
  });

  app.get('/api/scan/public/:publicId/model', async (req, reply) => {
    const publicId = String(req.params.publicId || '').trim();
    const scan = await prisma.scanJob.findUnique({ where: { publicId } });
    if (!scan || scan.status !== 'READY' || !scan.modelUrl || !storage?.readBuffer) {
      return reply.code(404).send({ ok: false, error: 'MODEL_NOT_FOUND' });
    }
    try {
      const isGlb = String(scan.modelUrl).toLowerCase().endsWith('.glb') || scan.modelType === 'GLB';
      const isPly = String(scan.modelUrl).toLowerCase().endsWith('.ply') || scan.modelType === 'GAUSSIAN_SPLAT';
      
      // Para modelos grandes como Gaussian Splatting, redirigir directamente a GCS
      if (isPly && typeof storage.publicUrl === 'function') {
        const publicUrl = storage.publicUrl(scan.modelUrl);
        if (publicUrl) {
          return reply.redirect(302, publicUrl);
        }
      }

      const buf = await storage.readBuffer(scan.modelUrl);
      
      let contentType = 'application/octet-stream';
      if (isGlb) contentType = 'model/gltf-binary';
      else if (isPly) contentType = 'text/plain'; // O application/octet-stream, pero PLY a veces es texto
      
      return reply
        .header('Cache-Control', 'no-store, no-cache, must-revalidate')
        .type(contentType)
        .send(buf);
    } catch {
      return reply.code(404).send({ ok: false, error: 'MODEL_NOT_FOUND' });
    }
  });

  app.get('/api/scan/public/:publicId/frame/:index', async (req, reply) => {
    const publicId = String(req.params.publicId || '').trim();
    const index = Number(req.params.index);
    const scan = await prisma.scanJob.findUnique({ where: { publicId } });
    if (!scan || scan.status !== 'READY') {
      return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    }
    const frames = scan.planJson?.tour?.frames || [];
    const frame = frames.find((f) => Number(f.index) === index);
    if (!frame?.storageKey || !storage?.readBuffer) {
      return reply.code(404).send({ ok: false, error: 'FRAME_NOT_FOUND' });
    }
    try {
      const buf = await storage.readBuffer(frame.storageKey);
      return reply
        .header('Cache-Control', 'public, max-age=86400')
        .type('image/jpeg')
        .send(buf);
    } catch {
      return reply.code(404).send({ ok: false, error: 'FRAME_NOT_FOUND' });
    }
  });

  app.post('/api/scan/properties', async (req, reply) => {
    const { org } = await ensureDemoOrg(prisma);
    const name = String(req.body?.name || '').trim();
    if (!name) return reply.code(400).send({ ok: false, error: 'NAME_REQUIRED' });
    const property = await prisma.scanProperty.create({
      data: {
        orgId: org.id,
        name: name.slice(0, 191),
        address: req.body?.address ? String(req.body.address).slice(0, 255) : null
      }
    });
    return reply.send({ ok: true, property });
  });

  app.post('/api/scan/scans', async (req, reply) => {
    const { org } = await ensureDemoOrg(prisma);
    const propertyId = String(req.body?.propertyId || '');
    const property = await prisma.scanProperty.findFirst({ where: { id: propertyId, orgId: org.id } });
    if (!property) return reply.code(404).send({ ok: false, error: 'PROPERTY_NOT_FOUND' });
    const scan = await createJobForProperty(prisma, org, property, req.body || {});
    return reply.send({ ok: true, scan: serializeScan(scan, req) });
  });

  app.post('/api/scan/scans/:id/upload-url', async (req, reply) => {
    const id = String(req.params.id);
    const scan = await prisma.scanJob.findUnique({ where: { id } });
    if (!scan) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    const objectPath = packageObjectKey(scan.orgId, scan.id);
    await prisma.scanJob.update({
      where: { id },
      data: { status: 'UPLOADING', packagePath: objectPath }
    });

    if (!storage?.createSignedUploadUrl) {
      return reply.send({
        ok: true,
        uploadUrl: `/api/scan/scans/${id}/package`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/zip' },
        objectPath,
        localFallback: true
      });
    }

    try {
      const signed = await storage.createSignedUploadUrl({
        object: objectPath,
        contentType: 'application/zip'
      });
      if (signed.localFallback || !signed.uploadUrl) {
        return reply.send({
          ok: true,
          uploadUrl: `/api/scan/scans/${id}/package`,
          method: 'PUT',
          headers: { 'Content-Type': 'application/zip' },
          objectPath,
          localFallback: true
        });
      }
      return reply.send({
        ok: true,
        uploadUrl: signed.uploadUrl,
        method: signed.method || 'PUT',
        headers: signed.headers || { 'Content-Type': 'application/zip' },
        objectPath,
        localFallback: false
      });
    } catch (err) {
      app.log.warn({ err: err?.message, id }, 'scan-signed-url-fallback');
      return reply.send({
        ok: true,
        uploadUrl: `/api/scan/scans/${id}/package`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/zip' },
        objectPath,
        localFallback: true
      });
    }
  });

  app.put('/api/scan/scans/:id/package', {
    config: { rawBody: true },
    bodyLimit: PACKAGE_BODY_LIMIT
  }, async (req, reply) => {
    const id = String(req.params.id);
    const scan = await prisma.scanJob.findUnique({ where: { id } });
    if (!scan) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    const objectPath = scan.packagePath || packageObjectKey(scan.orgId, scan.id);
    const buf = Buffer.isBuffer(req.body) ? req.body : await readRawBody(req);
    if (!buf?.length) return reply.code(400).send({ ok: false, error: 'EMPTY_PACKAGE' });
    if (!storage?.saveBuffer) {
      return reply.code(503).send({ ok: false, error: 'STORAGE_UNAVAILABLE' });
    }
    const saved = await storage.saveBuffer({
      buffer: buf,
      contentType: 'application/zip',
      storageKey: objectPath
    });
    await prisma.scanJob.update({
      where: { id },
      data: { status: 'UPLOADED', packagePath: saved.filePath || objectPath }
    });
    return reply.send({ ok: true, packagePath: saved.filePath || objectPath });
  });

  app.post('/api/scan/scans/:id/complete-upload', async (req, reply) => {
    const id = String(req.params.id);
    const scan = await prisma.scanJob.findUnique({ where: { id } });
    if (!scan) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

    await prisma.scanJob.update({
      where: { id },
      data: {
        status: 'UPLOADED',
        durationSeconds: Math.max(0, Number(req.body?.durationSeconds) || scan.durationSeconds),
        acceptedFrames: Math.max(0, Number(req.body?.acceptedFrames) || scan.acceptedFrames),
        captureMode: normalizeCaptureMode(req.body?.captureMode, scan.captureMode),
        packagePath: req.body?.packagePath
          ? String(req.body.packagePath).slice(0, 1024)
          : scan.packagePath
      }
    });

    const result = await runMockProcessing(prisma, id, { storage });
    if (!result.ok) return reply.code(500).send(result);
    return reply.send({ ok: true, scan: serializeScan(result.scan, req) });
  });

  app.get('/api/scan/scans/:id', async (req, reply) => {
    let scan = await prisma.scanJob.findUnique({
      where: { id: String(req.params.id) },
      include: { property: true }
    });
    if (!scan) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    scan = await maybeFinalizeScan(prisma, scan, { storage });
    return reply.send({ ok: true, scan: serializeScan(scan, req) });
  });
}

export { ensureDemoOrg, DEMO_EMAIL, DEMO_PASSWORD };
