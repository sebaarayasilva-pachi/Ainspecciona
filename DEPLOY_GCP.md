# Deploy (Google Cloud) — Ainspecciona Web

## Goal
Deploy a public HTTPS URL so you can use **Capture (mobile)** in the field and **Report (desktop)** with the same case.

## Repo (GitHub)
- `https://github.com/sebaarayasilva-pachi/Ainspecciona`

Clone / update:
```bash
git clone https://github.com/sebaarayasilva-pachi/Ainspecciona.git
cd Ainspecciona/ainspecta_web
git pull
```

## Recommended architecture (MVP)
- **Cloud Run**: runs `server.js` (API + HTML pages)
- **Cloud SQL (MySQL)**: stores cases/slots/photos/tokens
- **Cloud Storage**: stores photos (recommended; Cloud Run disk is ephemeral)

> This repo already supports **GCS uploads** via env vars.

---

## 1) Create a GCS bucket for photos
Create a bucket and make it publicly readable (simple MVP).

Current bucket:
- `GCS_BUCKET=ainspecciona-photos-852721861524`
- `STORAGE_DRIVER=gcs`

> Later we can switch to signed URLs (private bucket).

### Hero video (`/corredores`)
El MP4 del hero no va en Git (peso). Se sirve desde el **mismo bucket** en la ruta fija `site/video-hero.mp4`.

1. Sube el archivo (ajusta el nombre del bucket si cambió):

```bash
gsutil cp video-hero.mp4 gs://ainspecciona-photos-852721861524/site/video-hero.mp4
```

2. **Lectura pública** del objeto (o política de bucket que ya uses para fotos). Si el video no carga en el navegador, revisa permisos del objeto y, si hace falta, CORS del bucket para `GET` desde `https://ainspecciona.web.app` (y tu dominio).

URL pública usada en `public/corredores.html` (segundo `<source>` si el primero no existe):

`https://storage.googleapis.com/ainspecciona-photos-852721861524/site/video-hero.mp4`

Opcional en desarrollo: copia el MP4 a `public/assets/video-hero.mp4` (está en `.gitignore`; no se sube a Git).

---

## 2) Create Cloud SQL (MySQL)
Current instance:
- **Project**: `ainspecciona`
- **Region**: `southamerica-west1`
- **Instance**: `ainspecciona-mysql`
- **Instance connection name**: `ainspecciona:southamerica-west1:ainspecciona-mysql`
- **Database**: `ainspecciona`
- **User**: `ainspecciona`

Set `DATABASE_URL` (example):

```text
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/ainspecciona"
```

For production, use **Cloud SQL Connector** (below). Public IP is not used.

---

## 3) Deploy to Cloud Run (single service)
From `ainspecta_web/`:

**Make sure you are on the right project/account:**
```bash
gcloud auth list
gcloud config set project ainspecciona
```

**Enable required APIs (first time):**
```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com
```

**Install dependencies:**
```bash
npm install
```

### `deploy.ps1` (Windows)

Desde `ainspecta_web/`:

```powershell
.\deploy.ps1
```

El script despliega **Cloud Run** (`ainspecciona-api`) y, si está configurado, **Firebase Hosting**. Antes ejecuta **`migrate.ps1`** (subproceso), que lee `DATABASE_URL` desde **Secret Manager** y se conecta por **TCP a `127.0.0.1:3307`**.

**Si `migrate.ps1` falla:** `deploy.ps1` **se detiene** y **no** sube la revisión nueva (evita código Prisma que espera columnas que aún no existen en Cloud SQL). Para omitir migración solo en emergencia: `DEPLOY_ALLOW_NO_MIGRATE=1 .\deploy.ps1` (no recomendado).

**Si la migración falla con `P1001: Can't reach database server at 127.0.0.1:3307`:** no llegará el deploy hasta corregirlo. Hay que:

1. **Terminal 1** — Cloud SQL Auth Proxy (mismo puerto que `migrate.ps1`, por defecto `3307`):

```powershell
cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql --port=3307
```

(o `.\cloud-sql-proxy.exe` si usas el binario local).

2. **Terminal 2** — migraciones:

```powershell
cd ainspecta_web
.\migrate.ps1
```

3. Opcional: volver a ejecutar `.\deploy.ps1` si quieres un ciclo completo tras migrar.

