/**
 * Añade columnas faltantes a Case en producción.
 * Uso: DATABASE_URL=... node prisma/fix-case-columns.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const alters = [
  'ALTER TABLE `Case` ADD COLUMN `contactEmail` VARCHAR(255) NULL',
  'ALTER TABLE `Case` ADD COLUMN `contactName` VARCHAR(255) NULL',
  'ALTER TABLE `Case` ADD COLUMN `mercadopagoPaymentId` VARCHAR(64) NULL',
  'ALTER TABLE `Case` ADD COLUMN `contactRut` VARCHAR(32) NULL',
  'ALTER TABLE `Case` ADD COLUMN `facturacionJson` JSON NULL',
  'ALTER TABLE `Case` ADD COLUMN `shortId` VARCHAR(191) NULL',
];

async function run() {
  for (const sql of alters) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log('OK:', sql.substring(0, 55) + '...');
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('Duplicate column') || msg.includes('1060')) {
        console.log('SKIP (ya existe):', sql.substring(0, 45) + '...');
      } else {
        console.error('Error:', msg);
        process.exit(1);
      }
    }
  }
  // Índices
  for (const [name, sql] of [
    ['mercadopagoPaymentId', 'CREATE UNIQUE INDEX `Case_mercadopagoPaymentId_key` ON `Case`(`mercadopagoPaymentId`)'],
    ['shortId', 'CREATE UNIQUE INDEX `Case_shortId_key` ON `Case`(`shortId`)'],
  ]) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log('OK: índice', name);
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('Duplicate key') || msg.includes('1061')) {
        console.log('SKIP: índice', name, 'ya existe');
      } else {
        console.error('Error índice', name, ':', msg);
      }
    }
  }
  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
