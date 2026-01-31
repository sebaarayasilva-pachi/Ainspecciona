# Deploy (Google Cloud) — Ainspecciona Web

## Goal
Deploy a public HTTPS URL so you can use **Capture (mobile)** in the field and **Report (desktop)** with the same case.

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

**Artifact Registry (required for build push):**
```bash
gcloud artifacts repositories create ainspecta \
  --project ainspecciona \
  --location southamerica-west1 \
  --repository-format docker
```

```bash
gcloud run deploy ainspecta-api \
  --source . \
  --region southamerica-west1 \
  --allow-unauthenticated \
  --project ainspecciona \
  --image southamerica-west1-docker.pkg.dev/ainspecciona/ainspecta/ainspecta-api \
  --add-cloudsql-instances ainspecciona:southamerica-west1:ainspecciona-mysql \
  --set-env-vars "NODE_ENV=production,STORAGE_DRIVER=gcs,GCS_BUCKET=ainspecciona-photos-852721861524,DATABASE_URL=mysql://ainspecciona:PASSWORD@localhost:3306/ainspecciona?socket=/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql"
```

Current Cloud Run URL:
`https://ainspecta-api-852721861524.southamerica-west1.run.app`

Open:
- `/formulario`
- create case → “Abrir captura (celular)”
- `/cases/<caseId>/report`

---

## 4) (Optional) Firebase Hosting as frontend
This repo includes a `firebase.json` that maps:
- `/formulario` → `/formulario.html`
- `/capture/**` → `/capture.html`
- `/cases/**/report` → `/report.html`

To proxy API calls from Hosting → Cloud Run, add rewrites like:

```json
{ "source": "/api/**", "run": { "serviceId": "ainspecta-api", "region": "us-central1" } }
```

and (because the UI uses `/cases` as API for now):

```json
{ "source": "/cases/**", "run": { "serviceId": "ainspecta-api", "region": "us-central1" } }
```

---

## Notes
- **Camera**: on HTTPS, `getUserMedia()` works better. If it fails, the app still has the fallback capture input.
- **DB schema**: this MVP currently uses `prisma db push` during development. For production, we can formalize migrations.
