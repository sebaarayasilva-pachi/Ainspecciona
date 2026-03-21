-- ReferralPartner + PartnerCommissionAccrual + Tenant referral fields

CREATE TABLE `ReferralPartner` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `contactEmail` VARCHAR(255) NULL,
    `payoutJson` JSON NULL,
    `commissionRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.1500,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReferralPartner_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PartnerCommissionAccrual` (
    `id` VARCHAR(191) NOT NULL,
    `referralPartnerId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `mercadopagoPaymentId` VARCHAR(64) NOT NULL,
    `grossAmountClp` INTEGER NOT NULL,
    `commissionRate` DECIMAL(6, 4) NOT NULL,
    `commissionAmountClp` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACCRUED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PartnerCommissionAccrual_mercadopagoPaymentId_key`(`mercadopagoPaymentId`),
    INDEX `PartnerCommissionAccrual_referralPartnerId_idx`(`referralPartnerId`),
    INDEX `PartnerCommissionAccrual_tenantId_idx`(`tenantId`),
    INDEX `PartnerCommissionAccrual_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Tenant`
  ADD COLUMN `referralPartnerId` VARCHAR(191) NULL,
  ADD COLUMN `referralCodeSnapshot` VARCHAR(64) NULL,
  ADD COLUMN `trialPartnerBenefitsAt` DATETIME(3) NULL;

CREATE INDEX `Tenant_referralPartnerId_idx` ON `Tenant`(`referralPartnerId`);

ALTER TABLE `PartnerCommissionAccrual`
  ADD CONSTRAINT `PartnerCommissionAccrual_referralPartnerId_fkey`
    FOREIGN KEY (`referralPartnerId`) REFERENCES `ReferralPartner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PartnerCommissionAccrual_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Tenant`
  ADD CONSTRAINT `Tenant_referralPartnerId_fkey`
    FOREIGN KEY (`referralPartnerId`) REFERENCES `ReferralPartner`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
