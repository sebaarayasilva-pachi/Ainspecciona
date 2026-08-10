-- Emisión DTE (SimpleFactura) idempotente por pago Mercado Pago
CREATE TABLE `SimpleFacturaEmission` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `mercadopagoPaymentId` VARCHAR(96) NOT NULL,
    `tipoDte` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `folio` INTEGER NULL,
    `trackId` VARCHAR(128) NULL,
    `responseJson` JSON NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SimpleFacturaEmission_mercadopagoPaymentId_key`(`mercadopagoPaymentId`),
    INDEX `SimpleFacturaEmission_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SimpleFacturaEmission` ADD CONSTRAINT `SimpleFacturaEmission_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
