-- Amplía logoUrl: las URLs públicas de GCS suelen superar VARCHAR(191).
ALTER TABLE `Tenant` MODIFY COLUMN `logoUrl` VARCHAR(512) NULL;
