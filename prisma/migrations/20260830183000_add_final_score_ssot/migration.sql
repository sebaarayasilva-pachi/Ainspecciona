-- AlterTable
-- Add SSOT (Single Source of Truth) score fields to Case table
ALTER TABLE `Case` ADD COLUMN `finalScore` INT NULL,
    ADD COLUMN `finalBadge` VARCHAR(16) NULL,
    ADD COLUMN `scoreVersion` VARCHAR(32) NULL,
    ADD COLUMN `kpiScores` JSON NULL,
    ADD COLUMN `scoredAt` DATETIME(3) NULL;
