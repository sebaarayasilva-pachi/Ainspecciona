# Restaurar datos de producción (Cloud SQL) a MySQL local
# Requisitos: gcloud CLI, Cloud SQL Proxy, mysql client
#
# PASO 1 - En un terminal, inicia Cloud SQL Proxy:
#   cloud-sql-proxy --port=3307 ainspecciona:southamerica-west1:ainspecciona-mysql
#
# PASO 2 - En otro terminal, ejecuta:
#   .\restore-from-production.ps1
#
# El script obtiene la contraseña de Secret Manager automáticamente.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$prodHost = "127.0.0.1"
$prodPort = 3307
$prodUser = "ainspecciona"
$prodDb = "ainspecciona"
$localUser = "ainspecciona"
$localPass = "Charli01`$"
$localDb = "ainspecciona"

Write-Host "=== Restaurar producción -> local ===" -ForegroundColor Cyan
Write-Host ""

# Obtener contraseña de producción
$secret = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $secret) {
    Write-Host "Error: No se pudo obtener DATABASE_URL. ¿Estás autenticado en gcloud?" -ForegroundColor Red
    exit 1
}
if ($secret -match 'mysql://([^:]+):([^@]+)@') {
    $prodUser = $Matches[1]
    $prodPass = $Matches[2] -replace '%24','$' -replace '%40','@'
} else {
    Write-Host "Introduce la contraseña de MySQL de producción:" -ForegroundColor Yellow
    $prodPass = Read-Host -AsSecureString
    $prodPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($prodPass))
}

$dumpFile = "prod-dump-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"

Write-Host "1. Exportando desde Cloud SQL (proxy en $prodHost`:$prodPort)..." -ForegroundColor Yellow
Write-Host "   Ejecuta en otro terminal: cloud-sql-proxy --port=3307 ainspecciona:southamerica-west1:ainspecciona-mysql" -ForegroundColor Gray
$env:MYSQL_PWD = $prodPass
mysqldump -h $prodHost -P $prodPort -u $prodUser --single-transaction --routines --triggers $prodDb 2>$null | Out-File -FilePath $dumpFile -Encoding utf8
$env:MYSQL_PWD = $null
if (-not (Test-Path $dumpFile) -or (Get-Item $dumpFile).Length -lt 100) {
    Write-Host "Error: ¿Cloud SQL Proxy está corriendo en puerto $prodPort?" -ForegroundColor Red
    Write-Host "  cloud-sql-proxy --port=$prodPort ainspecciona:southamerica-west1:ainspecciona-mysql" -ForegroundColor Gray
    exit 1
}

Write-Host "2. Importando a MySQL local (puerto 3306)..." -ForegroundColor Yellow
$env:MYSQL_PWD = $localPass
Get-Content $dumpFile -Raw | mysql -h 127.0.0.1 -P 3306 -u $localUser $localDb 2>$null
$env:MYSQL_PWD = $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error al importar." -ForegroundColor Red
    exit 1
}

Remove-Item $dumpFile -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Restauración completada. Reinicia el servidor." -ForegroundColor Green
