-- Ejecutar como root: mysql -u root -p < setup-mysql-user.sql
-- O entrar a MySQL y pegar estos comandos uno por uno.

CREATE DATABASE IF NOT EXISTS ainspecciona;

-- Eliminar usuario si existe (para recrearlo con mysql_native_password)
DROP USER IF EXISTS 'ainspecciona'@'localhost';
DROP USER IF EXISTS 'ainspecciona'@'127.0.0.1';

-- Crear usuario con autenticación compatible
CREATE USER 'ainspecciona'@'localhost' IDENTIFIED WITH mysql_native_password BY 'Charli01$';
CREATE USER 'ainspecciona'@'127.0.0.1' IDENTIFIED WITH mysql_native_password BY 'Charli01$';

GRANT ALL PRIVILEGES ON ainspecciona.* TO 'ainspecciona'@'localhost';
GRANT ALL PRIVILEGES ON ainspecciona.* TO 'ainspecciona'@'127.0.0.1';
FLUSH PRIVILEGES;
