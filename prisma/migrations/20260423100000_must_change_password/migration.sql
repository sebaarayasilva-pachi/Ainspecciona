-- AlterTable
ALTER TABLE `Tenant` ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false;
