# Restablece contraseña de tenant por email
# Uso: .\reset-password.ps1 seba.araya.silva@gmail.com MiNuevaClave123
# Requiere: Cloud SQL Proxy corriendo (cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql)

param(
    [Parameter(Mandatory=$true)][string]$Email,
    [Parameter(Mandatory=$true)][string]$NuevaClave
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
    Write-Host "Error: No se pudo obtener DATABASE_URL. Ejecuta: gcloud auth login" -ForegroundColor Red
    exit 1
}

if ($dbUrl -match '\?socket=') {
    $dbUrl = $dbUrl -replace '@[^/]+/', '@127.0.0.1:3306/'
    $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
    $dbUrl = $dbUrl.TrimEnd('?')
    Write-Host "Usando Cloud SQL Proxy (127.0.0.1:3306). Debe estar corriendo." -ForegroundColor Yellow
}

$env:DATABASE_URL = $dbUrl
node scripts/reset-tenant-password.js $Email $NuevaClave
