-- Marcar corredora Test como ACTIVE
UPDATE `Tenant`
SET status = 'ACTIVE'
WHERE LOWER(TRIM(name)) = LOWER('test')
   OR LOWER(TRIM(COALESCE(email,''))) = LOWER('test@ainspecciona.com');
