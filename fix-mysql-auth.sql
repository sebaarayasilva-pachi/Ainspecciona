-- Ejecutar como root en MySQL para corregir autenticación
-- Reemplaza TU_CLAVE por la contraseña real del usuario ainspecciona
-- mysql -u root -p < fix-mysql-auth.sql

ALTER USER 'ainspecciona'@'localhost' IDENTIFIED WITH mysql_native_password BY 'TU_CLAVE';
FLUSH PRIVILEGES;
