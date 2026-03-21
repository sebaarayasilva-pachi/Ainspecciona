-- AlterTable Case: contactRut, facturacionJson (PendingStarterPayment ya existe en add_pending_starter_and_facturacion)
ALTER TABLE `Case` ADD COLUMN `contactRut` VARCHAR(32) NULL,
    ADD COLUMN `facturacionJson` JSON NULL;
