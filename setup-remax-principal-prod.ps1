# Crea/actualiza REMAX PRINCIPAL + 50 créditos + agentes en Cloud SQL (producción).
param(
  [switch]$Yes,
  [int]$Credits = 50,
  [string]$Password = "Remax2026"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }

Write-Host "=== Setup REMAX PRINCIPAL (PROD) ===" -ForegroundColor Cyan
Write-Host "Créditos: $Credits  Clave agentes/corredora: $Password" -ForegroundColor Gray

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) { Write-Host "Error: DATABASE_URL secret" -ForegroundColor Red; exit 1 }

if ($dbUrl -match '\?socket=') {
  $tcpHost = '127.0.0.1:' + $proxyPort + '/'
  $dbUrl = $dbUrl -replace '@[^/]+/', ('@' + $tcpHost)
  $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
  $dbUrl = $dbUrl.TrimEnd('?')
}

$proxyExe = Join-Path $PSScriptRoot "cloud-sql-proxy.exe"
if (-not (Test-Path $proxyExe)) { Write-Host "Error: cloud-sql-proxy.exe missing" -ForegroundColor Red; exit 1 }

$listening = Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -FilePath $proxyExe -ArgumentList "ainspecciona:southamerica-west1:ainspecciona-mysql", "--port=$proxyPort" -WindowStyle Hidden
  Start-Sleep -Seconds 6
}

$env:KICKOFF_DATABASE_URL = $dbUrl
$env:DATABASE_URL = $dbUrl

if (-not $Yes) {
  Write-Host "Type YES to create/update REMAX PRINCIPAL on PROD:" -ForegroundColor Red
  if ((Read-Host) -ne "YES") { exit 1 }
}

& node "scripts/setup-remax-principal.mjs" --credits $Credits --password $Password
exit $LASTEXITCODE
