-- CreateTable
CREATE TABLE `CaptureUploadMetric` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `slotId` VARCHAR(191) NOT NULL,
    `durationMs` INTEGER NOT NULL,
    `passed` BOOLEAN NOT NULL,
    `imageBytes` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CaptureUploadMetric_createdAt_idx`(`createdAt`),
    INDEX `CaptureUploadMetric_caseId_idx`(`caseId`),
    INDEX `CaptureUploadMetric_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
