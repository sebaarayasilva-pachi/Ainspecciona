-- CreateTable
CREATE TABLE `WhatsAppConversation` (
    `id` VARCHAR(191) NOT NULL,
    `waId` VARCHAR(32) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `state` VARCHAR(64) NOT NULL DEFAULT 'default',
    `lastInboundAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsAppConversation_waId_key`(`waId`),
    INDEX `WhatsAppConversation_tenantId_idx`(`tenantId`),
    INDEX `WhatsAppConversation_lastInboundAt_idx`(`lastInboundAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
    `body` TEXT NULL,
    `externalId` VARCHAR(128) NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WhatsAppMessage_externalId_key`(`externalId`),
    INDEX `WhatsAppMessage_conversationId_idx`(`conversationId`),
    INDEX `WhatsAppMessage_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppProcessedEvent` (
    `id` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(128) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WhatsAppProcessedEvent_externalId_key`(`externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WhatsAppConversation` ADD CONSTRAINT `WhatsAppConversation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppMessage` ADD CONSTRAINT `WhatsAppMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `WhatsAppConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
