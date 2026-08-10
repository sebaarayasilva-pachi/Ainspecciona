-- MagicLinkToken: enlaces de acceso / crear clave para tenants (promo, business, etc.)

CREATE TABLE IF NOT EXISTS `MagicLinkToken` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MagicLinkToken_token_key`(`token`),
    INDEX `MagicLinkToken_tenantId_idx`(`tenantId`),
    INDEX `MagicLinkToken_expiresAt_idx`(`expiresAt`),
    INDEX `MagicLinkToken_token_idx`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
