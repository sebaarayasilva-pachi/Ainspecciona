-- Ejecuta este SQL en Cloud SQL (consola o cliente MySQL conectado)
-- Para agregar la columna shortId que falta

ALTER TABLE `Case` ADD COLUMN `shortId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Case_shortId_key` ON `Case`(`shortId`);
