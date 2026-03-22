-- Supplier: dirección y código (ej. postal / comuna)

ALTER TABLE `Supplier`
  ADD COLUMN `address` VARCHAR(512) NULL,
  ADD COLUMN `codigo` VARCHAR(64) NULL;

UPDATE `Supplier` SET `legalName` = `name` WHERE `legalName` IS NULL OR `legalName` = '';
