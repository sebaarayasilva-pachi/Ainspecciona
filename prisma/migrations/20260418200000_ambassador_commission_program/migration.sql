-- CreateTable
CREATE TABLE `AmbassadorReferralAttribution` (
    `id` VARCHAR(191) NOT NULL,
    `ambassadorId` VARCHAR(191) NOT NULL,
    `referredTenantId` VARCHAR(191) NOT NULL,
    `codeSnapshot` VARCHAR(64) NOT NULL,
    `firstAccreditedAt` DATETIME(3) NULL,
    `commissionUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AmbassadorReferralAttribution_referredTenantId_key`(`referredTenantId`),
    INDEX `AmbassadorReferralAttribution_ambassadorId_idx`(`ambassadorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AmbassadorCommissionLine` (
    `id` VARCHAR(191) NOT NULL,
    `attributionId` VARCHAR(191) NOT NULL,
    `mercadopagoPaymentId` VARCHAR(96) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `netAmountClp` INTEGER NOT NULL,
    `accreditedAt` DATETIME(3) NOT NULL,
    `yearMonth` VARCHAR(7) NOT NULL,
    `plan` VARCHAR(64) NULL,
    `commissionClp` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AmbassadorCommissionLine_mercadopagoPaymentId_key`(`mercadopagoPaymentId`),
    INDEX `AmbassadorCommissionLine_attributionId_yearMonth_idx`(`attributionId`, `yearMonth`),
    INDEX `AmbassadorCommissionLine_yearMonth_idx`(`yearMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AmbassadorReferralAttribution` ADD CONSTRAINT `AmbassadorReferralAttribution_ambassadorId_fkey` FOREIGN KEY (`ambassadorId`) REFERENCES `Ambassador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AmbassadorReferralAttribution` ADD CONSTRAINT `AmbassadorReferralAttribution_referredTenantId_fkey` FOREIGN KEY (`referredTenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AmbassadorCommissionLine` ADD CONSTRAINT `AmbassadorCommissionLine_attributionId_fkey` FOREIGN KEY (`attributionId`) REFERENCES `AmbassadorReferralAttribution`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
