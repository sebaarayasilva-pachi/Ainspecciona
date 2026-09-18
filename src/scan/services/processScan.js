import { getReconstructionProvider } from '../reconstruction/provider.js';
import { buildTourFromPackage, planFromTour } from '../reconstruction/fromPackage.js';

function shortPublicId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export { shortPublicId };

function tourFromResult(result, fallbackTour) {
  const frames = Array.isArray(result?.frames) && result.frames.length
    ? result.frames
    : (fallbackTour?.frames || []);
  return {
    kind: result?.kind || (frames.length ? 'photo_path' : (fallbackTour?.kind || 'mock')),
    frames,
    captureMode: fallbackTour?.captureMode,
    pointCount: result?.pointCount || 0,
    modelKey: result?.modelKey || null
  };
}

async function markReady(prisma, scanId, data, forceSync = false) {
  const allowedStatuses = forceSync 
    ? ['QUEUED', 'PROCESSING', 'UPLOADED', 'READY', 'FAILED'] 
    : ['QUEUED', 'PROCESSING', 'UPLOADED'];
    
  await prisma.scanJob.updateMany({
    where: { id: scanId, status: { in: allowedStatuses } },
    data
  });
  return prisma.scanJob.findUnique({ where: { id: scanId }, include: { property: true } });
}

/**
 * Encola COLMAP (Cloud Run Job) o, si no hay worker, deja fotos / mock.
 */
export async function runScanProcessing(prisma, scanId, { storage = null } = {}) {
  const scan = await prisma.scanJob.findUnique({
    where: { id: scanId },
    include: { property: true }
  });
  if (!scan) return { ok: false, error: 'NOT_FOUND' };

  await prisma.scanJob.update({
    where: { id: scanId },
    data: { status: 'QUEUED', processingProgress: 5, errorMessage: null }
  });

  const name = scan.property?.name || 'Propiedad';
  const provider = getReconstructionProvider();

  let submitted = null;
  if (typeof provider.submit === 'function' && scan.packagePath) {
    try {
      submitted = await provider.submit(scan);
    } catch (err) {
      console.error('Error submitting to provider:', err);
      submitted = null;
    }
  }

  if (submitted) {
    const updated = await prisma.scanJob.update({
      where: { id: scanId },
      data: {
        status: 'PROCESSING',
        processingProgress: 15,
        planJson: {
          version: 1,
          kind: 'path_floorplan',
          title: name,
          units: 'meters',
          path: [],
          rooms: [],
          tour: { kind: 'colmap_pending', frames: [] },
          note: 'Reconstrucción COLMAP en curso.'
        }
      },
      include: { property: true }
    });
    return { ok: true, pending: true, scan: updated };
  }

  const tour = scan.packagePath
    ? await buildTourFromPackage(storage, scan, { includeWeld: false }).catch(() => null)
    : null;

  if (tour) {
    const planJson = {
      ...planFromTour(tour, name),
      tour,
      alignment: { up: { x: 0, y: 1, z: 0 } }
    };
    const updated = await prisma.scanJob.update({
      where: { id: scanId },
      data: {
        status: 'READY',
        processingProgress: 100,
        modelType: 'MOCK_SCENE',
        modelUrl: null,
        planJson,
        readyAt: new Date()
      },
      include: { property: true }
    });
    return { ok: true, scan: updated };
  }

  const mock = await (provider.getResult
    ? provider.getResult(scanId, { property: scan.property })
    : { modelType: 'MOCK_SCENE', planJson: { title: name } });
  const updated = await prisma.scanJob.update({
    where: { id: scanId },
    data: {
      status: 'READY',
      processingProgress: 100,
      modelType: mock.modelType || 'MOCK_SCENE',
      modelUrl: mock.modelUrl,
      planUrl: mock.planUrl,
      planJson: {
        ...(mock.planJson || {}),
        scene: mock.scene || null,
        alignment: mock.alignment || null
      },
      readyAt: new Date()
    },
    include: { property: true }
  });
  return { ok: true, scan: updated };
}

