/**
 * Imprime SQL para crear/actualizar el ejecutivo Google Tester en la BD de producción
 * (útil si no puedes correr el seed contra esa BD desde tu PC).
 *
 * node scripts/print-google-tester-sql.mjs
 */
import crypto from 'node:crypto';

const PASSWORD = 'Test1234A';
const EXEC_EMAILS = ['tester@ainspecciona.com', 'test@ainspecciona.com'];
const EXEC_NAME = 'Google Tester';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

const passwordHash = hashPassword(PASSWORD);

// MySQL: escapar comillas simples en hash
const hashEsc = passwordHash.replace(/'/g, "''");

let sql = `-- Ejecutar en la misma BD donde está la corredora Test / test@ainspecciona.com
-- Ejecutivo demo: ${EXEC_EMAILS.join(' / ')} · clave ${PASSWORD}

SET @tenantId = (
  SELECT id FROM \`Tenant\`
  WHERE LOWER(TRIM(name)) = LOWER('test')
     OR LOWER(TRIM(COALESCE(email,''))) = LOWER('test@ainspecciona.com')
  ORDER BY createdAt ASC
  LIMIT 1
);

-- Si @tenantId es NULL, revisá nombre/email de la corredora en Tenant.

`;

for (const EXEC_EMAIL of EXEC_EMAILS) {
  const id = crypto.randomUUID();
  sql += `INSERT INTO \`User\` (id, tenantId, email, fullName, phone, passwordHash, role, status, invitedAt, activatedAt, createdAt)
VALUES (
  '${id}',
  @tenantId,
  '${EXEC_EMAIL}',
  '${EXEC_NAME}',
  NULL,
  '${hashEsc}',
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

`;
}

sql += `-- Créditos (solo si aún no hay fila para ese tenant)
INSERT INTO \`TenantCredit\` (id, tenantId, balance, createdAt, updatedAt)
SELECT UUID(), t.tid, 100, NOW(3), NOW(3)
FROM (SELECT @tenantId AS tid) AS t
WHERE t.tid IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM \`TenantCredit\` c WHERE c.tenantId = t.tid);
`;

console.log(sql);
