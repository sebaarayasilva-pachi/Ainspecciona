/**
 * Análisis diferencial IN vs OUT → IoDiffResult + IoReport.
 */
import { createStorage } from '../../storage/storage.js';
import { analyzeInOutPair } from '../analysis/analyzeInOutPair.js';
import { buildDiffSummary, saveDiffReport, DISCLAIMER } from './report.js';

let storage;
function getStorage() {
  if (!storage) storage = createStorage();
  return storage;
}

function bufferToDataUrl(buf, mime = 'image/jpeg') {
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
}

async function readPhotoBuffer(filePath) {
  return getStorage().readBuffer(filePath);
}

/**
 * Ejecuta el pipeline completo de comparación diferencial para un lease.
 * @returns {{ ok: true, summary, diffs, reportId, disclaimer } | { ok: false, error, message? }}
 */
export async function runDiffAnalysis(prisma, leaseId, { log, tenantId } = {}) {
  const where = { id: String(leaseId) };
  if (tenantId) where.tenantId = tenantId;

  const lease = await prisma.ioLease.findFirst({
    where,
    include: {
      property: true,
      visits: {
        where: { phase: { in: ['IN', 'OUT'] }, status: 'COMPLETED' },
        include: {
          slots: { include: { photos: { orderBy: { capturedAt: 'desc' }, take: 1 } } }
        }
      }
    }
  });
  if (!lease) return { ok: false, error: 'NOT_FOUND' };

  const inVisit = lease.visits.find((v) => v.phase === 'IN');
  const outVisit = lease.visits.find((v) => v.phase === 'OUT');
  if (!inVisit || !outVisit) {
    return { ok: false, error: 'VISITS_INCOMPLETE', message: 'Faltan visitas IN u OUT completadas.' };
  }

  await prisma.ioLease.update({
    where: { id: lease.id },
    data: { cycleStatus: 'analyzing' }
  });

  const inByCode = new Map(inVisit.slots.map((s) => [s.slotCode, s]));
  const results = [];

  for (const outSlot of outVisit.slots) {
    const inSlot = inByCode.get(outSlot.slotCode);
    const inPhoto = inSlot?.photos?.[0];
    const outPhoto = outSlot.photos?.[0];
    if (!inPhoto || !outPhoto) {
      const row = await prisma.ioDiffResult.upsert({
        where: { visitId_slotCode: { visitId: outVisit.id, slotCode: outSlot.slotCode } },
        create: {
          visitId: outVisit.id,
          outSlotId: outSlot.id,
          slotCode: outSlot.slotCode,
          classification: 'no_comparable',
          severity: 'none',
          confidence: 0,
          description: 'Falta fotografía IN u OUT para este elemento.',
          reviewStatus: 'pending'
        },
        update: {
          classification: 'no_comparable',
          description: 'Falta fotografía IN u OUT para este elemento.',
          reviewStatus: 'pending'
        }
      });
      results.push(row);
      continue;
    }

    let analysis;
    try {
      const inBuf = await readPhotoBuffer(inPhoto.filePath);
      const outBuf = await readPhotoBuffer(outPhoto.filePath);
      analysis = await analyzeInOutPair({
        inImageDataUrl: bufferToDataUrl(inBuf, inPhoto.mimeType || 'image/jpeg'),
        outImageDataUrl: bufferToDataUrl(outBuf, outPhoto.mimeType || 'image/jpeg'),
        slotTitle: outSlot.title,
        slotCode: outSlot.slotCode,
        log
      });
    } catch (err) {
      log?.warn?.({ err, slotCode: outSlot.slotCode }, 'inout diff slot');
      analysis = {
        classification: 'no_comparable',
        severity: 'none',
        confidence: 0,
        description: 'Error al analizar el par de fotografías.',
        raw: null
      };
    }

    const row = await prisma.ioDiffResult.upsert({
      where: { visitId_slotCode: { visitId: outVisit.id, slotCode: outSlot.slotCode } },
      create: {
        visitId: outVisit.id,
        outSlotId: outSlot.id,
        slotCode: outSlot.slotCode,
        classification: analysis.classification,
        severity: analysis.severity,
        confidence: analysis.confidence,
        description: analysis.description,
        reviewStatus: 'pending',
        rawJson: analysis.raw
      },
      update: {
        classification: analysis.classification,
        severity: analysis.severity,
        confidence: analysis.confidence,
        description: analysis.description,
        reviewStatus: 'pending',
        rawJson: analysis.raw
      }
    });
    results.push(row);
  }

  const report = await saveDiffReport(prisma, {
    leaseId: lease.id,
    diffs: results,
    leaseMeta: {
      address: lease.property.address,
      tenantName: lease.tenantName,
      ownerName: lease.ownerName
    }
  });

  await prisma.ioLease.update({
    where: { id: lease.id },
    data: { cycleStatus: 'under_review' }
  });

  return {
    ok: true,
    summary: buildDiffSummary(results),
    diffs: results,
    reportId: report.id,
    disclaimer: DISCLAIMER
  };
}

/**
 * Encola análisis sin bloquear la respuesta HTTP.
 * Si falla, deja el lease en out_completed para poder reintentar.
 */
export function queueDiffAnalysis(prisma, leaseId, { log } = {}) {
  setImmediate(() => {
    runDiffAnalysis(prisma, leaseId, { log })
      .then((result) => {
        if (!result.ok) {
          log?.warn?.({ leaseId, error: result.error }, 'inout auto diff analysis failed');
          return prisma.ioLease
            .update({
              where: { id: String(leaseId) },
              data: { cycleStatus: 'out_completed' }
            })
            .catch(() => {});
        }
        log?.info?.({ leaseId, reportId: result.reportId }, 'inout auto diff analysis done');
      })
      .catch((err) => {
        log?.error?.({ err, leaseId }, 'inout auto diff analysis crashed');
        return prisma.ioLease
          .update({
            where: { id: String(leaseId) },
            data: { cycleStatus: 'out_completed' }
          })
          .catch(() => {});
      });
  });
}
