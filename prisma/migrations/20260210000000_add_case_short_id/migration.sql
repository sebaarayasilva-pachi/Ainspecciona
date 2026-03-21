-- AlterTable
ALTER TABLE `Case` ADD COLUMN `shortId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Case_shortId_key` ON `Case`(`shortId`);
