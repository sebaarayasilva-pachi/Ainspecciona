-- KB RAG: base de conocimiento unificada + veredictos ITO por slot (Ainspecciona) y por hallazgo (Postventa)
CREATE TABLE `knowledge_entry` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `source` ENUM('PROPERTYCHECK', 'AINSPECTA', 'POSTVENTA') NOT NULL,
    `entryType` ENUM('finding_example', 'anti_example', 'correction', 'ticket_learning') NOT NULL,
    `status` ENUM('candidate', 'approved', 'rejected', 'disabled') NOT NULL DEFAULT 'candidate',
    `kpiKey` VARCHAR(64) NULL,
    `category` VARCHAR(64) NULL,
    `severity` VARCHAR(16) NULL,
    `text` TEXT NOT NULL,
    `payload` JSON NULL,
    `sourceRef` VARCHAR(191) NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `embedding` JSON NULL,
    `embeddingModel` VARCHAR(64) NULL,
    `createdBy` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `knowledge_entry_fingerprint_key`(`fingerprint`),
    INDEX `knowledge_entry_status_idx`(`status`),
    INDEX `knowledge_entry_source_entryType_idx`(`source`, `entryType`),
    INDEX `knowledge_entry_kpiKey_idx`(`kpiKey`),
    INDEX `knowledge_entry_category_idx`(`category`),
    INDEX `knowledge_entry_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `slot_review` (
    `id` VARCHAR(191) NOT NULL,
    `slotId` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `verdict` VARCHAR(16) NOT NULL,
    `humanCode` VARCHAR(64) NULL,
    `humanSeverity` VARCHAR(16) NULL,
    `humanMessage` TEXT NULL,
    `humanKpiKey` VARCHAR(64) NULL,
    `note` TEXT NULL,
    `reviewerEmail` VARCHAR(255) NULL,
    `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `slot_review_slotId_key`(`slotId`),
    INDEX `slot_review_caseId_idx`(`caseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pv_analysis_review` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `analysisId` VARCHAR(191) NULL,
    `slotCode` VARCHAR(64) NULL,
    `verdict` VARCHAR(16) NOT NULL,
    `humanCategory` VARCHAR(64) NULL,
    `humanSeverity` VARCHAR(16) NULL,
    `humanMessage` TEXT NULL,
    `note` TEXT NULL,
    `reviewerEmail` VARCHAR(255) NULL,
    `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pv_analysis_review_ticketId_analysisId_slotCode_key`(`ticketId`, `analysisId`, `slotCode`),
    INDEX `pv_analysis_review_ticketId_idx`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