El servidor puede crear columnas puntuales con `ensure*` al arrancar, pero **conviene aplicar siempre `prisma migrate deploy`** para historial y paridad entre entornos.

**Si `migrate deploy` falla con `Duplicate column` / objeto ya creado por `ensure*`:** el esquema ya está bien; solo falta alinear la tabla `_prisma_migrations`. Con el proxy en `3307` y `DATABASE_URL` apuntando al túnel:

```powershell
npx prisma migrate resolve --applied NOMBRE_MIGRACION
```

Ejemplo: `20260403120000_peer_referral`. Luego `npx prisma migrate status` debe decir *up to date*.

**Run DB migrations (Cloud SQL):**
```bash
# Use Cloud SQL connector socket in DATABASE_URL (sin puerto :3306 para socket)
DATABASE_URL="mysql://ainspecciona:PASSWORD@localhost/ainspecciona?socket=/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql" \
  npx prisma migrate deploy
```

**Artifact Registry (optional if using `--source`):**
Cloud Run will use `cloud-run-source-deploy` automatically for source builds.

```bash
gcloud run deploy ainspecciona-api \
  --source . \
  --region southamerica-west1 \
  --allow-unauthenticated \
  --project ainspecciona \
  --image southamerica-west1-docker.pkg.dev/ainspecciona/cloud-run-source-deploy/ainspecciona-api \
  --add-cloudsql-instances ainspecciona:southamerica-west1:ainspecciona-mysql \
  --set-env-vars "NODE_ENV=production,STORAGE_DRIVER=gcs,GCS_BUCKET=ainspecciona-photos-852721861524,DATABASE_URL=mysql://ainspecciona:PASSWORD@localhost/ainspecciona?socket=/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql"
```

**Get service URL:**
```bash
gcloud run services describe ainspecciona-api \
  --region southamerica-west1 \
  --project ainspecciona \
  --format="value(status.url)"
```

If you get permission errors, verify:
```bash
gcloud config list
gcloud projects list
```

Current Cloud Run URL:
`https://ainspecta-api-852721861524.southamerica-west1.run.app`

Open:
- `/formulario`
- create case → “Abrir captura (celular)”
- `/cases/<caseId>/report`
- `/tenant` (panel corredora)
- `/executive` (app móvil ejecutivo)
- `/activate` (activar cuenta ejecutivo)

---

## 4) Firebase Hosting (frontend + proxy a Cloud Run)

El `firebase.json` del repo define **rewrites en orden**: primero rutas concretas a HTML en `public/`, y al final un catch‑all `**` hacia el servicio Cloud Run `ainspecciona-api` (región `southamerica-west1`).

Incluye entre otras:
- `/` → `corredores.html`
- `/precios` → `precios.html`
- **`/whatsapp-test` → `whatsapp-test.html`** (chat de prueba del bot; sin pasar por Cloud Run si esta regla está desplegada)
- **`/api/**` → Cloud Run** (API explícita; el HTML de prueba llama a `/api/whatsapp/test/...`)
- `**` → Cloud Run (resto de rutas que no sean estáticas)

Tras cambiar `firebase.json` o archivos en `public/`:

```bash
cd ainspecta_web
firebase deploy --only hosting
```

(Proyecto Firebase y CLI ya configurados con `firebase login`.)

---

## OpenAI (Resumen ejecutivo y reanálisis con IA)

Para que funcione "Generar resumen ejecutivo" y "Reanalizar con IA", crea el secreto `OPENAI_API_KEY` en Secret Manager:

**Linux/Mac:**
```bash
echo -n "sk-proj-..." | gcloud secrets create OPENAI_API_KEY --data-file=- --project=ainspecciona
```

**Windows PowerShell:**
```powershell
$key = "sk-proj-..."  # Tu API key de OpenAI
[System.IO.File]::WriteAllText("$env:TEMP\openai.txt", $key)
gcloud secrets create OPENAI_API_KEY --data-file=$env:TEMP\openai.txt --project=ainspecciona
```

(O usa `gcloud secrets versions add OPENAI_API_KEY --data-file=...` si el secreto ya existe.)

El deploy (`deploy.ps1`) ya incluye `OPENAI_API_KEY` desde Secret Manager. Después de crear el secreto, haz redeploy con `.\deploy.ps1`.

