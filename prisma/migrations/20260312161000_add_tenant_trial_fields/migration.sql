-- Add trial fields for corporate free trial lifecycle
ALTER TABLE `Tenant`
  ADD COLUMN `trialSubscriptionId` VARCHAR(64) NULL,
  ADD COLUMN `trialStatus` VARCHAR(32) NULL,
  ADD COLUMN `trialStartedAt` DATETIME(3) NULL,
  ADD COLUMN `trialEndsAt` DATETIME(3) NULL,
  ADD COLUMN `trialConvertedAt` DATETIME(3) NULL,
  ADD COLUMN `trialCancelledAt` DATETIME(3) NULL,
  ADD COLUMN `trialRealInspectionUsedAt` DATETIME(3) NULL,
  ADD COLUMN `trialBlockedReason` VARCHAR(255) NULL,
  ADD COLUMN `trialEligibilityKey` VARCHAR(191) NULL,
  ADD COLUMN `trialAutoCharge` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `trialSource` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `Tenant_trialSubscriptionId_key` ON `Tenant`(`trialSubscriptionId`);
CREATE INDEX `Tenant_trialStatus_idx` ON `Tenant`(`trialStatus`);
CREATE INDEX `Tenant_trialEndsAt_idx` ON `Tenant`(`trialEndsAt`);
CREATE INDEX `Tenant_trialEligibilityKey_idx` ON `Tenant`(`trialEligibilityKey`);
