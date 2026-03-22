# Desbloquea Prisma P3009 (migración fallida) y aplica el resto con migrate deploy.
#
# ANTES en otra terminal de PowerShell (dejar abierta):
#   Descarga proxy: https://github.com/GoogleCloudPlatform/cloud-sql-proxy/releases
#   .\cloud-sql-proxy_x64.exe --port=3307 ainspecciona:southamerica-west1:ainspecciona-mysql
#
# Luego ejecuta ESTE script desde ainspecta_web:
#   .\fix-p3009-and-migrate.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }
$tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port $proxyPort -WarningAction SilentlyContinue
if (-not $tcp.TcpTestSucceeded) {
    Write-Host "No hay nada escuchando en 127.0.0.1:$proxyPort" -ForegroundColor Red
    Write-Host "Inicia Cloud SQL Proxy en otra ventana y vuelve a ejecutar este script." -ForegroundColor Yellow
    Write-Host "  .\cloud-sql-proxy_x64.exe --port=$proxyPort ainspecciona:southamerica-west1:ainspecciona-mysql" -ForegroundColor Gray
    exit 1
}

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
    Write-Host "No se pudo leer DATABASE_URL (gcloud auth / proyecto ainspecciona)." -ForegroundColor Red
    exit 1
}

if ($dbUrl -match '\?socket=') {
    $dbUrl = $dbUrl -replace '@[^/]+/', "@127.0.0.1:$proxyPort/"
    $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
    $dbUrl = $dbUrl.TrimEnd('?')
}

$env:DATABASE_URL = $dbUrl

$failedName = "20260209200000_add_starter_payment_fields"
Write-Host "=== Marcar como aplicada: $failedName (corrige estado P3009 si quedó fallida) ===" -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
$resolveOut = npx prisma migrate resolve --applied $failedName 2>&1
$resolveOut | Out-Host
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== prisma migrate deploy ===" -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
$deployOut = npx prisma migrate deploy 2>&1
$exit = $LASTEXITCODE
$deployOut | Out-Host
$ErrorActionPreference = "Stop"

if ($exit -ne 0) {
    Write-Host ""
    Write-Host "Si sigue P3009 con OTRO nombre de migración, ejecuta:" -ForegroundColor Yellow
    Write-Host "  npx prisma migrate resolve --applied `"NOMBRE_CARPETA_MIGRACION`"" -ForegroundColor Gray
    Write-Host "y de nuevo: npx prisma migrate deploy" -ForegroundColor Gray
    exit $exit
}

Write-Host ""
Write-Host "Listo. Migraciones aplicadas." -ForegroundColor Green