Si el deploy falla con "permission denied" al acceder al secreto, da acceso al service account de Cloud Run:
```bash
gcloud secrets add-iam-policy-binding OPENAI_API_KEY --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" --project=ainspecciona
```
(O usa el service account que aparece en la consola de Cloud Run.)

---

## Notes
- **Camera**: on HTTPS, `getUserMedia()` works better. If it fails, the app still has the fallback capture input.
- **DB schema**: Prisma migrations are stored in `prisma/migrations`. If the DB is empty, apply migrations before first use.

## Troubleshooting: /api/health devuelve `{"ok":false,"db":"error"}`

Si el error dice "Can't reach database server at 127.0.0.1:3306", el secreto `DATABASE_URL` en Secret Manager tiene formato incorrecto.

**Formato correcto para Cloud Run (socket Unix):**
```
mysql://ainspecciona:PASSWORD@localhost/ainspecciona?socket=/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql
```

- **Sin** `:3306` (el puerto hace que Prisma intente TCP en vez del socket)
- **Con** `?socket=/cloudsql/...`
- Codifica caracteres especiales en la contraseña (ej. `$` → `%24`)

**Actualizar el secreto (reemplaza TU_PASSWORD con tu contraseña real, codificando `$` como `%24`):**

```bash
# Linux/Mac
echo -n "mysql://ainspecciona:TU_PASSWORD@localhost/ainspecciona?socket=/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql" | gcloud secrets versions add DATABASE_URL --data-file=-
```

```powershell
# Windows PowerShell
$url = "mysql://ainspecciona:TU_PASSWORD@localhost/ainspecciona?socket=/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql"
[System.IO.File]::WriteAllText("$env:TEMP\dburl.txt", $url)
gcloud secrets versions add DATABASE_URL --data-file=$env:TEMP\dburl.txt
```

Luego redeploy con `.\deploy.ps1`.

## Troubleshooting: `/whatsapp-test` devuelve `404` JSON de Fastify

**Síntoma:** En el navegador ves algo como  
`{"message":"Route GET:/whatsapp-test not found","error":"Not Found","statusCode":404}`  
(es la respuesta por defecto de Fastify en **Cloud Run**).

**Causa:** La petición está llegando al **backend** sin que exista esa ruta en la revisión desplegada, o **Firebase Hosting** no está aplicando la regla estática y todo cae en el catch‑all `**` → Cloud Run.

**Qué hacer (las dos cosas):**

1. **Hosting** — desplegar reglas y estáticos actuales (incluye la rewrite a `whatsapp-test.html`):
   ```powershell
   cd ainspecta_web
   firebase deploy --only hosting
   ```

2. **Cloud Run** — imagen nueva con el `server.js` actual (incluye `GET /whatsapp-test` que lee `public/whatsapp-test.html`):
   ```powershell
   .\deploy.ps1
   ```

Después probá `https://ainspecciona.web.app/whatsapp-test` (y tu dominio custom si Hosting lo tiene enlazado al mismo proyecto).

**Variables:** `WHATSAPP_TEST_MODE=1` en Cloud Run solo habilita **`/api/whatsapp/test/*`**; no crea la ruta HTML. Si la página carga pero la API falla, revisá esa variable y el resto de secretos.

## Troubleshooting: `WhatsAppProcessedEvent` / tabla no existe (Prisma)

**Síntoma:** Al usar `/whatsapp-test`, error del tipo *The table `WhatsAppProcessedEvent` does not exist*.

**Causa:** En Cloud SQL **no se aplicó** la migración `prisma/migrations/20260410120000_whatsapp_tables` (u otras posteriores).

**Solución:** Conectar a la misma BD que usa producción y ejecutar migraciones:

1. **Terminal 1** — Cloud SQL Auth Proxy (deja corriendo):
   ```powershell
   cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql --port=3307
   ```
   (O `.\cloud-sql-proxy.exe` con la misma instancia y puerto.)

2. **Terminal 2** — desde `ainspecta_web`:
   ```powershell
   .\migrate.ps1
   ```
   (`migrate.ps1` lee `DATABASE_URL` desde Secret Manager y lo adapta a `127.0.0.1:3307` cuando el secreto usa socket Unix.)

3. Verificá: `npx prisma migrate status` (con el mismo `DATABASE_URL` que usa `migrate.ps1`).

Sin el proxy en marcha verás `P1001: Can't reach database server at 127.0.0.1:3307`.
