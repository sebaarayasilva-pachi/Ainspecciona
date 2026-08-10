-- Métricas de exactitud Aintelligence (correcciones por informe)
CREATE TABLE `ai_report_correction` (
    `id` VARCHAR(191) NOT NULL,
    `source` ENUM('PROPERTYCHECK', 'AINSPECTA', 'POSTVENTA') NOT NULL DEFAULT 'AINSPECTA',
    `caseId` VARCHAR(191) NULL,
    `caseShortId` VARCHAR(32) NULL,
    `tenantId` VARCHAR(191) NULL,
    `externalInspectionId` VARCHAR(128) NULL,
    `slotsCorrected` INTEGER NOT NULL,
    `slotsTotal` INTEGER NOT NULL,
    `accuracyPct` DOUBLE NOT NULL,
    `slotCodes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_report_correction_createdAt_idx`(`createdAt`),
    INDEX `ai_report_correction_caseId_idx`(`caseId`),
    INDEX `ai_report_correction_tenantId_idx`(`tenantId`),
    INDEX `ai_report_correction_source_idx`(`source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
