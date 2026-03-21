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

## 4) (Optional) Firebase Hosting as frontend
This repo includes a `firebase.json` that maps:
- `/formulario` → `/formulario.html`
- `/capture/**` → `/capture.html`
- `/cases/**/report` → `/report.html`

To proxy API calls from Hosting → Cloud Run, add rewrites like:

```json
{ "source": "/api/**", "run": { "serviceId": "ainspecciona-api", "region": "southamerica-west1" } }
```

and (because the UI uses `/cases` as API for now):

```json
{ "source": "/cases/**", "run": { "serviceId": "ainspecciona-api", "region": "southamerica-west1" } }
```

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
