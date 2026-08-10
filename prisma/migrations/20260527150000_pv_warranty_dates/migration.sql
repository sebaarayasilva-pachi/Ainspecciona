-- Fechas base garantía SERNAC (DOM + CBR) y resultado en ticket
ALTER TABLE `pv_unit` ADD COLUMN `domReceptionDate` DATETIME(3) NULL;
ALTER TABLE `pv_unit` ADD COLUMN `cbrInscriptionDate` DATETIME(3) NULL;

ALTER TABLE `pv_ticket` ADD COLUMN `warrantyStatus` VARCHAR(32) NULL;
ALTER TABLE `pv_ticket` ADD COLUMN `warrantyTier` VARCHAR(32) NULL;
ALTER TABLE `pv_ticket` ADD COLUMN `warrantyYears` INT NULL;
ALTER TABLE `pv_ticket` ADD COLUMN `warrantyExpiresAt` DATETIME(3) NULL;
