-- CreateTable
CREATE TABLE `pv_user` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'EXECUTIVE', 'OPERATOR') NOT NULL DEFAULT 'OPERATOR',
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `passwordHash` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pv_user_email_key`(`email`),
    INDEX `pv_user_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pv_user` ADD CONSTRAINT `pv_user_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `pv_tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
