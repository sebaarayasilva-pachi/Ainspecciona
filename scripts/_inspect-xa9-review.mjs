import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shortId = process.argv[2] || 'XA9MDYIN';

const c = await prisma.case.findFirst({
  where: { shortId },
  select: { id: true, shortId: true, reviewStatus: true, reviewedAt: true, reviewerEmail: true }
});
if (!c) {
  console.log('CASE_NOT_FOUND');
  process.exit(1);
}
console.log('case', c);

const slot = await prisma.slot.findFirst({
  where: { caseId: c.id, slotCode: 'ELECTRICAL_PANEL' },
  select: {
    id: true,
    slotCode: true,
    analysisCode: true,
    analysisSeverity: true,
    analysisMessage: true,
    analysisDebug: true
  }
});
console.log('\nslot.analysis', {
  id: slot?.id,
  code: slot?.analysisCode,
  severity: slot?.analysisSeverity,
  message: String(slot?.analysisMessage || '').slice(0, 300)
});

const review = slot
  ? await prisma.slotReview.findUnique({ where: { slotId: slot.id } })
  : null;
console.log('\nslotReview', review
  ? {
      verdict: review.verdict,
      humanCode: review.humanCode,
      humanSeverity: review.humanSeverity,
      humanMessage: String(review.humanMessage || '').slice(0, 400),
      note: review.note,
      reviewerEmail: review.reviewerEmail,
      reviewedAt: review.reviewedAt
    }
  : null);

const allReviews = await prisma.slotReview.findMany({
  where: { caseId: c.id },
  select: { slotId: true, verdict: true, humanCode: true, humanSeverity: true, reviewedAt: true }
});
console.log('\nallReviews count', allReviews.length);
console.log(allReviews.filter((r) => r.verdict === 'corrected'));

await prisma.$disconnect();
