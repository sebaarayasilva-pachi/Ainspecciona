# Ejecuta migraciones Prisma contra Cloud SQL (producción)
# Requiere: Cloud SQL Proxy corriendo O mysql accesible
# Para iniciar proxy: cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Migración Prisma (Cloud SQL) ===" -ForegroundColor Cyan

# Obtener DATABASE_URL de Secret Manager
$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
    Write-Host "Error: No se pudo obtener DATABASE_URL de Secret Manager." -ForegroundColor Red
    Write-Host "Verifica: gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona" -ForegroundColor Gray
    exit 1
}

# Si usa socket (Cloud Run), convertir a TCP para proxy local
$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }
if ($dbUrl -match '\?socket=') {
    $dbUrl = $dbUrl -replace '@[^/]+/', "@127.0.0.1:$proxyPort/"
    $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
    $dbUrl = $dbUrl.TrimEnd('?')
    Write-Host "Usando Cloud SQL Proxy (127.0.0.1:$proxyPort). Asegúrate de tenerlo corriendo:" -ForegroundColor Yellow
    Write-Host "  .\cloud-sql-proxy.exe ainspecciona:southamerica-west1:ainspecciona-mysql --port=$proxyPort" -ForegroundColor Gray
    Write-Host ""
}

$env:DATABASE_URL = $dbUrl
# Evitar que stderr de dotenv/Prisma interrumpa el script (PowerShell trata stderr como error)
$prevErrPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$out = npx prisma migrate deploy 2>&1
$migrateExit = $LASTEXITCODE
$ErrorActionPreference = $prevErrPref
$out | Out-Host

if ($migrateExit -eq 0) {
    Write-Host ""
    Write-Host "Migración completada." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Si falla por conexión: inicia Cloud SQL Proxy en otra terminal:" -ForegroundColor Yellow
    Write-Host "  cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql" -ForegroundColor Gray
    exit 1
}