/** Compat: mismas rutas que antes. */
export const runMockProcessing = runScanProcessing;

/**
 * Si el Job ya escribió result.json, pasa el scan a READY.
 */
export async function maybeFinalizeScan(prisma, scan, { storage = null } = {}, forceSync = false) {
  if (!scan || (!forceSync && !['QUEUED', 'PROCESSING'].includes(scan.status))) return scan;
  const provider = getReconstructionProvider();
  if (typeof provider.getStatus !== 'function') return scan;

  let st;
  try {
    st = await provider.getStatus(scan);
    console.log('maybeFinalizeScan: getStatus returned', st);
  } catch (err) {
    console.error('maybeFinalizeScan: getStatus error', err);
    return scan;
  }
  const status = String(st?.status || '').toUpperCase();
  const progress = Math.max(0, Math.min(100, Number(st?.progress) || scan.processingProgress || 0));
  console.log('maybeFinalizeScan: computed status', status, 'progress', progress);

  if (status === 'PROCESSING' || status === 'QUEUED') {
    if (progress !== scan.processingProgress) {
      return prisma.scanJob.update({
        where: { id: scan.id },
        data: { processingProgress: progress },
        include: { property: true }
      });
    }
    return scan;
  }

  const result = typeof provider.getResult === 'function'
    ? await provider.getResult(scan).catch(() => st)
    : st;
  const name = scan.property?.name || scan.planJson?.title || 'Propiedad';
  const prevTour = scan.planJson?.tour || null;
  const tour = tourFromResult(result, prevTour);
  if (result?.diagnostic) {
    tour.diagnostic = result.diagnostic;
  }
  let noteText = 'Sin malla COLMAP; se muestran las fotos.';
  if (status === 'READY') {
    if (result?.modelType === 'SPLAT_PLY' || result?.modelType === 'SPLAT' || result?.modelType === 'GAUSSIAN_SPLAT') {
      noteText = 'Modelo 3D fotorealista (Gaussian Splatting).';
    } else {
      noteText = 'Reconstrucción por correspondencia (COLMAP). Marketing, no es un scan certificado.';
    }
  } else if (result?.error) {
    noteText = `Reconstrucción fallida: ${result.error}`;
  }

  const planJson = {
    ...planFromTour(tour, name),
    tour,
    alignment: result?.alignment || { up: { x: 0, y: 1, z: 0 } },
    note: noteText
  };

  if (status === 'READY' && result?.modelKey) {
    console.log('maybeFinalizeScan: marking READY with modelKey', result.modelKey);
    // Detectar si el resultado indica que es SPLAT_PLY en base al result.json
    // Mapeamos a los enums válidos de Prisma: GLB, GAUSSIAN_SPLAT, MOCK_SCENE, PHOTO_MESH
    let modelType = 'GLB';
    if (result.modelType === 'SPLAT_PLY' || result.modelType === 'SPLAT' || result.modelType === 'GAUSSIAN_SPLAT') {
      modelType = 'GAUSSIAN_SPLAT';
    }
    
    return markReady(prisma, scan.id, {
      status: 'READY',
      processingProgress: 100,
      modelType: modelType,
      modelUrl: result.modelKey,
      planJson,
      errorMessage: null,
      readyAt: new Date()
    }, forceSync);
  }

  // Job falló o no hay malla: tour de fotos si existen.
  if (tour.frames?.length) {
    return markReady(prisma, scan.id, {
      status: 'READY',
      processingProgress: 100,
      modelType: 'MOCK_SCENE',
      modelUrl: null,
      planJson,
      errorMessage: result?.error ? String(result.error).slice(0, 512) : null,
      readyAt: new Date()
    }, forceSync);
  }

  await prisma.scanJob.update({
    where: { id: scan.id },
    data: {
      status: 'FAILED',
      processingProgress: progress,
      errorMessage: String(result?.error || 'RECON_FAILED').slice(0, 512)
    }
  });
  return prisma.scanJob.findUnique({ where: { id: scan.id }, include: { property: true } });
}
