# Ejecuta seed en la base de datos de producción (crea tenant Starter)
# Requiere: Cloud SQL Proxy corriendo en otra terminal
#   cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql --port=3306

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Seed producción (Cloud SQL) ===" -ForegroundColor Cyan

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
    Write-Host "Error: No se pudo obtener DATABASE_URL. Ejecuta: gcloud auth login" -ForegroundColor Red
    exit 1
}

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }
if ($dbUrl -match '\?socket=') {
    $dbUrl = $dbUrl -replace '@[^/]+/', "@127.0.0.1:$proxyPort/"
    $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
    $dbUrl = $dbUrl.TrimEnd('?')
    Write-Host "Cloud SQL Proxy debe estar corriendo en 127.0.0.1:$proxyPort" -ForegroundColor Yellow
    Write-Host "  .\cloud-sql-proxy.exe ainspecciona:southamerica-west1:ainspecciona-mysql --port=$proxyPort" -ForegroundColor Gray
    Write-Host ""
}

$env:DATABASE_URL = $dbUrl
node prisma/seed.js
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Seed completado. Tenant Starter creado." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Si falla: inicia Cloud SQL Proxy en otra terminal." -ForegroundColor Yellow
    exit 1
}
