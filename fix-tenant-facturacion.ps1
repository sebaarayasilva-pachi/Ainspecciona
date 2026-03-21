# Añade facturacionJson a Tenant en producción
# Requiere: Cloud SQL Proxy corriendo en 127.0.0.1:3307

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
    Write-Host "Error: No se pudo obtener DATABASE_URL. Ejecuta: gcloud auth login" -ForegroundColor Red
    exit 1
}

# Convertir socket (Cloud Run) a TCP para proxy local (igual que migrate.ps1)
$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }
if ($dbUrl -match '\?socket=') {
    $dbUrl = $dbUrl -replace '@[^/]+/', "@127.0.0.1:$proxyPort/"
    $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
    $dbUrl = $dbUrl.TrimEnd('?')
}

Write-Host "Asegurate de tener Cloud SQL Proxy corriendo:" -ForegroundColor Yellow
Write-Host "  .\cloud-sql-proxy.exe ainspecciona:southamerica-west1:ainspecciona-mysql --port=$proxyPort" -ForegroundColor Gray
Write-Host ""
Write-Host "Añadiendo facturacionJson a Tenant..." -ForegroundColor Cyan

$env:DATABASE_URL = $dbUrl
node prisma/add-tenant-facturacion.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Listo. El error en ainspecciona.com debería desaparecer." -ForegroundColor Green
}
