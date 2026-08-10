/**
 * Crea tablas del core de plataforma si aún no existen (MySQL).
 */
let ensured = false;

export async function ensurePlatformSchema(prisma) {
  if (!prisma) return { ok: false, skipped: true };
  if (ensured) return { ok: true, skipped: true };

  const stmts = [
    `CREATE TABLE IF NOT EXISTS platform_organization (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      slug VARCHAR(64) NOT NULL,
      name VARCHAR(191) NOT NULL,
      rut VARCHAR(32) NULL,
      type ENUM('DEVELOPER','BROKER','PROPERTY_MANAGER','INTERNAL','OTHER') NOT NULL DEFAULT 'OTHER',
      status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
      logoUrl VARCHAR(512) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      UNIQUE KEY platform_organization_slug_key (slug)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS platform_user (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      email VARCHAR(191) NOT NULL,
      fullName VARCHAR(191) NOT NULL,
      passwordHash VARCHAR(255) NOT NULL,
      status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
      isPlatformAdmin TINYINT(1) NOT NULL DEFAULT 0,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      UNIQUE KEY platform_user_email_key (email)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS platform_organization_member (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      organizationId VARCHAR(191) NOT NULL,
      userId VARCHAR(191) NOT NULL,
      role ENUM('PLATFORM_ADMIN','ORGANIZATION_ADMIN','MEMBER','VIEWER') NOT NULL DEFAULT 'MEMBER',
      status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      UNIQUE KEY platform_org_member_org_user_key (organizationId, userId),
      KEY platform_org_member_user_idx (userId),
      CONSTRAINT platform_org_member_org_fkey FOREIGN KEY (organizationId) REFERENCES platform_organization(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT platform_org_member_user_fkey FOREIGN KEY (userId) REFERENCES platform_user(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS platform_organization_product (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      organizationId VARCHAR(191) NOT NULL,
      product ENUM('INSPECTION','RECEPTION','POSTSALE','INOUT','SCAN') NOT NULL,
      status ENUM('ENABLED','DISABLED') NOT NULL DEFAULT 'ENABLED',
      plan VARCHAR(64) NULL,
      settings JSON NULL,
      startedAt DATETIME(3) NULL,
      expiresAt DATETIME(3) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      UNIQUE KEY platform_org_product_key (organizationId, product),
      KEY platform_org_product_product_idx (product),
      CONSTRAINT platform_org_product_org_fkey FOREIGN KEY (organizationId) REFERENCES platform_organization(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS platform_legacy_identity_link (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      platformUserId VARCHAR(191) NOT NULL,
      organizationId VARCHAR(191) NOT NULL,
      product ENUM('INSPECTION','RECEPTION','POSTSALE','INOUT','SCAN') NOT NULL,
      legacyTenantId VARCHAR(191) NOT NULL,
      legacyUserId VARCHAR(191) NOT NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      UNIQUE KEY platform_legacy_user_product_key (platformUserId, product),
      KEY platform_legacy_product_ids_idx (product, legacyTenantId, legacyUserId),
      KEY platform_legacy_org_idx (organizationId),
      CONSTRAINT platform_legacy_user_fkey FOREIGN KEY (platformUserId) REFERENCES platform_user(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT platform_legacy_org_fkey FOREIGN KEY (organizationId) REFERENCES platform_organization(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  ];

  for (const sql of stmts) {
    let attempt = 0;
    for (;;) {
      try {
        await prisma.$executeRawUnsafe(sql);
        break;
      } catch (err) {
        const deadlock = String(err?.message || '').includes('Deadlock') || err?.code === '1213';
        attempt += 1;
        if (!deadlock || attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 80 * attempt));
      }
    }
  }
  ensured = true;
  return { ok: true };
}
