-- Dirección y comuna del proyecto (lookup por ubicación → inmobiliaria)
ALTER TABLE `pv_project` ADD COLUMN `address` VARCHAR(255) NULL;
ALTER TABLE `pv_project` ADD COLUMN `comuna` VARCHAR(64) NULL;
CREATE INDEX `pv_project_comuna_idx` ON `pv_project`(`comuna`);
