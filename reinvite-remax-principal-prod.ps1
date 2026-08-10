# Reenvía invitaciones por email a todos los usuarios de REMAX PRINCIPAL (producción).
# Uso: .\reinvite-remax-principal-prod.ps1 -Yes

param(
  [switch]$Yes,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }

Write-Host "=== Reinvitar agentes REMAX PRINCIPAL (PROD) ===" -ForegroundColor Cyan

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
if (-not $env:PUBLIC_URL) { $env:PUBLIC_URL = "https://ainspecciona.com" }

if (-not $Yes) {
  Write-Host "Type YES to reinvite all REMAX PRINCIPAL agents on PROD:" -ForegroundColor Red
  if ((Read-Host) -ne "YES") { exit 1 }
}

$args = @("scripts/reinvite-tenant-agents.mjs", "REMAX PRINCIPAL")
if ($DryRun) { $args += "--dry-run" }
& node @args
exit $LASTEXITCODE
