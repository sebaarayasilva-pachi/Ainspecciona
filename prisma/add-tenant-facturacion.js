/**
 * Añade facturacionJson a Tenant en producción.
 * Uso: Con Cloud SQL Proxy en 3307, DATABASE_URL apuntando a 127.0.0.1:3307
 *   node prisma/add-tenant-facturacion.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE `Tenant` ADD COLUMN `facturacionJson` JSON NULL'
    );
    console.log('OK: Columna facturacionJson añadida a Tenant.');
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('Duplicate column') || msg.includes('1060')) {
      console.log('La columna facturacionJson ya existe.');
      process.exit(0);
    }
    console.error('Error:', msg);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
