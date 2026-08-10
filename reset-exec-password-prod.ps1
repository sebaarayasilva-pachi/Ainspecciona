# Restablece clave ejecutivo en la BD de producción (misma fuente que migrate.ps1).
# Requiere: Cloud SQL Proxy escuchando en el puerto de CLOUD_SQL_PROXY_PORT (default 3307).
#
# Terminal 1:
#   cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql --port=3307
# Terminal 2:
#   .\reset-exec-password-prod.ps1 tester@ainspecciona.com Test1234A

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$email = $args[0]
$pass = $args[1]
if (-not $email -or -not $pass) {
  Write-Host "Uso: .\reset-exec-password-prod.ps1 <email> <nueva-clave>" -ForegroundColor Yellow
  Write-Host "Ejemplo: .\reset-exec-password-prod.ps1 tester@ainspecciona.com Test1234A"
  exit 1
}

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
  Write-Host "No se pudo leer DATABASE_URL de Secret Manager (gcloud auth / proyecto ainspecciona)." -ForegroundColor Red
  exit 1
}

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }
if ($dbUrl -match '\?socket=') {
  $dbUrl = $dbUrl -replace '@[^/]+/', "@127.0.0.1:$proxyPort/"
  $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
  $dbUrl = $dbUrl.TrimEnd('?')
}
$env:DATABASE_URL = $dbUrl

Write-Host "Proxy 127.0.0.1:${proxyPort} - Si falla, inicia Cloud SQL Proxy en otra terminal." -ForegroundColor Cyan
node scripts/reset-executive-password.js $email $pass
exit $LASTEXITCODE
