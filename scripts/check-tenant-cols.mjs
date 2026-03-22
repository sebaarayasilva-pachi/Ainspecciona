import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const rows = await p.$queryRaw`
  SELECT COLUMN_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tenant'
  AND COLUMN_NAME IN ('referralPartnerId','referralCodeSnapshot','trialPartnerBenefitsAt')`;
console.log(JSON.stringify(rows, null, 2));
await p.$disconnect();
