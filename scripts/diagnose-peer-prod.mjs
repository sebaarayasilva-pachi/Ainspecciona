/**
 * Uso (con proxy en 3307 y DATABASE_URL apuntando a 127.0.0.1:3307):
 *   npx dotenv -e .env -- node scripts/diagnose-peer-prod.mjs
 * O: $env:DATABASE_URL='mysql://...'; node scripts/diagnose-peer-prod.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const col = await prisma.$queryRaw`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tenant' AND COLUMN_NAME = 'peerReferralCode'`;
  const tbl = await prisma.$queryRaw`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PeerReferralAttribution'`;
  console.log('Tenant.peerReferralCode:', col?.length ? 'exists' : 'missing');
  console.log('PeerReferralAttribution table:', tbl?.length ? 'exists' : 'missing');
} finally {
  await prisma.$disconnect();
}
