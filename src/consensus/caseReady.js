import { FINAL_STATUS } from './schema.js';
import { isShadowEnabled } from './config.js';

export function consensusRequired(scoreConfig) {
  return isShadowEnabled(scoreConfig);
}

export async function caseConsensusStats(prisma, caseId) {
  if (!prisma || !caseId) return { photoSlots: 0, shadows: 0, unresolved: 0, complete: false };
  const [photoSlots, shadows, unresolved] = await Promise.all([
    prisma.slot.count({ where: { caseId, photoId: { not: null } } }),
    prisma.photoAnalysisShadow.count({ where: { caseId } }),
    prisma.photoAnalysisShadow.count({ where: { caseId, finalStatus: FINAL_STATUS.UNRESOLVED } })
  ]);
  return {
    photoSlots,
    shadows,
    unresolved,
    complete: photoSlots > 0 && shadows >= photoSlots
  };
}

export async function isCaseConsensusComplete(prisma, caseId) {
  const s = await caseConsensusStats(prisma, caseId);
  return s.complete;
}
