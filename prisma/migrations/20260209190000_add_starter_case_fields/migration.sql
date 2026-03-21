-- AlterTable
ALTER TABLE `Case` ADD COLUMN `contactEmail` VARCHAR(255) NULL,
    ADD COLUMN `contactName` VARCHAR(255) NULL,
    ADD COLUMN `mercadopagoPaymentId` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Case_mercadopagoPaymentId_key` ON `Case`(`mercadopagoPaymentId`);
