-- Ejecutar en Cloud SQL / producción donde existe la corredora "Test" o email test@ainspecciona.com
-- Regenerar hash: node scripts/print-google-tester-sql.mjs
-- Clave de prueba: Test1234! (no Test12324)

SET @tenantId = (
  SELECT id FROM `Tenant`
  WHERE LOWER(TRIM(name)) = LOWER('test')
     OR LOWER(TRIM(COALESCE(email,''))) = LOWER('test@ainspecciona.com')
  ORDER BY createdAt ASC
  LIMIT 1
);

INSERT INTO `User` (id, tenantId, email, fullName, phone, passwordHash, role, status, invitedAt, activatedAt, createdAt)
VALUES (
  'c87d0ac2-7b9c-4942-a3c0-fd03d8ea3fec',
  @tenantId,
  'test@ainspecciona.com',
  'Google Tester',
  NULL,
  'scrypt$fec696b071d532060cbd3e0b50c36283$d85f56edd0fd0af37b099302aadd90fd54ff357fff1e93b671b1280587b48d7f7b2dc0d4b2c4d2188a53c24d587908f950c0bbc3b9cf2c0f4438d86d61ad77af',
  'TENANT_USER',
  'ACTIVE',
  NOW(3),
  NOW(3),
  NOW(3)
)
ON DUPLICATE KEY UPDATE
  tenantId = @tenantId,
  fullName = VALUES(fullName),
  passwordHash = VALUES(passwordHash),
  role = 'TENANT_USER',
  status = 'ACTIVE',
  invitedAt = NOW(3),
  activatedAt = NOW(3);

-- 100 créditos: crea la fila si no existe, o actualiza el saldo a 100
INSERT INTO `TenantCredit` (id, tenantId, balance, createdAt, updatedAt)
SELECT UUID(), t.tid, 100, NOW(3), NOW(3)
FROM (SELECT @tenantId AS tid) AS t
WHERE t.tid IS NOT NULL
ON DUPLICATE KEY UPDATE balance = 100, updatedAt = NOW(3);
