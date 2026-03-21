# Agregar columna shortId en Cloud Shell

Ejecuta estos comandos **uno por uno** en Cloud Shell:

## 1. Conectarte a MySQL
```bash
gcloud sql connect ainspecciona-mysql --user=ainspecciona --database=ainspecciona --project=ainspecciona
```
(ingresa la contraseña cuando la pida)

## 2. Verificar que estás en la base correcta
```sql
SELECT DATABASE();
```
(debe mostrar: ainspecciona)

## 3. Ver si shortId ya existe
```sql
SHOW COLUMNS FROM `Case` LIKE 'shortId';
```
(Si muestra una fila, la columna ya existe. Si no muestra nada, sigue.)

## 4. Agregar la columna (solo si no existe)
```sql
ALTER TABLE `Case` ADD COLUMN `shortId` VARCHAR(191) NULL;
```

## 5. Crear el índice
```sql
CREATE UNIQUE INDEX `Case_shortId_key` ON `Case`(`shortId`);
```
(Si da error "Duplicate key name", el índice ya existe, ignora.)

## 6. Verificar
```sql
SHOW COLUMNS FROM `Case`;
```
(debes ver shortId en la lista)

## 7. Salir
```sql
exit
```

**Importante:** Ejecuta cada comando por separado. No pegues todo junto porque `exit` cerraría la sesión antes de que termine.
