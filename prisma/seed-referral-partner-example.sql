-- Ejemplo: partner de prueba (ejecutar tras migración 20260319120000_referral_partners_commission)
-- Cambia el código DEMO2026 en producción.

INSERT INTO `ReferralPartner` (`id`, `code`, `name`, `type`, `contactEmail`, `payoutJson`, `commissionRate`, `active`, `createdAt`, `updatedAt`)
VALUES (
  REPLACE(UUID(), '-', ''),
  'DEMO2026',
  'Partner demo',
  'ALIANZA',
  NULL,
  NULL,
  0.1500,
  1,
  NOW(3),
  NOW(3)
);
