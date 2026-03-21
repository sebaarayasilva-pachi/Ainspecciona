-- Añade facturacionJson a Tenant (faltaba en migraciones)
-- Ejecutar con Cloud SQL Proxy: mysql -h 127.0.0.1 -P 3307 -u ainspecciona -p ainspecciona < prisma/add_tenant_facturacion.sql
ALTER TABLE `Tenant` ADD COLUMN `facturacionJson` JSON NULL;
