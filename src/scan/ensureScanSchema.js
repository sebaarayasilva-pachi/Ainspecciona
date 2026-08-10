/**
 * Crea tablas Scan si aún no existen (MySQL).
 */
export async function ensureScanSchema(prisma) {
  if (!prisma) return { ok: false, skipped: true };
  const stmts = [
    `CREATE TABLE IF NOT EXISTS scan_org (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      slug VARCHAR(64) NOT NULL,
      name VARCHAR(191) NOT NULL,
      status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      UNIQUE KEY scan_org_slug_key (slug)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS scan_user (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      orgId VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL,
      fullName VARCHAR(191) NOT NULL,
      status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
      passwordHash VARCHAR(255) NOT NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      UNIQUE KEY scan_user_email_key (email),
      KEY scan_user_orgId_idx (orgId),
      CONSTRAINT scan_user_orgId_fkey FOREIGN KEY (orgId) REFERENCES scan_org(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS scan_property (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      orgId VARCHAR(191) NOT NULL,
      name VARCHAR(191) NOT NULL,
      address VARCHAR(255) NULL,
      bedrooms INT NULL,
      bathrooms INT NULL,
      areaM2 DOUBLE NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      KEY scan_property_orgId_idx (orgId),
      CONSTRAINT scan_property_orgId_fkey FOREIGN KEY (orgId) REFERENCES scan_org(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS scan_job (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      orgId VARCHAR(191) NOT NULL,
      propertyId VARCHAR(191) NOT NULL,
      publicId VARCHAR(32) NOT NULL,
      status ENUM('DRAFT','CAPTURING','CAPTURED','UPLOADING','UPLOADED','QUEUED','PROCESSING','READY','FAILED') NOT NULL DEFAULT 'DRAFT',
      captureMode ENUM('MOCK','ARCORE_DEPTH','ARCORE_STANDARD') NOT NULL DEFAULT 'MOCK',
      processingProgress INT NOT NULL DEFAULT 0,
      modelType ENUM('GLB','GAUSSIAN_SPLAT','MOCK_SCENE') NULL,
      modelUrl VARCHAR(1024) NULL,
      planUrl VARCHAR(1024) NULL,
      planJson JSON NULL,
      packagePath VARCHAR(1024) NULL,
      durationSeconds INT NOT NULL DEFAULT 0,
      acceptedFrames INT NOT NULL DEFAULT 0,
      errorMessage VARCHAR(512) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      readyAt DATETIME(3) NULL,
      UNIQUE KEY scan_job_publicId_key (publicId),
      KEY scan_job_orgId_idx (orgId),
      KEY scan_job_propertyId_idx (propertyId),
      KEY scan_job_status_idx (status),
      CONSTRAINT scan_job_orgId_fkey FOREIGN KEY (orgId) REFERENCES scan_org(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT scan_job_propertyId_fkey FOREIGN KEY (propertyId) REFERENCES scan_property(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  ];
  for (const sql of stmts) {
    await prisma.$executeRawUnsafe(sql);
  }
  return { ok: true };
}
