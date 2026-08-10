-- Expand roles: Administrador, Ejecutivo, Inspector (migrate OPERATOR → INSPECTOR)
ALTER TABLE `entrega_user` MODIFY COLUMN `role` ENUM('ADMIN', 'OPERATOR', 'EXECUTIVE', 'INSPECTOR') NOT NULL DEFAULT 'OPERATOR';

UPDATE `entrega_user` SET `role` = 'INSPECTOR' WHERE `role` = 'OPERATOR';

ALTER TABLE `entrega_user` MODIFY COLUMN `role` ENUM('ADMIN', 'EXECUTIVE', 'INSPECTOR') NOT NULL DEFAULT 'INSPECTOR';
