-- Fotos en slots de captura postventa
ALTER TABLE `pv_capture_slot` ADD COLUMN `photoPath` VARCHAR(512) NULL;
ALTER TABLE `pv_capture_slot` ADD COLUMN `mimeType` VARCHAR(64) NULL;
ALTER TABLE `pv_capture_slot` ADD COLUMN `rejectMessage` TEXT NULL;
ALTER TABLE `pv_capture_slot` ADD COLUMN `uploadedAt` DATETIME(3) NULL;

ALTER TABLE `pv_capture_slot` MODIFY COLUMN `status` ENUM('pending', 'uploaded', 'skipped', 'analyzed', 'rejected') NOT NULL DEFAULT 'pending';
