# Grant credits to "Real State Premium" on Cloud SQL (production) via proxy.
# Usage: .\grant-credits-prod.ps1
# Optional: $env:GRANT_TENANT_NAME, $env:GRANT_CREDITS, $env:CLOUD_SQL_PROXY_PORT

param(
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }
$tenantName = if ($env:GRANT_TENANT_NAME) { $env:GRANT_TENANT_NAME } else { "Real State Premium" }
$credits = if ($env:GRANT_CREDITS) { $env:GRANT_CREDITS } else { "50" }

Write-Host "=== Grant credits PROD ===" -ForegroundColor Cyan
Write-Host "Tenant: $tenantName  Amount: $credits" -ForegroundColor Gray

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
  Write-Host "Type YES to grant $credits credits to $tenantName on PROD:" -ForegroundColor Red
  if ((Read-Host) -ne "YES") { exit 1 }
}

& node "scripts/grant-tenant-credits.mjs" $tenantName $credits
exit $LASTEXITCODE
