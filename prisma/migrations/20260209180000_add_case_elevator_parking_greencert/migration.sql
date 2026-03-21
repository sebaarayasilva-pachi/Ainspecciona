-- AlterTable
ALTER TABLE `Case` ADD COLUMN `hasElevator` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `hasParking` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `hasGreenCertificate` BOOLEAN NOT NULL DEFAULT false;
