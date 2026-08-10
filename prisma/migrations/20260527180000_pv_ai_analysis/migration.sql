-- Informe de análisis IA postventa (evidencia + hallazgo)
CREATE TABLE `pv_ai_analysis` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `model` VARCHAR(64) NULL,
    `severity` VARCHAR(16) NULL,
    `summaryText` TEXT NULL,
    `report` JSON NULL,
    `errorMessage` TEXT NULL,
    `confidence` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `pv_ai_analysis_ticketId_idx`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `pv_ai_analysis` ADD CONSTRAINT `pv_ai_analysis_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `pv_ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
