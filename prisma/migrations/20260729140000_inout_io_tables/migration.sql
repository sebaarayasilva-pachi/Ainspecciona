-- CreateTable
CREATE TABLE `io_tenant` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `io_tenant_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `io_user` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'OPERATOR', 'INSPECTOR') NOT NULL DEFAULT 'INSPECTOR',
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `passwordHash` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `io_user_email_key`(`email`),
    INDEX `io_user_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `io_property` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `address` VARCHAR(255) NOT NULL,
    `comuna` VARCHAR(64) NULL,
    `propertyType` ENUM('HOUSE', 'DEPARTMENT') NOT NULL DEFAULT 'DEPARTMENT',
    `bedroomsCount` INTEGER NOT NULL DEFAULT 1,
    `bathroomsCount` INTEGER NOT NULL DEFAULT 1,
    `hasPatio` BOOLEAN NOT NULL DEFAULT false,
    `hasLaundry` BOOLEAN NOT NULL DEFAULT false,
    `hasParking` BOOLEAN NOT NULL DEFAULT false,
    `hasElevator` BOOLEAN NOT NULL DEFAULT false,
    `hasEntranceGrille` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `io_property_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `io_lease` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `cycleStatus` VARCHAR(32) NOT NULL DEFAULT 'draft',
    `tenantName` VARCHAR(191) NULL,
    `tenantRut` VARCHAR(32) NULL,
    `tenantEmail` VARCHAR(191) NULL,
    `tenantPhone` VARCHAR(32) NULL,
    `ownerName` VARCHAR(191) NULL,
    `ownerEmail` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `inAcceptedAt` DATETIME(3) NULL,
    `inAcceptedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `io_lease_tenantId_idx`(`tenantId`),
    INDEX `io_lease_propertyId_idx`(`propertyId`),
    INDEX `io_lease_cycleStatus_idx`(`cycleStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `io_visit` (
    `id` VARCHAR(191) NOT NULL,
    `leaseId` VARCHAR(191) NOT NULL,
    `phase` ENUM('IN', 'OUT') NOT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `pairedVisitId` VARCHAR(191) NULL,
    `captureToken` VARCHAR(64) NULL,
    `capturedById` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `io_visit_captureToken_key`(`captureToken`),
    INDEX `io_visit_leaseId_idx`(`leaseId`),
    INDEX `io_visit_phase_idx`(`phase`),
    INDEX `io_visit_pairedVisitId_idx`(`pairedVisitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `io_visit_slot` (
    `id` VARCHAR(191) NOT NULL,
    `visitId` VARCHAR(191) NOT NULL,
    `slotCode` VARCHAR(64) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `instructions` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('PENDING', 'UPLOADED', 'NEEDS_RECAPTURE', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `recaptureCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `io_visit_slot_visitId_idx`(`visitId`),
    UNIQUE INDEX `io_visit_slot_visitId_slotCode_key`(`visitId`, `slotCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `io_photo` (
    `id` VARCHAR(191) NOT NULL,
    `visitId` VARCHAR(191) NOT NULL,
    `slotId` VARCHAR(191) NOT NULL,
    `filePath` VARCHAR(1024) NOT NULL,
    `mimeType` VARCHAR(64) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `qualityJson` JSON NULL,
    `comparableJson` JSON NULL,
    `deviceInfo` VARCHAR(255) NULL,
    `geoLat` DOUBLE NULL,
    `geoLng` DOUBLE NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `io_photo_visitId_idx`(`visitId`),
    INDEX `io_photo_slotId_idx`(`slotId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `io_diff_result` (
    `id` VARCHAR(191) NOT NULL,
    `visitId` VARCHAR(191) NOT NULL,
    `outSlotId` VARCHAR(191) NOT NULL,
    `slotCode` VARCHAR(64) NOT NULL,
    `classification` ENUM('sin_cambio', 'cambio_detectado', 'posible_deterioro', 'elemento_faltante', 'no_comparable') NOT NULL DEFAULT 'no_comparable',
    `severity` VARCHAR(32) NULL,
    `confidence` DOUBLE NULL,
    `description` TEXT NULL,
    `reviewStatus` ENUM('pending', 'accepted', 'rejected', 'needs_recapture') NOT NULL DEFAULT 'pending',
    `reviewerNote` TEXT NULL,
    `rawJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `io_diff_result_visitId_idx`(`visitId`),
    INDEX `io_diff_result_outSlotId_idx`(`outSlotId`),
    INDEX `io_diff_result_classification_idx`(`classification`),
    UNIQUE INDEX `io_diff_result_visitId_slotCode_key`(`visitId`, `slotCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `io_report` (
    `id` VARCHAR(191) NOT NULL,
    `leaseId` VARCHAR(191) NOT NULL,
    `kind` ENUM('IN_BASELINE', 'DIFF') NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `summaryJson` JSON NULL,
    `htmlSnapshot` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `io_report_leaseId_idx`(`leaseId`),
    INDEX `io_report_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `io_user` ADD CONSTRAINT `io_user_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `io_tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_property` ADD CONSTRAINT `io_property_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `io_tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_lease` ADD CONSTRAINT `io_lease_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `io_tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_lease` ADD CONSTRAINT `io_lease_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `io_property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_visit` ADD CONSTRAINT `io_visit_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `io_lease`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_visit` ADD CONSTRAINT `io_visit_pairedVisitId_fkey` FOREIGN KEY (`pairedVisitId`) REFERENCES `io_visit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_visit` ADD CONSTRAINT `io_visit_capturedById_fkey` FOREIGN KEY (`capturedById`) REFERENCES `io_user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_visit_slot` ADD CONSTRAINT `io_visit_slot_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `io_visit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_photo` ADD CONSTRAINT `io_photo_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `io_visit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_photo` ADD CONSTRAINT `io_photo_slotId_fkey` FOREIGN KEY (`slotId`) REFERENCES `io_visit_slot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_diff_result` ADD CONSTRAINT `io_diff_result_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `io_visit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_diff_result` ADD CONSTRAINT `io_diff_result_outSlotId_fkey` FOREIGN KEY (`outSlotId`) REFERENCES `io_visit_slot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `io_report` ADD CONSTRAINT `io_report_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `io_lease`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
