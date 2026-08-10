# Deploy rápido: solo Cloud Run (report.html + API). Sin migraciones ni Firebase.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:DEPLOY_ALLOW_NO_MIGRATE = "1"
Write-Host "=== Deploy rápido (Cloud Run) ===" -ForegroundColor Cyan
& "$PSScriptRoot\deploy.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Listo. Prueba: https://ainspecciona.com/cases/BGG3PLVA/report (Ctrl+F5)" -ForegroundColor Green
Write-Host "Cabecera esperada: X-Report-Scoring: v3-admin-sync" -ForegroundColor Gray
