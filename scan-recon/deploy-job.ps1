# Deploy del Cloud Run Job COLMAP (2Gi). Independiente del API.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    $gcloudDirs = @(
        (Join-Path $env:LocalAppData "Google\Cloud SDK\google-cloud-sdk\bin"),
        (Join-Path $env:ProgramFiles "Google\Cloud SDK\google-cloud-sdk\bin")
    )
    foreach ($d in $gcloudDirs) {
        if (Test-Path (Join-Path $d "gcloud.cmd")) { $env:PATH = "$d;$env:PATH"; break }
    }
}

$project = "ainspecciona"
$region = "southamerica-west1"
$job = "ainspecciona-scan-recon"
$bucket = "ainspecciona-photos-852721861524"
$sa = "ainspecciona-run@ainspecciona.iam.gserviceaccount.com"

Write-Host "=== Deploy Job $job (2Gi) ===" -ForegroundColor Cyan
gcloud config set project $project | Out-Null

$exists = $false
$prev = gcloud run jobs describe $job --region $region --project $project --format="value(metadata.name)" 2>$null
if ($prev) { $exists = $true }

if ($exists) {
    Write-Host "Job ya existe: se actualiza la imagen con Cloud Build." -ForegroundColor Yellow
    $image = "southamerica-west1-docker.pkg.dev/$project/cloud-run-source-deploy/${job}"
    gcloud builds submit --tag $image --project $project .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    gcloud run jobs update $job `
        --image $image `
        --region $region `
        --project $project `
        --memory 2Gi `
        --cpu 2 `
        --task-timeout 3600 `
        --max-retries 0 `
        --parallelism 1 `
        --tasks 1 `
        --update-env-vars "GCS_BUCKET=$bucket" `
        --service-account $sa
} else {
    gcloud run jobs deploy $job `
        --source . `
        --region $region `
        --project $project `
        --memory 2Gi `
        --cpu 2 `
        --task-timeout 3600 `
        --max-retries 0 `
        --parallelism 1 `
        --tasks 1 `
        --set-env-vars "GCS_BUCKET=$bucket" `
        --service-account $sa
}

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

gcloud run jobs add-iam-policy-binding $job `
    --region $region `
    --project $project `
    --member "serviceAccount:$sa" `
    --role "roles/run.invoker" | Out-Null
gcloud run jobs add-iam-policy-binding $job `
    --region $region `
    --project $project `
    --member "serviceAccount:$sa" `
    --role "roles/run.jobsExecutorWithOverrides" | Out-Null

Write-Host "Job listo. El API lo lanza con SCAN_ID/ORG_ID/PACKAGE_PATH." -ForegroundColor Green
