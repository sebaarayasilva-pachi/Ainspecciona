# Migrate pv_user + seed usuario portal Postventa en PROD (Cloud SQL Proxy).
# Uso: .\scripts\seed-pv-portal-user-prod.ps1
#      .\scripts\seed-pv-portal-user-prod.ps1 -Email ops@ejemplo.com -Password 'Clave' -TenantSlug mi-tenant
param(
  [string]$Email = "postventa@demo.ainspecciona.com",
  [string]$Password = "PostventaDemo2026!",
  [string]$TenantSlug = "",
  [string]$Name = "Operador Postventa Demo"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) { Write-Host "Error: DATABASE_URL secret" -ForegroundColor Red; exit 1 }

if ($dbUrl -match '\?socket=') {
  $tcpHost = '127.0.0.1:' + $proxyPort + '/'
  $dbUrl = $dbUrl -replace '@[^/]+/', ('@' + $tcpHost)
  $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
  $dbUrl = $dbUrl.TrimEnd('?')
}

$proxyExe = Join-Path (Get-Location) "cloud-sql-proxy.exe"
if (-not (Test-Path $proxyExe)) { Write-Host "Error: cloud-sql-proxy.exe missing" -ForegroundColor Red; exit 1 }

$listening = Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -FilePath $proxyExe -ArgumentList "ainspecciona:southamerica-west1:ainspecciona-mysql", "--port=$proxyPort" -WindowStyle Hidden
  Start-Sleep -Seconds 6
}

$env:KICKOFF_DATABASE_URL = $dbUrl
$env:DATABASE_URL = $dbUrl

Write-Host "=== prisma migrate deploy (prod tunnel) ===" -ForegroundColor Cyan
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== prisma generate ===" -ForegroundColor Cyan
npx prisma generate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$nodeArgs = @(
  "scripts/seed-pv-portal-user.mjs",
  "--email", $Email,
  "--password", $Password,
  "--name", $Name
)
if ($TenantSlug) {
  $nodeArgs += @("--tenant-slug", $TenantSlug)
}

Write-Host "=== seed PvUser $Email ===" -ForegroundColor Cyan
& node @nodeArgs
exit $LASTEXITCODE
