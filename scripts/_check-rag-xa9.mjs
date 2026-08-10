import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const caseId = 'c1697f74-be2f-44c2-bfdb-097ef3207064';
const slotId = '808f3540-395e-4300-bc5c-02a746d54345';

const byRef = await prisma.knowledgeEntry.findMany({
  where: {
    OR: [
      { sourceRef: { contains: `case:${caseId}` } },
      { sourceRef: { contains: `slot:${slotId}` } },
      { text: { contains: 'diferencial' } }
    ]
  },
  orderBy: { createdAt: 'desc' },
  take: 15,
  select: {
    id: true,
    source: true,
    entryType: true,
    status: true,
    kpiKey: true,
    severity: true,
    sourceRef: true,
    createdAt: true,
    createdBy: true,
    text: true,
    embeddingModel: true
  }
});

console.log('entries', byRef.length);
for (const e of byRef) {
  console.log({
    id: e.id,
    type: e.entryType,
    status: e.status,
    kpi: e.kpiKey,
    sev: e.severity,
    sourceRef: e.sourceRef,
    by: e.createdBy,
    at: e.createdAt,
    hasEmbedding: !!e.embeddingModel,
    text: String(e.text || '').slice(0, 220)
  });
}

const recent = await prisma.knowledgeEntry.findMany({
  where: { source: 'AINSPECTA', createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
  orderBy: { createdAt: 'desc' },
  take: 10,
  select: { id: true, entryType: true, status: true, kpiKey: true, sourceRef: true, createdAt: true, embeddingModel: true }
});
console.log('\nlast7d AINSPECTA', recent.length);
for (const e of recent) {
  console.log({
    type: e.entryType,
    status: e.status,
    kpi: e.kpiKey,
    emb: e.embeddingModel || null,
    ref: e.sourceRef,
    at: e.createdAt
  });
}

await prisma.$disconnect();
