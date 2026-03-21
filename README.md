# Ainspecciona Web - MVP Demo Local

Sistema de inspección y gestión automatizada de propiedades inmobiliarias

## 🚀 Inicio Rápido

### Instalación

```bash
# Instalar dependencias
npm install
```

### Ejecutar

```bash
npm run dev
```

Luego abre tu navegador en: **http://localhost:3000**

### Funcionalidad

- Carga una imagen de una propiedad
- El sistema analiza automáticamente:
  - **Brillo**: Si es muy oscura (mean < 35) → Badge Rojo
  - **Tamaño**: Si es muy pequeña (< 800x600) → Badge Amarillo
  - **OK**: Si cumple requisitos → Badge Verde

## 📁 Estructura del Proyecto

```
ainspecta_web/
├── server.js        # Backend Fastify
├── public/          # Archivos estáticos
│   └── index.html   # Frontend MVP Demo
├── package.json     # Configuración
└── README.md        # Este archivo
```

## 🛠️ Tecnologías

### Backend
- **Fastify**: Servidor web rápido
- **Sharp**: Procesamiento de imágenes
- **@fastify/static**: Servir archivos estáticos
- **@fastify/multipart**: Manejo de uploads
- **Prisma + MySQL**: Persistencia de Casos y Slots

### Frontend
- HTML5 + CSS3 + JavaScript vanilla
- Preview de imágenes
- Visualización de resultados JSON

## 🗄️ Base de datos (MySQL con Prisma)

### Desarrollo local con Docker

1. Levanta MySQL:
   ```bash
   docker compose up -d
   ```

2. Copia `.env.example` a `.env` (usa `localhost:3306` para Docker).

3. Ejecuta migraciones:
   ```bash
   npx prisma migrate deploy
   ```

4. Inicia el servidor:
   ```bash
   npm run dev
   ```

### Sin Docker

1. Instala MySQL y crea la base `ainspecta`.
2. Copia `.env.example` a `.env` y ajusta `DATABASE_URL`.
3. Ejecuta `npx prisma migrate deploy`.

## 📥 Restaurar datos de producción a local

Si tenías casos de prueba en producción y quieres traerlos a local:

1. **Instala Cloud SQL Proxy** (si no lo tienes): [Releases](https://github.com/GoogleCloudPlatform/cloud-sql-proxy/releases) → descarga `cloud-sql-proxy.x64.exe`, renómbralo a `cloud-sql-proxy.exe`.

2. **Terminal 1** – Inicia el proxy:
   ```bash
   cloud-sql-proxy --port=3307 ainspecciona:southamerica-west1:ainspecciona-mysql
   ```

3. **Terminal 2** – Ejecuta el script de restauración:
   ```powershell
   .\restore-from-production.ps1
   ```

4. Reinicia el servidor (`npm run dev`).

## 📝 Notas

Este es el MVP demo local del proyecto Ainspecciona.

# Ainspecciona

## QA de mejora continua (antes de deploy)

Para que cada ajuste realmente mejore la entrega y no sobreajuste un solo caso:

1. Mantén un baseline en `qa/case-baseline.json` con casos críticos y expectativas por slot.
2. Ejecuta validación automática:
   ```bash
   npm run qa:cases
   ```
3. Si quieres reanalizar casos antes de validar:
   ```bash
   node scripts/qa-cases.mjs --file qa/case-baseline.json --reanalyze
   ```
4. Si validas contra otro ambiente:
   ```bash
   node scripts/qa-cases.mjs --base-url https://tu-api --file qa/case-baseline.json
   ```

Notas:
- El script verifica coherencia (texto favorable vs severidad/puntaje), score por slot y reglas esperadas por caso.
- Puedes agregar más casos al JSON para ir robusteciendo la regresión.
