-- Tenant: "Corredora Testers" — solo clave, 100 créditos y ACTIVE
-- Email: test2@ainspecciona.com
-- Clave: Test2@1234!  (11 caracteres: incluye el ! final — si ves 10 puntos en el login, te falta el !)
--
-- Si el login falla: ejecutá antes esto y revisá nombre/email reales:
--   SELECT id, name, email, status FROM `Tenant` WHERE name LIKE '%tester%' OR email LIKE '%test2%';

SET @ph = 'scrypt$70df2081d5a57708b80b5b7fa229c1f0$2110a4a4ed446cc8d32dba989bc7c8e7cb3533d380bc9cfcd5586c63cfd75c50e99512b5cdf9e31ade9beb5385ceaefefdcc97f4b50d974cd4ca56b96603bde8';

-- Nombre exacto del tenant (sin importar mayúsculas) o email test2@
UPDATE `Tenant`
SET
  email = 'test2@ainspecciona.com',
  passwordHash = @ph,
  status = 'ACTIVE'
WHERE LOWER(TRIM(name)) = LOWER('Corredora Testers')
   OR LOWER(TRIM(COALESCE(email, ''))) = LOWER('test2@ainspecciona.com');

SET @tenantId = (
  SELECT id FROM `Tenant`
  WHERE LOWER(TRIM(name)) = LOWER('Corredora Testers')
     OR LOWER(TRIM(COALESCE(email, ''))) = LOWER('test2@ainspecciona.com')
  ORDER BY createdAt ASC
  LIMIT 1
);

INSERT INTO `TenantCredit` (id, tenantId, balance, createdAt, updatedAt)
SELECT UUID(), t.tid, 100, NOW(3), NOW(3)
FROM (SELECT @tenantId AS tid) AS t
WHERE t.tid IS NOT NULL
ON DUPLICATE KEY UPDATE balance = 100, updatedAt = NOW(3);
