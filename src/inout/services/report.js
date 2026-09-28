/**
 * Resumen e informe diferencial In & Out.
 */

const DISCLAIMER =
  'El análisis se basa en evidencia visual. No reemplaza una inspección especializada, no constituye peritaje judicial y no determina responsabilidades legales. Las conclusiones dependen de la calidad y comparabilidad de las fotografías.';

export function buildDiffSummary(diffs = []) {
  const counts = {
    sin_cambio: 0,
    cambio_detectado: 0,
    posible_deterioro: 0,
    elemento_faltante: 0,
    no_comparable: 0,
    total: diffs.length
  };
  for (const d of diffs) {
    const c = d.classification;
    if (counts[c] !== undefined) counts[c] += 1;
  }
  const conclusion =
    `Se compararon ${counts.total} elementos de la propiedad. ` +
    `Se identificaron ${counts.sin_cambio} sin cambios relevantes, ` +
    `${counts.cambio_detectado} cambios detectados, ` +
    `${counts.posible_deterioro} posibles deterioros, ` +
    `${counts.elemento_faltante} elementos faltantes y ` +
    `${counts.no_comparable} registros no comparables que requieren revisión adicional.`;

  return { counts, conclusion, disclaimer: DISCLAIMER };
}

/**
 * Persiste snapshot de informe DIFF.
 */
export async function saveDiffReport(prisma, { leaseId, diffs, leaseMeta }) {
  const summary = buildDiffSummary(diffs);
  const prev = await prisma.ioReport.findFirst({
    where: { leaseId, kind: 'DIFF' },
    orderBy: { version: 'desc' }
  });
  const version = (prev?.version || 0) + 1;
  const report = await prisma.ioReport.create({
    data: {
      leaseId,
      kind: 'DIFF',
      version,
      summaryJson: {
        ...summary,
        lease: leaseMeta || null,
        generatedAt: new Date().toISOString(),
        items: diffs.map((d) => ({
          slotCode: d.slotCode,
          classification: d.classification,
          severity: d.severity,
          confidence: d.confidence,
          description: d.description,
          reviewStatus: d.reviewStatus
        }))
      }
    }
  });
  return report;
}

export function assembleLeaseReport(lease) {
  const inVisit = (lease.visits || []).find((v) => v.phase === 'IN');
  const outVisit = (lease.visits || []).find((v) => v.phase === 'OUT');
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
  return {
    lease: {
      id: lease.id,
      cycleStatus: lease.cycleStatus,
      tenantName: lease.tenantName,
      ownerName: lease.ownerName,
      tenantEmail: lease.tenantEmail,
      ownerEmail: lease.ownerEmail,
      property: lease.property
    },
    summary,
    items,
    report: (lease.reports && lease.reports[0]) || null,
    disclaimer: DISCLAIMER
  };
}

export { DISCLAIMER };
