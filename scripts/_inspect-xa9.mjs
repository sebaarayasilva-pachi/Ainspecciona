import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shortId = process.argv[2] || 'XA9MDYIN';

const c = await prisma.case.findFirst({
  where: { shortId },
  select: {
    id: true,
    shortId: true,
    status: true,
    reviewStatus: true,
    slots: {
      where: { slotCode: { contains: 'ELECTRICAL' } },
      select: {
        id: true,
        slotCode: true,
        status: true,
        analysisCode: true,
        analysisSeverity: true,
        analysisMessage: true,
        analysisDebug: true,
        photoId: true
      }
    }
  }
});

if (!c) {
  console.log('NOT_FOUND', shortId);
  process.exit(1);
}

console.log('case', c.id, c.shortId, c.status, c.reviewStatus);
for (const s of c.slots || []) {
  console.log('\n===', s.slotCode, s.status, s.id);
  console.log('analysisCode', s.analysisCode, 'severity', s.analysisSeverity);
  console.log('message', String(s.analysisMessage || '').slice(0, 600));
  const dbg = s.analysisDebug;
  if (dbg && typeof dbg === 'object') {
    console.log('debug.keys', Object.keys(dbg));
    console.log('debug.snippet', JSON.stringify(dbg).slice(0, 2500));
  }
}

await prisma.$disconnect();
