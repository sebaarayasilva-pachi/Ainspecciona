import { getReconstructionProvider } from '../reconstruction/provider.js';

function shortPublicId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export { shortPublicId };

/**
 * Pipeline mock: QUEUED → PROCESSING → READY con tour + plan.
 */
export async function runMockProcessing(prisma, scanId) {
  const scan = await prisma.scanJob.findUnique({
    where: { id: scanId },
    include: { property: true }
  });
  if (!scan) return { ok: false, error: 'NOT_FOUND' };

  await prisma.scanJob.update({
    where: { id: scanId },
    data: { status: 'QUEUED', processingProgress: 5 }
  });

  await prisma.scanJob.update({
    where: { id: scanId },
    data: { status: 'PROCESSING', processingProgress: 35 }
  });

  const provider = getReconstructionProvider();
  const jobId = await provider.submit(scanId);
  const result = await provider.getResult(jobId, { property: scan.property });

  const updated = await prisma.scanJob.update({
    where: { id: scanId },
    data: {
      status: 'READY',
      processingProgress: 100,
      modelType: result.modelType || 'MOCK_SCENE',
      modelUrl: result.modelUrl,
      planUrl: result.planUrl,
      planJson: {
        ...(result.planJson || {}),
        scene: result.scene || null,
        alignment: result.alignment || null
      },
      readyAt: new Date()
    },
    include: { property: true }
  });

  return { ok: true, scan: updated };
}
