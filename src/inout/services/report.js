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

export { DISCLAIMER };
