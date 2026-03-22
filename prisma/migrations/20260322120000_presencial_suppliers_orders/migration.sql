-- Supplier (proveedores presenciales) + PresencialOrder (OC tras pago MP)

CREATE TABLE `Supplier` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `legalName` VARCHAR(255) NULL,
    `rut` VARCHAR(32) NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(64) NULL,
    `contactName` VARCHAR(255) NULL,
    `notes` LONGTEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `isDefaultPresencial` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Supplier_code_key`(`code`),
    INDEX `Supplier_active_idx`(`active`),
    INDEX `Supplier_isDefaultPresencial_idx`(`isDefaultPresencial`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PresencialOrder` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `mercadopagoPaymentId` VARCHAR(64) NOT NULL,
    `amountClp` INTEGER NULL,
    `surfaceM2` INTEGER NULL,
    `addressSnapshot` LONGTEXT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING_OC',
    `ocNumber` VARCHAR(64) NULL,
    `adminNotes` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PresencialOrder_mercadopagoPaymentId_key`(`mercadopagoPaymentId`),
    INDEX `PresencialOrder_tenantId_idx`(`tenantId`),
    INDEX `PresencialOrder_caseId_idx`(`caseId`),
    INDEX `PresencialOrder_supplierId_idx`(`supplierId`),
    INDEX `PresencialOrder_status_idx`(`status`),
    INDEX `PresencialOrder_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PresencialOrder` ADD CONSTRAINT `PresencialOrder_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PresencialOrder` ADD CONSTRAINT `PresencialOrder_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PresencialOrder` ADD CONSTRAINT `PresencialOrder_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `Supplier` (`id`, `code`, `name`, `contactName`, `notes`, `active`, `isDefaultPresencial`, `createdAt`, `updatedAt`)
VALUES (
    'a0000001-0000-4000-8000-000000000001',
    'paulo-inspecciona',
    'Paulo Inspecciona',
    'Paulo Yañez',
    'Proveedor por defecto para inspección presencial. Completa RUT, email y teléfono en Admin → Proveedores.',
    true,
    true,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
);
