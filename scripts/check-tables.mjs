import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const names = ['ReferralPartner', 'PartnerCommissionAccrual', 'Supplier', 'PresencialOrder'];
for (const t of names) {
  const rows = await p.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}'`
  );
  console.log(t, Number(rows[0]?.c) > 0 ? 'yes' : 'no');
}
await p.$disconnect();
