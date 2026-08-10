/**
 * API Ainspecciona Scan — Fase C (mock processing + URL pública).
 */
import crypto from 'node:crypto';
import { hashPassword } from '../postventa/auth/portalAuth.js';
import { ensureScanSchema } from './ensureScanSchema.js';
import { runMockProcessing, shortPublicId } from './services/processScan.js';

const DEMO_ORG_SLUG = 'scan-demo';
const DEMO_EMAIL = 'corredor@scan.ainspecciona.com';
const DEMO_PASSWORD = 'ScanDemo2026!';

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
  return {
    id: scan.id,
    publicId: scan.publicId,
    status: scan.status,
    captureMode: scan.captureMode,
    processingProgress: scan.processingProgress,
    modelType: scan.modelType,
    modelUrl: scan.modelUrl,
    planUrl: scan.planUrl,
    planJson: scan.planJson,
    durationSeconds: scan.durationSeconds,
    acceptedFrames: scan.acceptedFrames,
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

export async function registerScanRoutes(app, { prisma }) {
  if (!prisma) {
    app.log.warn('Scan routes: prisma unavailable');
    return;
  }

  await ensureScanSchema(prisma).catch((err) => app.log.warn({ err }, 'ensureScanSchema'));
  await ensureDemoOrg(prisma).catch((err) => app.log.warn({ err }, 'ensureScanDemoOrg'));

  /** Health / info */
  app.get('/api/scan/health', async () => ({
    ok: true,
    product: 'ainspecciona-scan',
    phase: 'C-mock',
    demoEmail: DEMO_EMAIL
  }));

  /**
   * Publica un Scan mock READY y devuelve URL compartible.
   * Útil para demo web y para la app Android Fase A/C.
   */
  app.post('/api/scan/demo/publish', async (req, reply) => {
    const body = req.body || {};
    const { org } = await ensureDemoOrg(prisma);
    const name = String(body.name || body.propertyName || 'Propiedad demo').slice(0, 191);
    const address = body.address != null ? String(body.address).slice(0, 255) : null;
    const durationSeconds = Math.max(0, Number(body.durationSeconds) || 60);
    const acceptedFrames = Math.max(0, Number(body.acceptedFrames) || 120);
    const captureMode = ['MOCK', 'ARCORE_DEPTH', 'ARCORE_STANDARD'].includes(body.captureMode)
      ? body.captureMode
      : 'MOCK';

    const property = await prisma.scanProperty.create({
      data: {
        orgId: org.id,
        name,
        address,
        bedrooms: body.bedrooms != null ? Number(body.bedrooms) : null,
        bathrooms: body.bathrooms != null ? Number(body.bathrooms) : null,
        areaM2: body.areaM2 != null ? Number(body.areaM2) : null
      }
    });

    let publicId = shortPublicId();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.scanJob.findUnique({ where: { publicId } });
      if (!exists) break;
      publicId = shortPublicId();
    }

    const scan = await prisma.scanJob.create({
      data: {
        orgId: org.id,
        propertyId: property.id,
        publicId,
        status: 'UPLOADED',
        captureMode,
        durationSeconds,
        acceptedFrames,
        packagePath: body.packagePath ? String(body.packagePath).slice(0, 1024) : null
      }
    });

    const result = await runMockProcessing(prisma, scan.id);
    if (!result.ok) return reply.code(500).send(result);

    return reply.send({
      ok: true,
      scan: serializeScan(result.scan, req),
      message: 'Tour mock + planimetría listos. Motor real llega en Fase D.'
    });
  });

  /** Payload público del viewer */
  app.get('/api/scan/public/:publicId', async (req, reply) => {
    const publicId = String(req.params.publicId || '').trim();
    if (!publicId) return reply.code(400).send({ ok: false, error: 'PUBLIC_ID_REQUIRED' });
    const scan = await prisma.scanJob.findUnique({
      where: { publicId },
      include: { property: true }
    });
    if (!scan) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
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

  /** Crear propiedad + scan DRAFT (app) */
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

    let publicId = shortPublicId();
    const scan = await prisma.scanJob.create({
      data: {
        orgId: org.id,
        propertyId: property.id,
        publicId,
        status: 'DRAFT',
        captureMode: 'MOCK'
      },
      include: { property: true }
    });
    return reply.send({ ok: true, scan: serializeScan(scan, req) });
  });

  /**
   * Marca upload completo y dispara procesamiento mock.
   * (Signed GCS upload real: siguiente iteración.)
   */
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
        captureMode: ['MOCK', 'ARCORE_DEPTH', 'ARCORE_STANDARD'].includes(req.body?.captureMode)
          ? req.body.captureMode
          : scan.captureMode
      }
    });

    // Async-ish: procesar y responder (mock es rápido)
    const result = await runMockProcessing(prisma, id);
    if (!result.ok) return reply.code(500).send(result);
    return reply.send({ ok: true, scan: serializeScan(result.scan, req) });
  });

  app.get('/api/scan/scans/:id', async (req, reply) => {
    const scan = await prisma.scanJob.findUnique({
      where: { id: String(req.params.id) },
      include: { property: true }
    });
    if (!scan) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    return reply.send({ ok: true, scan: serializeScan(scan, req) });
  });
}

export { ensureDemoOrg, DEMO_EMAIL, DEMO_PASSWORD };
