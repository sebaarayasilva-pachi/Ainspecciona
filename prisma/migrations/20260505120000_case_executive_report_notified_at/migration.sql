-- Idempotent notification when business case report is fully emitted (all slots terminal).
ALTER TABLE `Case` ADD COLUMN `executiveReportNotifiedAt` DATETIME(3) NULL;
