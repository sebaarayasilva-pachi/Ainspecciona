# Kickoff cleanup against Cloud SQL (production) via Cloud SQL Proxy.
# Keeps by default: Real State Premium, Corredora Testers
#
# Usage:
#   .\kickoff-cleanup-prod.ps1
#   .\kickoff-cleanup-prod.ps1 -Yes
#
# Optional:
#   $env:KICKOFF_KEEP_TENANTS = 'Real State Premium,Other'
#   $env:CLOUD_SQL_PROXY_PORT = '3307'

param(
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }
$keepList = if ($env:KICKOFF_KEEP_TENANTS) { $env:KICKOFF_KEEP_TENANTS } else { "Real State Premium,Corredora Testers" }

Write-Host "=== Kickoff cleanup PROD (Cloud SQL) ===" -ForegroundColor Cyan
Write-Host "Keep tenants: $keepList" -ForegroundColor Gray
Write-Host ""

try {
  gcloud --version | Out-Null
} catch {
  Write-Host "Error: gcloud CLI not found." -ForegroundColor Red
  exit 1
}

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
  Write-Host "Error: could not read DATABASE_URL secret (project ainspecciona)." -ForegroundColor Red
  exit 1
}

if ($dbUrl -match '\?socket=') {
  $tcpHost = '127.0.0.1:' + $proxyPort + '/'
  $dbUrl = $dbUrl -replace '@[^/]+/', ('@' + $tcpHost)
  $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
  $dbUrl = $dbUrl.TrimEnd('?')
  Write-Host "URL rewritten for TCP tunnel 127.0.0.1:$proxyPort" -ForegroundColor Yellow
} else {
  Write-Host "WARNING: DATABASE_URL has no Cloud SQL socket; using as-is." -ForegroundColor Yellow
}

$proxyExe = Join-Path $PSScriptRoot "cloud-sql-proxy.exe"
if (-not (Test-Path $proxyExe)) {
  Write-Host "Error: cloud-sql-proxy.exe missing in $PSScriptRoot" -ForegroundColor Red
  exit 1
}

$listening = Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Write-Host "Starting Cloud SQL Proxy on port $proxyPort..." -ForegroundColor Yellow
  Start-Process -FilePath $proxyExe -ArgumentList "ainspecciona:southamerica-west1:ainspecciona-mysql", "--port=$proxyPort" -WindowStyle Hidden
  Start-Sleep -Seconds 6
}

$env:KICKOFF_DATABASE_URL = $dbUrl
$env:DATABASE_URL = $dbUrl
Remove-Item Env:DOTENV_CONFIG_PATH -ErrorAction SilentlyContinue
$env:CONFIRM = "YES"
$env:KICKOFF_KEEP_TENANTS = $keepList

if (-not $Yes) {
  Write-Host "This will delete almost all tenants and ALL cases in the secret DB." -ForegroundColor Red
  Write-Host "Type YES to continue:" -ForegroundColor Red
  if ((Read-Host) -ne "YES") {
    Write-Host "Cancelled."
    exit 1
  }
}

Write-Host ""
Write-Host "Running node scripts/kickoff-cleanup.mjs ..." -ForegroundColor Cyan
& node "scripts/kickoff-cleanup.mjs"
$code = $LASTEXITCODE

Write-Host ""
if ($code -eq 0) {
  Write-Host "=== Done ===" -ForegroundColor Green
} else {
  Write-Host "=== Failed exit code $code ===" -ForegroundColor Red
}

exit $code
