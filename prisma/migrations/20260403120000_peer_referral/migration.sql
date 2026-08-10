-- Peer referral codes + attribution (etapa 1)

ALTER TABLE `Tenant` ADD COLUMN `peerReferralCode` VARCHAR(32) NULL;

CREATE UNIQUE INDEX `Tenant_peerReferralCode_key` ON `Tenant`(`peerReferralCode`);

CREATE TABLE `PeerReferralAttribution` (
    `id` VARCHAR(191) NOT NULL,
    `referrerTenantId` VARCHAR(191) NOT NULL,
    `referredTenantId` VARCHAR(191) NOT NULL,
    `peerCodeUsed` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PeerReferralAttribution_referredTenantId_key`(`referredTenantId`),
    INDEX `PeerReferralAttribution_referrerTenantId_idx`(`referrerTenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PeerReferralAttribution`
  ADD CONSTRAINT `PeerReferralAttribution_referrerTenantId_fkey`
    FOREIGN KEY (`referrerTenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PeerReferralAttribution_referredTenantId_fkey`
    FOREIGN KEY (`referredTenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
