import { shortPublicId } from './services/processScan.js';

const CAPTURE_MODES = new Set(['MOCK', 'ARCORE_DEPTH', 'ARCORE_STANDARD']);

export function normalizeCaptureMode(value, fallback = 'MOCK') {
  const m = String(value || '').toUpperCase();
  return CAPTURE_MODES.has(m) ? m : fallback;
}

export function packageObjectKey(orgId, scanId) {
  const org = String(orgId || 'demo').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'demo';
  const id = String(scanId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'scan';
  return `scans/${org}/${id}/package.zip`;
}

export async function allocatePublicId(prisma) {
  let publicId = shortPublicId();
  for (let i = 0; i < 6; i++) {
    const exists = await prisma.scanJob.findUnique({ where: { publicId } });
    if (!exists) return publicId;
    publicId = shortPublicId();
  }
  return publicId;
}

export async function createPropertyAndJob(prisma, org, body = {}) {
  const name = String(body.name || body.propertyName || 'Propiedad').trim().slice(0, 191) || 'Propiedad';
  const address = body.address != null ? String(body.address).slice(0, 255) : null;
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
  const publicId = await allocatePublicId(prisma);
  const scan = await prisma.scanJob.create({
    data: {
      orgId: org.id,
      propertyId: property.id,
      publicId,
      status: 'DRAFT',
      captureMode: normalizeCaptureMode(body.captureMode),
      durationSeconds: Math.max(0, Number(body.durationSeconds) || 0),
      acceptedFrames: Math.max(0, Number(body.acceptedFrames) || 0)
    },
    include: { property: true }
  });
  return scan;
}

export async function createJobForProperty(prisma, org, property, body = {}) {
  const publicId = await allocatePublicId(prisma);
  return prisma.scanJob.create({
    data: {
      orgId: org.id,
      propertyId: property.id,
      publicId,
      status: 'DRAFT',
      captureMode: normalizeCaptureMode(body.captureMode),
      durationSeconds: Math.max(0, Number(body.durationSeconds) || 0),
      acceptedFrames: Math.max(0, Number(body.acceptedFrames) || 0)
    },
    include: { property: true }
  });
}
