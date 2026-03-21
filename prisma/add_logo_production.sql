-- Ejecutar en Cloud SQL producción (tabla Tenant con mayúscula)
-- Opción 1: Cloud Shell: gcloud sql connect ainspecciona-mysql --user=ainspecciona --database=ainspecciona --project=ainspecciona < prisma/add_logo_production.sql
-- Opción 2: Con proxy: mysql -h 127.0.0.1 -u ainspecciona -p ainspecciona < prisma/add_logo_production.sql
ALTER TABLE `Tenant` ADD COLUMN `logoUrl` VARCHAR(191) NULL;
