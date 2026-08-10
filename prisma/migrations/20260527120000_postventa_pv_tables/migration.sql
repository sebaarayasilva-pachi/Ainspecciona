-- Postventa inmobiliaria: tablas Pv* (aisladas de inspecciones STI)

CREATE TABLE `pv_tenant` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pv_tenant_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pv_project` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pv_project_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `pv_project_tenantId_slug_key`(`tenantId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pv_owner` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `rut` VARCHAR(32) NULL,
    `phone` VARCHAR(32) NULL,
    `email` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pv_owner_tenantId_idx`(`tenantId`),
    INDEX `pv_owner_rut_idx`(`rut`),
    INDEX `pv_owner_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pv_unit` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NULL,
    `tower` VARCHAR(32) NOT NULL DEFAULT '',
    `unitNumber` VARCHAR(32) NOT NULL,
    `label` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pv_unit_projectId_idx`(`projectId`),
    INDEX `pv_unit_ownerId_idx`(`ownerId`),
    UNIQUE INDEX `pv_unit_projectId_tower_unitNumber_key`(`projectId`, `tower`, `unitNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pv_ticket` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `unitId` VARCHAR(191) NULL,
    `ownerId` VARCHAR(191) NULL,
    `projectId` VARCHAR(191) NULL,
    `shortId` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
    `source` VARCHAR(16) NULL,
    `conversationSessionId` VARCHAR(128) NULL,
    `summary` TEXT NOT NULL,
    `preliminaryCategory` VARCHAR(64) NOT NULL,
    `roomHint` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pv_ticket_shortId_key`(`shortId`),
    INDEX `pv_ticket_tenantId_idx`(`tenantId`),
    INDEX `pv_ticket_status_idx`(`status`),
    INDEX `pv_ticket_shortId_idx`(`shortId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pv_capture_session` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `category` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pv_capture_session_token_key`(`token`),
    INDEX `pv_capture_session_ticketId_idx`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pv_capture_slot` (
    `id` VARCHAR(191) NOT NULL,
    `captureSessionId` VARCHAR(191) NOT NULL,
    `slotCode` VARCHAR(64) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `instructions` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('pending', 'uploaded', 'analyzed', 'rejected') NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pv_capture_slot_captureSessionId_idx`(`captureSessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pv_ticket_event` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(64) NOT NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pv_ticket_event_ticketId_idx`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `pv_project` ADD CONSTRAINT `pv_project_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `pv_tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `pv_owner` ADD CONSTRAINT `pv_owner_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `pv_tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `pv_unit` ADD CONSTRAINT `pv_unit_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `pv_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `pv_unit` ADD CONSTRAINT `pv_unit_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `pv_owner`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `pv_ticket` ADD CONSTRAINT `pv_ticket_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `pv_tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `pv_ticket` ADD CONSTRAINT `pv_ticket_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `pv_unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `pv_ticket` ADD CONSTRAINT `pv_ticket_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `pv_owner`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `pv_capture_session` ADD CONSTRAINT `pv_capture_session_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `pv_ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `pv_capture_slot` ADD CONSTRAINT `pv_capture_slot_captureSessionId_fkey` FOREIGN KEY (`captureSessionId`) REFERENCES `pv_capture_session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `pv_ticket_event` ADD CONSTRAINT `pv_ticket_event_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `pv_ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
