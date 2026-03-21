-- Corredora "Corredora Testers": activa + sin banner "Suscripción pendiente"
--
-- En /tenant, "Pendiente" suele ser subscriptionStatus/trial (no el campo status).
-- Si mpSubscriptionId o trialStatus existen y subscriptionStatus es NULL, la UI muestra Pendiente.
-- Este UPDATE deja la corredora como cuenta interna: ACTIVE, sin MP/trial colgados.
--
-- Clave panel: Test2@1234! (misma que internal-testers-tenant.sql)

SET @ph = 'scrypt$70df2081d5a57708b80b5b7fa229c1f0$2110a4a4ed446cc8d32dba989bc7c8e7cb3533d380bc9cfcd5586c63cfd75c50e99512b5cdf9e31ade9beb5385ceaefefdcc97f4b50d974cd4ca56b96603bde8';

-- Ver fila antes (opcional)
SELECT id, name, email, status, subscriptionStatus, trialStatus, mpSubscriptionId
FROM `Tenant`
WHERE name LIKE '%Corredora%' AND name LIKE '%Testers%'
   OR LOWER(TRIM(COALESCE(email, ''))) = LOWER('test2@ainspecciona.com');

UPDATE `Tenant`
SET
  status = 'ACTIVE',
  email = 'test2@ainspecciona.com',
  passwordHash = @ph,
  subscriptionStatus = NULL,
  subscriptionExpiresAt = NULL,
  mpSubscriptionId = NULL,
  trialSubscriptionId = NULL,
  trialStatus = NULL,
  trialStartedAt = NULL,
  trialEndsAt = NULL,
  trialConvertedAt = NULL,
  trialCancelledAt = NULL,
  trialRealInspectionUsedAt = NULL,
  trialBlockedReason = NULL,
  trialEligibilityKey = NULL,
  trialAutoCharge = 0,
  trialSource = NULL
WHERE (name LIKE '%Corredora%' AND name LIKE '%Testers%')
   OR LOWER(TRIM(COALESCE(email, ''))) = LOWER('test2@ainspecciona.com');
