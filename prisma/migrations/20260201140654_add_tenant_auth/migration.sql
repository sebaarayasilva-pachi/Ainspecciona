-- AlterTable
ALTER TABLE `case` ADD COLUMN `assignedUserId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `tenant` ADD COLUMN `passwordHash` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Case_assignedUserId_idx` ON `Case`(`assignedUserId`);

-- AddForeignKey
ALTER TABLE `Case` ADD CONSTRAINT `Case_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
