# Añade columnas faltantes a Case en producción (contactEmail, contactName, etc.)
# Requiere: Cloud SQL Proxy en 127.0.0.1:3307
#   .\cloud-sql-proxy.exe ainspecciona:southamerica-west1:ainspecciona-mysql --port=3307

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }
$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
    Write-Host "Error: No se pudo obtener DATABASE_URL." -ForegroundColor Red
    exit 1
}

if ($dbUrl -match '\?socket=') {
    $dbUrl = $dbUrl -replace '@[^/]+/', "@127.0.0.1:$proxyPort/"
    $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
    $dbUrl = $dbUrl.TrimEnd('?')
}

$env:DATABASE_URL = $dbUrl
Write-Host "=== Añadiendo columnas faltantes a Case ===" -ForegroundColor Cyan
Write-Host "Proxy en 127.0.0.1:$proxyPort" -ForegroundColor Gray
Write-Host ""

node prisma/fix-case-columns.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Columnas añadidas. Prueba el demo de nuevo." -ForegroundColor Green
} else {
    exit 1
}
