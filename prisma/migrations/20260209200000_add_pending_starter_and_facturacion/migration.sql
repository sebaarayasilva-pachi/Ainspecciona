-- CreateTable PendingStarterPayment
CREATE TABLE `PendingStarterPayment` (
    `id` VARCHAR(191) NOT NULL,
    `contactNombre` VARCHAR(120) NOT NULL,
    `contactApellido` VARCHAR(120) NOT NULL,
    `contactRut` VARCHAR(32) NOT NULL,
    `contactEmail` VARCHAR(255) NOT NULL,
    `necesitaFactura` BOOLEAN NOT NULL DEFAULT false,
    `facturaRazonSocial` VARCHAR(255) NULL,
    `facturaRut` VARCHAR(32) NULL,
    `facturaDireccion` VARCHAR(255) NULL,
    `facturaComuna` VARCHAR(120) NULL,
    `facturaCiudad` VARCHAR(120) NULL,
    `facturaGiro` VARCHAR(120) NULL,
    `facturaEmail` VARCHAR(255) NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `PendingStarterPayment_createdAt_idx` ON `PendingStarterPayment`(`createdAt`);
