/**
 * Columnas / enum para inspector de obra + asignación de tickets.
 * Idempotente — seguro en cada arranque.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ warn?: Function }} [log]
 */
export async function ensurePostventaAssignmentSchema(prisma, log = {}) {
  if (!prisma) return;
  const warn = log.warn || console.warn;

  const stmts = [
    `ALTER TABLE \`pv_project\` ADD COLUMN \`defaultInspectorId\` VARCHAR(191) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`assignedToUserId\` VARCHAR(191) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`assignedAt\` DATETIME(3) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`scheduledAt\` DATETIME(3) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`closedAt\` DATETIME(3) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`closeNote\` VARCHAR(1000) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`closePhotoPath\` VARCHAR(512) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`repairTeamName\` VARCHAR(191) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`repairTeamContact\` VARCHAR(191) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`otGeneratedAt\` DATETIME(3) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`contactName\` VARCHAR(191) NULL`,
    `ALTER TABLE \`pv_ticket\` ADD COLUMN \`contactPhone\` VARCHAR(32) NULL`,
    `CREATE INDEX \`pv_project_defaultInspectorId_idx\` ON \`pv_project\`(\`defaultInspectorId\`)`,
    `CREATE INDEX \`pv_ticket_assignedToUserId_idx\` ON \`pv_ticket\`(\`assignedToUserId\`)`,
    `CREATE INDEX \`pv_ticket_scheduledAt_idx\` ON \`pv_ticket\`(\`scheduledAt\`)`
  ];

  for (const sql of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      const msg = String(err?.message || err);
      if (/Duplicate column|already exists|Duplicate key name/i.test(msg)) continue;
      warn({ err, sql: sql.slice(0, 80) }, 'ensure-postventa-assignment-schema');
    }
  }

  // MySQL enum: agregar INSPECTOR si falta
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SHOW COLUMNS FROM \`pv_user\` LIKE 'role'`
    );
    const type = String(rows?.[0]?.Type || '');
    if (type.includes('enum') && !type.includes('INSPECTOR')) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`pv_user\` MODIFY COLUMN \`role\` ENUM('ADMIN','EXECUTIVE','OPERATOR','INSPECTOR') NOT NULL DEFAULT 'OPERATOR'`
      );
    }
  } catch (err) {
    warn({ err }, 'ensure-postventa-inspector-role');
  }

  // FKs best-effort (pueden fallar si ya existen)
  const fks = [
    `ALTER TABLE \`pv_project\` ADD CONSTRAINT \`pv_project_defaultInspectorId_fkey\` FOREIGN KEY (\`defaultInspectorId\`) REFERENCES \`pv_user\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE \`pv_ticket\` ADD CONSTRAINT \`pv_ticket_assignedToUserId_fkey\` FOREIGN KEY (\`assignedToUserId\`) REFERENCES \`pv_user\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE`
  ];
  for (const sql of fks) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      const msg = String(err?.message || err);
      if (/Duplicate|already exists/i.test(msg)) continue;
      // ignore FK errors on shared DBs
    }
  }
}
